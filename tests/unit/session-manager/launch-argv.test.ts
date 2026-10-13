/**
 * Exact argv contract for starting and stopping the manager in tmux.
 *
 * The manager is the only session that may run the Telegram plugin, so its
 * launch line carries the whole isolation: the plugin is enabled only through
 * its own `--settings`, its state dir is set only in its own tmux env, and
 * nothing passes through a shell. Snapshotting the argv exactly means a
 * reordered flag or a stray shell string fails here rather than on an
 * operator's machine.
 * @module tests/unit/session-manager/launch-argv
 */
import { describe, expect, it } from "vitest";

import {
  LaunchError,
  TELEGRAM_PLUGIN_ID,
  buildForegroundCommand,
  buildHasSession,
  buildManagerLaunch,
  buildManagerSettings,
  buildStopManager,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";

const NAME = "demo-manager";

const INPUT = {
  name: NAME,
  root: "/work/demo",
  stateDir: "/home/op/.claude/channels/telegram-demo",
  scriptsDir: "/opt/lisa/skills/lisa-session-manager/scripts",
  interval: "5m",
};

const CHANNELS = "--channels";
const LOOP_PROMPT = "/loop 5m /lisa:session-manager cycle";

const SETTINGS_JSON =
  '{"crossSessionInbound":"accept","enabledPlugins":{"telegram@claude-plugins-official":true}}';

describe("buildManagerSettings", () => {
  it("enables only the Telegram plugin and accepts cross-session messages", () => {
    expect(buildManagerSettings()).toEqual({
      crossSessionInbound: "accept",
      enabledPlugins: { "telegram@claude-plugins-official": true },
    });
  });

  it("returns a fresh object each call", () => {
    const first = buildManagerSettings();
    first.enabledPlugins[TELEGRAM_PLUGIN_ID] = false;
    expect(buildManagerSettings().enabledPlugins[TELEGRAM_PLUGIN_ID]).toBe(
      true
    );
  });
});

describe("buildManagerLaunch", () => {
  it("builds the exact tmux argv", () => {
    expect(buildManagerLaunch(INPUT)).toEqual([
      "new-session",
      "-d",
      "-s",
      NAME,
      "-c",
      "/work/demo",
      "-e",
      "TELEGRAM_STATE_DIR=/home/op/.claude/channels/telegram-demo",
      "-e",
      "SM_SCRIPTS_DIR=/opt/lisa/skills/lisa-session-manager/scripts",
      "claude",
      "-n",
      NAME,
      "--dangerously-skip-permissions",
      "--settings",
      SETTINGS_JSON,
      CHANNELS,
      "plugin:telegram@claude-plugins-official",
      "--",
      LOOP_PROMPT,
    ]);
  });

  // claude 2.1.296 parses `--channels` as variadic: without `--` it swallows
  // the prompt as a second channel entry and exits 1 with "--channels entries
  // must be tagged: /loop 5m …" before any session starts.
  it("ends option parsing with -- right before the loop prompt", () => {
    const argv = buildManagerLaunch(INPUT);
    const channels = argv.indexOf(CHANNELS);
    expect(argv.slice(channels)).toEqual([
      CHANNELS,
      `plugin:${TELEGRAM_PLUGIN_ID}`,
      "--",
      LOOP_PROMPT,
    ]);
    expect(argv.at(-2)).toBe("--");
  });

  it("keeps the loop prompt as a single argument", () => {
    const argv = buildManagerLaunch({ ...INPUT, interval: "2h" });
    expect(argv.at(-1)).toBe("/loop 2h /lisa:session-manager cycle");
  });

  it.each([
    [{ name: "Bad Name" }, /name/],
    [{ name: "demo:manager" }, /name/],
    [{ root: "relative/dir" }, /root/],
    [{ stateDir: "~/x" }, /stateDir/],
    [{ scriptsDir: "" }, /scriptsDir/],
    [{ interval: "soon" }, /interval/],
    [{ interval: "0m" }, /interval/],
  ])("refuses %j", (patch, message) => {
    expect(() => buildManagerLaunch({ ...INPUT, ...patch })).toThrow(message);
    expect(() => buildManagerLaunch({ ...INPUT, ...patch })).toThrow(
      LaunchError
    );
  });
});

describe("buildForegroundCommand", () => {
  it("rebuilds the launch as one shell line, quoting what needs it", () => {
    const argv = buildManagerLaunch({ ...INPUT, stateDir: "/home/op/it's" });
    expect(buildForegroundCommand(argv)).toBe(
      "cd '/work/demo' && TELEGRAM_STATE_DIR='/home/op/it'\\''s' " +
        "SM_SCRIPTS_DIR='/opt/lisa/skills/lisa-session-manager/scripts' " +
        `claude -n ${NAME} --dangerously-skip-permissions ` +
        `--settings '${SETTINGS_JSON}' ` +
        "--channels plugin:telegram@claude-plugins-official " +
        `-- '${LOOP_PROMPT}'`
    );
  });
});

describe("buildStopManager", () => {
  it("kills only the named tmux session", () => {
    expect(buildStopManager(NAME)).toEqual(["kill-session", "-t", `=${NAME}`]);
  });

  it("refuses a name that is not a session slug", () => {
    expect(() => buildStopManager("")).toThrow(LaunchError);
  });
});

describe("buildHasSession", () => {
  // `=` makes tmux match the name exactly; without it `demo` would match a
  // running `demo-manager` and report another project's manager as ours.
  it("asks tmux whether exactly the named session exists", () => {
    expect(buildHasSession(NAME)).toEqual(["has-session", "-t", `=${NAME}`]);
  });
});

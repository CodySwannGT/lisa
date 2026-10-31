/**
 * The session-manager notifications doctor check with no notification
 * channel (CodySwannGT/lisa#4555, part 1).
 *
 * Telegram is optional. With `notify.provider` `"none"`, or no `notify` block,
 * there is no bot token, state dir or plugin, so the check reports
 * "notifications: none" and skips every Telegram finding, while still checking
 * what matters either way: managed settings that override the manager's
 * `crossSessionInbound`. A `stateDir` without the telegram provider, or a
 * provider Lisa does not implement, fails the way the runtime validator
 * refuses it. Every run uses a temp HOME and injected environment, so the
 * operator's real `~/.claude` is never read.
 * @module tests/unit/cli/doctor-session-manager-notify
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkSessionManagerIsolation } from "../../../src/cli/doctor-session-manager.js";

const CHECK_NAME = "Session manager notifications?";
const NO_CHANNEL = "notifications: none";
const PLUGIN_ID = "telegram@claude-plugins-official";
const PLANTED = "987654321:PLANTED_VALUE_abcdefghijklmnopqrstuvwxyz";
const MANAGER = "p-manager";
const roots: string[] = [];

/** Paths of one isolated fixture. */
interface Fixture {
  readonly home: string;
  readonly project: string;
  readonly managed: string;
}

/**
 * Create a temp HOME and a project whose config holds `sessionManager`.
 * @param sessionManager - The `sessionManager` block
 * @returns The fixture paths
 */
async function fixture(
  sessionManager: Record<string, unknown>
): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-smn-"));
  const home = path.join(root, "home");
  const project = path.join(root, "proj");
  roots.push(root);
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, ".lisa.config.json"),
    JSON.stringify({ tracker: "jira", sessionManager })
  );
  return { home, project, managed: path.join(root, "managed.json") };
}

/**
 * Run the check with the fixture's HOME and an injected environment.
 * @param fx - Fixture
 * @param env - Environment visible to doctor
 * @returns The doctor check
 */
const run = (fx: Fixture, env: NodeJS.ProcessEnv = {}) =>
  checkSessionManagerIsolation(fx.project, {
    home: fx.home,
    env,
    managedSettingsPaths: [fx.managed],
  });

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

describe("session-manager doctor check with no notification channel", () => {
  it.each([
    ["an absent notify block", { name: MANAGER }],
    ['provider "none"', { name: MANAGER, notify: { provider: "none" } }],
  ])(
    "is ok with 'notifications: none' for %s, needing no token or state dir",
    async (_label, block) => {
      expect(await run(await fixture(block))).toEqual({
        name: CHECK_NAME,
        status: "ok",
        detail: NO_CHANNEL,
      });
    }
  );

  it("skips the Telegram requirements: a user-scope plugin and state-dir variable are fine", async () => {
    const fx = await fixture({ name: MANAGER });
    await writeFile(
      path.join(fx.home, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: true } })
    );

    const check = await run(fx, { TELEGRAM_STATE_DIR: "/somewhere" });

    expect(check).toMatchObject({ status: "ok", detail: NO_CHANNEL });
  });

  it("still warns on any plaintext bot token it finds, by name only", async () => {
    const fx = await fixture({ name: MANAGER });
    const shared = path.join(fx.home, ".claude", "channels", "telegram");
    await mkdir(shared, { recursive: true });
    const sharedToken = path.join(shared, ".env");
    await writeFile(sharedToken, `TELEGRAM_BOT_TOKEN=${PLANTED}\n`);

    const check = await run(fx, { TELEGRAM_BOT_TOKEN_P_MANAGER: PLANTED });

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_CHANNEL);
    expect(check.detail).toContain("TELEGRAM_BOT_TOKEN_P_MANAGER");
    expect(check.detail).toContain(sharedToken);
    expect(check.detail).not.toContain(PLANTED);
  });

  it("still checks managed crossSessionInbound", async () => {
    const fx = await fixture({ name: MANAGER });
    await writeFile(
      fx.managed,
      JSON.stringify({ crossSessionInbound: "deny" })
    );

    const check = await run(fx);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_CHANNEL);
    expect(check.detail).toContain("crossSessionInbound");
  });

  it.each([{ provider: "none" }, {}])(
    "fails for a notify.stateDir without the telegram provider (%j)",
    async extra => {
      const check = await run(
        await fixture({
          name: MANAGER,
          notify: { ...extra, stateDir: "~/.claude/channels/telegram-x" },
        })
      );

      expect(check.status).toBe("fail");
      expect(check.detail).toMatch(/notify\.stateDir/);
      expect(check.detail).toMatch(/provider/);
    }
  );

  it("fails for a provider it does not implement", async () => {
    const check = await run(
      await fixture({ name: MANAGER, notify: { provider: "slack" } })
    );

    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/"slack" is not supported/);
  });
});

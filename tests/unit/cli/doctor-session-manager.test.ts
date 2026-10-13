/**
 * Coverage for the session-manager Telegram isolation doctor check (#4448).
 *
 * Every finding runs against a temp HOME and an injected environment, so the
 * operator's real `~/.claude` is never read. Token files are only ever
 * stat-ed: the redaction test plants a recognisable token in both the file
 * and the environment and proves neither reaches the detail text.
 * @module tests/unit/cli/doctor-session-manager
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { checkSessionManagerIsolation } from "../../../src/cli/doctor-session-manager.js";

const CHECK_NAME = "Session manager Telegram isolation?";
const PLUGIN_ID = "telegram@claude-plugins-official";
const PLANTED = "987654321:PLANTED_VALUE_abcdefghijklmnopqrstuvwxyz";
const TOKEN_FILE = ".env";
const CONFIG_FILE = ".lisa.config.json";
const roots: string[] = [];

/** Paths of one isolated fixture. */
interface Fixture {
  readonly root: string;
  readonly home: string;
  readonly project: string;
  readonly stateDir: string;
  readonly managed: string;
}

/**
 * Create a temp HOME, project, and per-project state dir holding a 0600 token.
 * @param sessionManager - Optional `sessionManager` block override
 * @returns The fixture paths
 */
async function fixture(
  sessionManager?: Record<string, unknown> | null
): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-sm-"));
  const home = path.join(root, "home");
  const project = path.join(root, "proj");
  const stateDir = path.join(root, "state");
  const block =
    sessionManager === undefined
      ? { name: "p-manager", notify: { provider: "telegram", stateDir } }
      : sessionManager;
  const config = block === null ? {} : { sessionManager: block };
  roots.push(root);
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, TOKEN_FILE),
    `TELEGRAM_BOT_TOKEN=${PLANTED}\n`
  );
  await chmod(path.join(stateDir, TOKEN_FILE), 0o600);
  await writeFile(
    path.join(project, CONFIG_FILE),
    JSON.stringify({ tracker: "github", ...config })
  );
  return {
    root,
    home,
    project,
    stateDir,
    managed: path.join(root, "managed.json"),
  };
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

describe("session-manager doctor check", () => {
  it("is ok with 'not configured' when no sessionManager block exists", async () => {
    const check = await run(await fixture(null));

    expect(check).toEqual({
      name: CHECK_NAME,
      status: "ok",
      detail: "not configured",
    });
  });

  it("is ok when the per-project setup is isolated", async () => {
    const check = await run(await fixture());

    expect(check.status).toBe("ok");
    expect(check.name).toBe(CHECK_NAME);
  });

  it("fails when stateDir resolves to the shared default dir", async () => {
    const fx = await fixture({
      name: "p-manager",
      notify: {
        provider: "telegram",
        stateDir: "~/.claude/channels/telegram/",
      },
    });

    const check = await run(fx);

    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/shared default/);
  });

  it("fails against CLAUDE_CONFIG_DIR's shared default dir", async () => {
    const fx = await fixture();
    const configDir = path.join(fx.root, "cfg");
    await writeFile(
      path.join(fx.project, CONFIG_FILE),
      JSON.stringify({
        sessionManager: {
          notify: { stateDir: path.join(configDir, "channels", "telegram") },
        },
      })
    );

    const check = await run(fx, { CLAUDE_CONFIG_DIR: configDir });

    expect(check.status).toBe("fail");
  });

  it("fails when notify.stateDir is missing", async () => {
    const check = await run(await fixture({ name: "p-manager" }));

    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/notify\.stateDir is not set/);
  });

  it("uses the local config's stateDir over the committed one", async () => {
    const fx = await fixture({
      notify: { stateDir: "~/.claude/channels/telegram" },
    });
    await writeFile(
      path.join(fx.project, ".lisa.config.local.json"),
      JSON.stringify({ sessionManager: { notify: { stateDir: fx.stateDir } } })
    );

    expect((await run(fx)).status).toBe("ok");
  });

  it("warns when the plugin is enabled at user scope", async () => {
    const fx = await fixture();
    await writeFile(
      path.join(fx.home, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: true } })
    );

    const check = await run(fx);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      `claude plugin disable ${PLUGIN_ID} -s user`
    );
  });

  it("warns when the shared default dir holds a token file", async () => {
    const fx = await fixture();
    const shared = path.join(fx.home, ".claude", "channels", "telegram");
    await mkdir(shared, { recursive: true });
    await writeFile(
      path.join(shared, TOKEN_FILE),
      `TELEGRAM_BOT_TOKEN=${PLANTED}\n`
    );

    const check = await run(fx);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(path.join(shared, TOKEN_FILE));
  });

  it.each(["TELEGRAM_BOT_TOKEN", "TELEGRAM_STATE_DIR"])(
    "warns when %s is set in doctor's environment",
    async name => {
      const check = await run(await fixture(), { [name]: PLANTED });

      expect(check.status).toBe("warn");
      expect(check.detail).toContain(`${name} is set`);
    }
  );

  it.each([
    [{ crossSessionInbound: "deny" }, "warn"],
    [{ crossSessionInbound: "accept" }, "ok"],
    [{}, "ok"],
  ])("checks managed crossSessionInbound %j", async (settings, status) => {
    const fx = await fixture();
    await writeFile(fx.managed, JSON.stringify(settings));

    expect((await run(fx)).status).toBe(status);
  });

  it("warns when the per-project token file is missing", async () => {
    const fx = await fixture();
    await rm(path.join(fx.stateDir, TOKEN_FILE));

    const check = await run(fx);

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/missing/);
  });

  it.each([0o640, 0o604])(
    "warns when the token file mode is %o",
    async mode => {
      const fx = await fixture();
      await chmod(path.join(fx.stateDir, TOKEN_FILE), mode);

      const check = await run(fx);

      expect(check.status).toBe("warn");
      expect(check.detail).toContain("chmod 600");
    }
  );

  it("never puts the token value in the detail", async () => {
    const fx = await fixture();
    const shared = path.join(fx.home, ".claude", "channels", "telegram");
    await mkdir(shared, { recursive: true });
    await writeFile(
      path.join(shared, TOKEN_FILE),
      `TELEGRAM_BOT_TOKEN=${PLANTED}\n`
    );
    await chmod(path.join(fx.stateDir, TOKEN_FILE), 0o644);

    const check = await run(fx, {
      TELEGRAM_BOT_TOKEN: PLANTED,
      TELEGRAM_STATE_DIR: PLANTED,
    });

    expect(check.detail).not.toContain(PLANTED);
    expect(check.detail).not.toContain("PLANTED_VALUE");
  });

  it("is wired into runDoctor right after the Kane check", async () => {
    const fx = await fixture();
    const result = await runDoctor(
      fx.project,
      { offline: true },
      {
        env: { HOME: fx.home },
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        setExitCode: vi.fn(),
      }
    );
    const names = result.checks.map(check => check.name);

    expect(names.indexOf(CHECK_NAME)).toBe(
      names.indexOf("Kane browser provider ready?") + 1
    );
  });

  it("passes --offline through, so runDoctor never runs the gh visibility probe", async () => {
    const fx = await fixture();
    await writeFile(
      path.join(fx.project, CONFIG_FILE),
      JSON.stringify({
        tracker: "github",
        github: { org: "example-org", repo: "demo-repo" },
        sessionManager: {
          name: "p-manager",
          notify: { provider: "telegram", stateDir: fx.stateDir },
        },
      })
    );
    const result = await runDoctor(
      fx.project,
      { offline: true },
      {
        env: { HOME: fx.home },
        runUpdateCheck: vi.fn(),
        write: vi.fn(),
        setExitCode: vi.fn(),
      }
    );
    const check = result.checks.find(entry => entry.name === CHECK_NAME);

    expect(check?.detail ?? "").toContain("visibility not checked (offline)");
    expect(check?.detail ?? "").not.toContain("could not read the visibility");
  });
});

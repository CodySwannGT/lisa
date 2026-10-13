/**
 * Coverage for the trust findings of the session-manager doctor check
 * (CodySwannGT/lisa#4448 review).
 *
 * - A public GitHub repo with no `sessionManager.trustedAuthorIds` lets anyone
 *   on the internet write the work a bypass-permissions worker runs: fail.
 *   Visibility comes from an injected probe; when the probe cannot run the
 *   check warns and says why instead of guessing.
 * - The Telegram plugin enabled in a project-scope settings file (at the root
 *   or in a routed child repo) makes every session there poll the bot: warn.
 * Every run uses a temp HOME and an injected probe, so no real `gh` call or
 * `~/.claude` read happens.
 * @module tests/unit/cli/doctor-session-manager-trust
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkSessionManagerIsolation } from "../../../src/cli/doctor-session-manager.js";

const PLUGIN_ID = "telegram@claude-plugins-official";
const REPO = "example-org/demo-repo";
const PRIVATE = "PRIVATE";
const CLAUDE_DIR = ".claude";
const LOCAL_SETTINGS = "settings.local.json";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

/** Paths of one isolated fixture. */
interface Fixture {
  readonly home: string;
  readonly project: string;
}

/**
 * A temp HOME and a GitHub-tracked project with an isolated, valid setup.
 * @param extra - Keys merged into the `sessionManager` block
 * @param tracker - Configured tracker
 * @returns Fixture paths
 */
async function fixture(
  extra: Record<string, unknown> = {},
  tracker = "github"
): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-smt-"));
  const home = path.join(root, "home");
  const project = path.join(root, "proj");
  const stateDir = path.join(root, "state");
  roots.push(root);
  await mkdir(path.join(home, CLAUDE_DIR), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, ".env"), "x\n");
  await chmod(path.join(stateDir, ".env"), 0o600);
  await writeFile(
    path.join(project, ".lisa.config.json"),
    JSON.stringify({
      tracker,
      github: { org: "example-org", repo: "demo-repo" },
      sessionManager: {
        name: "p-manager",
        notify: { provider: "telegram", stateDir },
        ...extra,
      },
    })
  );
  return { home, project };
}

/**
 * Run the check with an injected visibility probe.
 * @param fx - Fixture
 * @param probe - Visibility probe
 * @returns Doctor check
 */
const run = (fx: Fixture, probe: (repo: string) => Promise<string>) =>
  checkSessionManagerIsolation(fx.project, {
    home: fx.home,
    env: {},
    managedSettingsPaths: [],
    probeRepoVisibility: probe,
  });

describe("public repo without trustedAuthorIds", () => {
  it("fails for a public GitHub repo with trustedAuthorIds unset", async () => {
    const probe = vi.fn(async () => "PUBLIC");
    const check = await run(await fixture(), probe);
    expect(probe).toHaveBeenCalledWith(REPO);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("trustedAuthorIds");
    expect(check.detail).toContain(REPO);
  });

  it("fails for a public GitHub repo whose trustedAuthorIds is an empty list", async () => {
    const probe = vi.fn(async () => "PUBLIC");
    const check = await run(await fixture({ trustedAuthorIds: [] }), probe);
    expect(probe).toHaveBeenCalledWith(REPO);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("trustedAuthorIds");
  });

  it("is ok for a private repo", async () => {
    const check = await run(await fixture(), async () => PRIVATE);
    expect(check.status).toBe("ok");
  });

  it("is ok for a public repo once trustedAuthorIds is set, without probing", async () => {
    const probe = vi.fn(async () => "PUBLIC");
    const check = await run(
      await fixture({ trustedAuthorIds: ["owner"] }),
      probe
    );
    expect(check.status).toBe("ok");
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not probe when the tracker is not github", async () => {
    const probe = vi.fn(async () => "PUBLIC");
    const check = await run(await fixture({}, "jira"), probe);
    expect(check.status).toBe("ok");
    expect(probe).not.toHaveBeenCalled();
  });

  it("warns, saying why, when visibility cannot be probed", async () => {
    const check = await run(await fixture(), async () => {
      throw new Error("gh: not logged in");
    });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("could not read the visibility");
    expect(check.detail).toContain("gh: not logged in");
  });

  it("never probes in offline mode and warns that visibility was not checked", async () => {
    const probe = vi.fn(async () => PRIVATE);
    const fx = await fixture();
    const check = await checkSessionManagerIsolation(
      fx.project,
      {
        home: fx.home,
        env: {},
        managedSettingsPaths: [],
        probeRepoVisibility: probe,
      },
      { offline: true }
    );
    expect(probe).not.toHaveBeenCalled();
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("visibility not checked (offline)");
    expect(check.detail).toContain(REPO);
    expect(check.detail).toContain("trustedAuthorIds");
  });

  it("stays quiet offline once trustedAuthorIds is set", async () => {
    const probe = vi.fn(async () => "PUBLIC");
    const fx = await fixture({ trustedAuthorIds: ["owner"] });
    const check = await checkSessionManagerIsolation(
      fx.project,
      {
        home: fx.home,
        env: {},
        managedSettingsPaths: [],
        probeRepoVisibility: probe,
      },
      { offline: true }
    );
    expect(probe).not.toHaveBeenCalled();
    expect(check.status).toBe("ok");
  });
});

describe("Telegram plugin enabled at project scope", () => {
  /**
   * Enable the plugin in one settings file.
   * @param dir - Directory holding `.claude/`
   * @param file - settings.json or settings.local.json
   */
  async function enableIn(dir: string, file: string): Promise<void> {
    await mkdir(path.join(dir, CLAUDE_DIR), { recursive: true });
    await writeFile(
      path.join(dir, CLAUDE_DIR, file),
      JSON.stringify({ enabledPlugins: { [PLUGIN_ID]: true } })
    );
  }

  it.each(["settings.json", LOCAL_SETTINGS])(
    "warns for the project root's .claude/%s",
    async file => {
      const fx = await fixture();
      await enableIn(fx.project, file);
      const check = await run(fx, async () => PRIVATE);
      expect(check.status).toBe("warn");
      expect(check.detail).toContain(path.join(fx.project, CLAUDE_DIR, file));
    }
  );

  it("warns for a routed child repo's settings", async () => {
    const fx = await fixture({
      repos: { root: "projects", entries: { api: { hints: ["api"] } } },
    });
    const child = path.join(fx.project, "projects", "api");
    await enableIn(child, LOCAL_SETTINGS);
    const check = await run(fx, async () => PRIVATE);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      path.join(child, CLAUDE_DIR, LOCAL_SETTINGS)
    );
  });
});

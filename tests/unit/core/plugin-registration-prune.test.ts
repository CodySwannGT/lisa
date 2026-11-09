/**
 * Claude Code records one project-scope registration per checkout path, and
 * nothing removed them when a worktree was deleted, so they accumulated without
 * bound (CodySwannGT/lisa#4645). `lisa apply` now uninstalls Lisa's own
 * registrations for paths that no longer exist — and only those.
 *
 * The CLI is stubbed; the filesystem is real so the test proves that only the
 * directories the prune itself created are removed again.
 * @module tests/unit/core/plugin-registration-prune
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneDeadPluginRegistrations } from "../../../src/core/plugin-registration-prune.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** One recorded CLI call. */
interface Call {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cwdExisted: boolean;
}

/** Collects warn/info/success lines. */
interface Lines {
  readonly warn: string[];
  readonly info: string[];
}

describe("pruneDeadPluginRegistrations", () => {
  let root: string;
  let live: string;
  let calls: Call[];
  let lines: Lines;

  beforeEach(async () => {
    root = await createTempDir();
    live = path.join(root, "live");
    mkdirSync(live);
    calls = [];
    lines = { warn: [], info: [] };
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Build deps around a stubbed CLI whose list output is `registry`.
   * @param registry - Entries returned by `claude plugin list --json`
   * @param failUninstall - Whether uninstall commands fail
   * @returns Prune dependencies
   */
  function deps(registry: unknown, failUninstall = false) {
    return {
      runClaude: async (args: readonly string[], cwd: string) => {
        calls.push({ args, cwd, cwdExisted: existsSync(cwd) });
        if (args[1] === "uninstall" && failUninstall)
          throw new Error("uninstall failed");
        return {
          stdout: args[1] === "list" ? JSON.stringify(registry) : "",
        };
      },
      logger: {
        warn: (m: string) => lines.warn.push(m),
        info: (m: string) => lines.info.push(m),
        success: (m: string) => lines.info.push(m),
      },
    };
  }

  /**
   * Uninstall calls actually issued.
   * @returns `id @ cwd` strings
   */
  function uninstalls(): string[] {
    return calls
      .filter(c => c.args[1] === "uninstall")
      .map(c => `${c.args[2]} @ ${c.cwd}`);
  }

  it("uninstalls only dead-path @lisa project registrations, from that path", async () => {
    const dead = path.join(root, "gone", "wt");
    const registry = [
      { id: "lisa@lisa", scope: "project", projectPath: dead },
      { id: "lisa-cdk@lisa", scope: "project", projectPath: dead },
      { id: "lisa@lisa", scope: "project", projectPath: live },
      {
        id: "coderabbit@claude-plugins-official",
        scope: "project",
        projectPath: dead,
      },
      { id: "lisa@lisa", scope: "user" },
      { id: "lisa@lisa", scope: "local", projectPath: dead },
    ];

    const outcome = await pruneDeadPluginRegistrations(live, deps(registry));

    expect(uninstalls()).toEqual([
      `lisa@lisa @ ${dead}`,
      `lisa-cdk@lisa @ ${dead}`,
    ]);
    const uninstall = calls.find(c => c.args[1] === "uninstall");
    expect(uninstall?.args).toEqual([
      "plugin",
      "uninstall",
      "lisa@lisa",
      "--scope",
      "project",
      "--keep-data",
    ]);
    expect(
      calls.filter(c => c.args[1] === "uninstall").every(c => c.cwdExisted)
    ).toBe(true);
    expect(outcome).toEqual({ pruned: 2, failed: 0, deferred: 0 });
    expect(lines.info.join("\n")).toContain("2");
    // The recreated directories are gone again; the live path and root stay.
    expect(existsSync(path.join(root, "gone"))).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it("does nothing when no @lisa registration points at a missing path", async () => {
    const outcome = await pruneDeadPluginRegistrations(
      live,
      deps([{ id: "lisa@lisa", scope: "project", projectPath: live }])
    );
    expect(uninstalls()).toEqual([]);
    expect(outcome).toEqual({ pruned: 0, failed: 0, deferred: 0 });
    expect(lines.warn).toEqual([]);
  });

  it("reports the count and the manual command when the CLI cannot remove them", async () => {
    const dead = path.join(root, "gone");
    const outcome = await pruneDeadPluginRegistrations(
      live,
      deps([{ id: "lisa@lisa", scope: "project", projectPath: dead }], true)
    );
    expect(outcome).toEqual({ pruned: 0, failed: 1, deferred: 0 });
    expect(lines.warn.join("\n")).toContain("1");
    expect(lines.warn.join("\n")).toContain(
      "claude plugin uninstall 'lisa@lisa' --scope project"
    );
    expect(existsSync(dead)).toBe(false);
  });

  it("quotes a dead path containing a single quote in the manual command", async () => {
    const dead = path.join(root, "it's-gone");
    const escapedDead = dead.replaceAll("'", String.raw`'\''`);
    await pruneDeadPluginRegistrations(
      live,
      deps([{ id: "lisa@lisa", scope: "project", projectPath: dead }], true)
    );
    expect(lines.warn.join("\n")).toContain(`mkdir -p '${escapedDead}'`);
  });

  it("reports instead of failing when the dead path cannot be recreated", async () => {
    const blocker = path.join(root, "file");
    writeFileSync(blocker, "x");
    const outcome = await pruneDeadPluginRegistrations(
      live,
      deps([
        {
          id: "lisa@lisa",
          scope: "project",
          projectPath: path.join(blocker, "wt"),
        },
      ])
    );
    expect(uninstalls()).toEqual([]);
    expect(outcome).toEqual({ pruned: 0, failed: 1, deferred: 0 });
    expect(lines.warn.length).toBeGreaterThan(0);
  });

  it("leaves a recreated directory in place when the CLI wrote into it", async () => {
    const dead = path.join(root, "gone");
    const d = deps([{ id: "lisa@lisa", scope: "project", projectPath: dead }]);
    const outcome = await pruneDeadPluginRegistrations(live, {
      ...d,
      runClaude: async (args: readonly string[], cwd: string) => {
        if (args[1] === "uninstall") writeFileSync(path.join(cwd, "note"), "");
        return d.runClaude(args, cwd);
      },
    });
    expect(outcome.pruned).toBe(1);
    expect(existsSync(path.join(dead, "note"))).toBe(true);
  });

  it("warns instead of silently doing nothing when the list is unparseable", async () => {
    const outcome = await pruneDeadPluginRegistrations(live, {
      ...deps([]),
      runClaude: async () => ({ stdout: "not json" }),
    });
    expect(outcome).toEqual({ pruned: 0, failed: 0, deferred: 0 });
    expect(lines.warn.join("\n")).toContain("claude plugin list --json");
  });

  it("warns when the list command itself fails (e.g. output over the capture limit)", async () => {
    const outcome = await pruneDeadPluginRegistrations(live, {
      ...deps([]),
      runClaude: async () => {
        throw new Error("Plugin command output exceeded capture limit");
      },
    });
    expect(outcome).toEqual({ pruned: 0, failed: 0, deferred: 0 });
    expect(lines.warn).toHaveLength(1);
    expect(lines.warn[0]).toContain(
      "Could not read the Claude plugin registry"
    );
  });

  it("stops starting new paths once the budget is spent and reports them as deferred", async () => {
    const paths = ["a", "b", "c"].map(name => path.join(root, `gone-${name}`));
    const d = deps(
      paths.map(projectPath => ({
        id: "lisa@lisa",
        scope: "project",
        projectPath,
      }))
    );
    const outcome = await pruneDeadPluginRegistrations(live, {
      ...d,
      // Spent after the first uninstall has run.
      deadlineReached: () => uninstalls().length >= 1,
    });

    expect(uninstalls()).toEqual([`lisa@lisa @ ${paths[0]}`]);
    expect(outcome).toEqual({ pruned: 1, failed: 0, deferred: 2 });
    expect(lines.info.join("\n")).toContain("Deferred 2");
    expect(lines.warn).toEqual([]);
    // Deferred paths are never recreated.
    expect(paths.some(projectPath => existsSync(projectPath))).toBe(false);
  });

  it("defers, not fails, the remaining ids of a path once the budget is spent", async () => {
    const dead = path.join(root, "gone");
    const d = deps([
      { id: "lisa@lisa", scope: "project", projectPath: dead },
      { id: "lisa-cdk@lisa", scope: "project", projectPath: dead },
    ]);
    const outcome = await pruneDeadPluginRegistrations(live, {
      ...d,
      deadlineReached: () => uninstalls().length >= 1,
    });
    expect(outcome).toEqual({ pruned: 1, failed: 0, deferred: 1 });
    expect(existsSync(dead)).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)(
    "warns instead of throwing when a recreated directory cannot be removed",
    async () => {
      const parent = path.join(root, "locked");
      mkdirSync(parent);
      const dead = path.join(parent, "wt");
      const d = deps([
        { id: "lisa@lisa", scope: "project", projectPath: dead },
      ]);
      try {
        const outcome = await pruneDeadPluginRegistrations(live, {
          ...d,
          runClaude: async (args: readonly string[], cwd: string) => {
            // Removing `wt` needs write access to its parent.
            if (args[1] === "uninstall") chmodSync(parent, 0o555);
            return d.runClaude(args, cwd);
          },
        });
        expect(outcome.pruned).toBe(1);
        expect(lines.warn.join("\n")).toContain("Left");
      } finally {
        chmodSync(parent, 0o755);
      }
    }
  );
});

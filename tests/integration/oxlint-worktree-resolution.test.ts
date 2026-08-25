/**
 * End-to-end proof for issue #2465: a Lisa-managed project must be able to lint
 * — and therefore commit — inside a fresh `git worktree` that has no
 * worktree-local `node_modules`.
 *
 * This exercises the real path rather than a simulation: the real stack
 * templates, the real vendoring migration, a real `git worktree`, and the real
 * `oxlint` binary running the same `--fix` invocation `.lintstagedrc.json`
 * issues from the husky pre-commit hook.
 */
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../src/core/config.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { EnsureOxlintBaseConfigsMigration } from "../../src/migrations/ensure-oxlint-base-configs.js";
import {
  boundedExecFileSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { resolveGit } from "../support/git-executable.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OXLINT_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "oxlint");
/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = resolveGit();

/** Stacks that ship a managed `.oxlintrc.json`. */
const STACKS = [
  "typescript",
  "cdk",
  "expo",
  "nestjs",
  "phaser",
  "harper-fabric",
] as const;

/** Outcome of running oxlint in a directory. */
interface LintOutcome {
  readonly code: number;
  readonly output: string;
}

/**
 * Run git with the ambient GIT_* environment stripped so an outer repository
 * (or an outer worktree) cannot leak into the fixture.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 */
function git(cwd: string, ...args: readonly string[]): void {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT_BIN,
    args,
    cwd,
    env,
    stdio: "pipe",
  });
}

/**
 * Run oxlint exactly as lint-staged does from the pre-commit hook.
 * @param cwd - Directory to lint in
 * @returns Exit code and combined output
 */
function runOxlint(cwd: string): LintOutcome {
  try {
    const output = boundedExecFileSync({
      label: "oxlint --fix in the worktree",
      command: OXLINT_BIN,
      args: ["--fix", "--no-error-on-unmatched-pattern", "src.ts"],
      baseMs: 30_000,
      cwd,
      stdio: "pipe",
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.exitCode ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("oxlint resolves its config in a fresh git worktree (#2465)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-oxlint-wt-"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  /**
   * Build a Lisa-managed host repo for a stack and add a worktree to it.
   * @param stack - Stack template to apply
   * @param legacyExtends - When set, override extends to the pre-fix path
   * @returns Absolute paths of the host clone and its worktree
   */
  async function buildHostAndWorktree(
    stack: string,
    legacyExtends?: string
  ): Promise<{ readonly host: string; readonly worktree: string }> {
    const host = path.join(tempDir, `host-${stack}`);
    const worktree = path.join(tempDir, `wt-${stack}`);
    await fs.ensureDir(host);

    // A Lisa-managed host has @codyswann/lisa installed in its node_modules.
    await fs.ensureDir(path.join(host, "node_modules", "@codyswann"));
    await fs.ensureSymlink(
      REPO_ROOT,
      path.join(host, "node_modules", "@codyswann", "lisa"),
      "dir"
    );
    await fs.writeFile(path.join(host, ".gitignore"), "node_modules/\n");
    await fs.writeFile(path.join(host, "src.ts"), "export const a = 1;\n");

    // The exact `.oxlintrc.json` that `lisa apply` merges into the host.
    const template = (await fs.readJson(
      path.join(REPO_ROOT, stack, "merge", ".oxlintrc.json")
    )) as Record<string, unknown>;
    await fs.writeJson(
      path.join(host, ".oxlintrc.json"),
      legacyExtends ? { ...template, extends: [legacyExtends] } : template,
      { spaces: 2 }
    );

    if (!legacyExtends) {
      await new EnsureOxlintBaseConfigsMigration().apply({
        projectDir: host,
        lisaDir: REPO_ROOT,
        detectedTypes: [stack as ProjectType],
        dryRun: false,
        logger: new SilentLogger(),
      });
    }

    git(host, "init", "-q", ".");
    git(host, "config", "user.email", "test@example.com");
    git(host, "config", "user.name", "test");
    git(host, "config", "commit.gpgsign", "false");
    git(host, "add", "-A");
    git(host, "commit", "-qm", "init");
    git(host, "worktree", "add", "-q", "-b", "wt", worktree);

    return { host, worktree };
  }

  it("control: the pre-fix node_modules extends path fails in a worktree", async () => {
    const { host, worktree } = await buildHostAndWorktree(
      "typescript",
      "./node_modules/@codyswann/lisa/oxlint/typescript.json"
    );

    // The bug is invisible in the clone that has node_modules...
    expect(runOxlint(host).code).toBe(0);

    // ...and fatal in the worktree, which by construction has none.
    expect(await fs.pathExists(path.join(worktree, "node_modules"))).toBe(
      false
    );
    const result = runOxlint(worktree);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain(
      "Failed to parse oxlint configuration file"
    );
  });

  it.each(STACKS)(
    "%s: the shipped template lints cleanly in a worktree with no node_modules",
    async stack => {
      const { worktree } = await buildHostAndWorktree(stack);

      expect(await fs.pathExists(path.join(worktree, "node_modules"))).toBe(
        false
      );
      // The vendored configs are tracked, so the worktree checkout has them.
      expect(
        await fs.pathExists(path.join(worktree, ".lisa", "lisa-oxlint"))
      ).toBe(true);

      const result = runOxlint(worktree);
      expect(result.output).not.toContain("Failed to parse oxlint");
      expect(result.code).toBe(0);
    },
    ioLatencyBudgetMs(30_000)
  );
});

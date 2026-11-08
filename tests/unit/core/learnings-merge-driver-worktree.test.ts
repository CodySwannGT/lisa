/**
 * The learnings merge driver must survive removing the worktree that
 * registered it (CodySwannGT/lisa#4640).
 *
 * `git config --local` writes `.git/config`, which every linked worktree of a
 * repository SHARES. A registration that names one checkout's absolute paths
 * therefore points every worktree's merges into that checkout — and once it is
 * removed, git reports a conflict but leaves the ledger as our side only, with
 * NO conflict markers. Staging that file silently drops the other branch's
 * learnings, the exact loss the driver exists to prevent.
 *
 * These tests drive real `git worktree` and `git merge` invocations. Lisa is
 * "installed" in a worktree by a shim at the host-layout entry path
 * (`node_modules/@codyswann/lisa/dist/index.js`) that forwards to this
 * checkout's real CLI, so the union merge that runs is Lisa's own.
 */
import * as fs from "fs-extra";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installLearningsMergeDriver } from "../../../src/core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../../../src/core/learnings-merge-driver.js";
import {
  renderLearningsFile,
  type LearningEntry,
} from "../../../src/core/learnings.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const HOST_ENTRY = "node_modules/@codyswann/lisa/dist/index.js";
const CLI_ENTRY = path.resolve("src/index.ts");
const THEIR_BRANCH = "learning/theirs";
const SHARED = "shared";
const FROM_OURS = "from-ours";
const FROM_THEIRS = "from-theirs";

const GIT = resolveGit();

/**
 * Environment without the outer repository's git hook state.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Run one git command.
 * @param cwd - Working directory
 * @param args - Git arguments
 * @returns Captured stdout
 */
function git(cwd: string, ...args: readonly string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd,
    env: cleanGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Build one valid entry.
 * @param id - Stable entry id
 * @returns Valid learning entry
 */
function entry(id: string): LearningEntry {
  return {
    id,
    fingerprint: `${id}-fingerprint`,
    rule: `Rule for ${id}.`,
    why: `Reason for ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-11-07",
    last_confirmed: "2026-11-07",
    confidence: "high",
  };
}

/** A shim body that forwards to this checkout's real Lisa CLI. */
const FORWARD_TO_LISA = [
  `const { spawnSync } = require("node:child_process");`,
  `const run = spawnSync("bun", [${JSON.stringify(CLI_ENTRY)}, ...process.argv.slice(2)], { stdio: "inherit" });`,
  `process.exit(run.status ?? 1);`,
  "",
].join("\n");

/**
 * Install a Lisa stand-in at the host-layout entry path of one checkout.
 * @param checkout - Worktree root to install into
 * @param body - Entry script source; defaults to forwarding to the real CLI
 * @returns Absolute path of the installed entry
 */
async function installLisaShim(
  checkout: string,
  body: string = FORWARD_TO_LISA
): Promise<string> {
  const entryPath = path.join(checkout, HOST_ENTRY);
  await fs.outputFile(
    path.join(path.dirname(entryPath), "..", "package.json"),
    JSON.stringify({ name: "@codyswann/lisa", type: "commonjs" })
  );
  await fs.outputFile(entryPath, body);
  return entryPath;
}

/**
 * Register the driver the way `lisa apply` does when Lisa runs from `entry`.
 *
 * `process.argv[1]` is what a running Lisa CLI reports as its own entry
 * script, so it is pointed at the checkout's installed Lisa for the duration
 * of the install — the state of a real `lisa apply` run from that checkout.
 * @param checkout - Checkout running the apply
 * @param entryPath - Absolute entry script of the Lisa doing the apply
 */
async function applyFrom(checkout: string, entryPath: string): Promise<void> {
  const original = process.argv[1];
  process.argv[1] = entryPath;
  try {
    const result = await installLearningsMergeDriver(checkout);
    expect(result.kind).toBe("installed");
  } finally {
    process.argv[1] = original as string;
  }
}

describe("learnings merge driver across linked worktrees", () => {
  let root: string;
  let primary: string;

  /**
   * Commit the ledger with the supplied entries on the current branch.
   * @param ids - Entry ids to persist
   * @param message - Commit message
   */
  async function commitLedger(
    ids: readonly string[],
    message: string
  ): Promise<void> {
    await fs.outputFile(
      path.join(primary, LEDGER),
      renderLearningsFile(ids.map(entry))
    );
    git(primary, "add", LEDGER);
    git(primary, "commit", "-m", message);
  }

  /**
   * Diverge two branches that each add one entry, then merge them in primary.
   * @returns Whether git reported a clean merge
   */
  async function mergeDivergentLearnings(): Promise<boolean> {
    git(primary, "checkout", "-b", THEIR_BRANCH);
    await commitLedger([SHARED, FROM_THEIRS], "theirs");
    git(primary, "checkout", "main");
    await commitLedger([SHARED, FROM_OURS], "ours");
    try {
      git(primary, "merge", THEIR_BRANCH, "-m", "merge");
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "lisa-driver-worktrees-"))
    );
    primary = path.join(root, "primary");
    await fs.ensureDir(primary);
    git(primary, "init", "--initial-branch=main");
    git(primary, "config", "user.email", "test@example.com");
    git(primary, "config", "user.name", "Test");
    await fs.outputFile(
      path.join(primary, ".gitignore"),
      "node_modules/\n*.lisa-conflict.*\n"
    );
    await fs.outputFile(
      path.join(primary, ".gitattributes"),
      `${LEDGER} merge=${LEARNINGS_MERGE_DRIVER_NAME}\n`
    );
    git(primary, "add", ".gitignore", ".gitattributes");
    await commitLedger([SHARED], "base");
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it("keeps unioning after the worktree that ran apply is removed", async () => {
    const linked = path.join(root, "linked");
    git(primary, "worktree", "add", linked, "-b", "upgrade");
    await applyFrom(linked, await installLisaShim(linked));
    git(primary, "worktree", "remove", "--force", linked);
    await installLisaShim(primary);

    const clean = await mergeDivergentLearnings();

    const content = await fs.readFile(path.join(primary, LEDGER), "utf8");
    expect(content).toContain(FROM_OURS);
    expect(content).toContain(FROM_THEIRS);
    expect(clean).toBe(true);
  });

  it("leaves conflict markers holding both sides when installed Lisa crashes", async () => {
    // An entry that exists but cannot run — pruned dependencies, a runtime
    // too old for the build — exits non-zero without touching %A. Handing
    // that straight back to git is the markerless ours-only file again.
    await applyFrom(
      primary,
      await installLisaShim(primary, "process.exit(1);\n")
    );

    const clean = await mergeDivergentLearnings();

    expect(clean).toBe(false);
    const content = await fs.readFile(path.join(primary, LEDGER), "utf8");
    expect(content).toContain("<<<<<<<");
    expect(content).toContain(FROM_OURS);
    expect(content).toContain(FROM_THEIRS);
    const leftovers = (await fs.readdir(primary)).filter(name =>
      /lisa-(?:snapshot|handled|conflict)/u.test(name)
    );
    expect(leftovers).toEqual([]);
  });

  it("keeps Lisa's own parseable conflict when both branches rewrote one entry", async () => {
    // merge-learnings deliberately leaves ours untouched (no markers) on a
    // real semantic conflict, with the reason on stderr. The crash fallback
    // must not override that decision.
    await applyFrom(primary, await installLisaShim(primary));
    git(primary, "checkout", "-b", THEIR_BRANCH);
    await fs.outputFile(
      path.join(primary, LEDGER),
      renderLearningsFile([{ ...entry(SHARED), rule: "Their rewrite." }])
    );
    git(primary, "commit", "-am", "theirs");
    git(primary, "checkout", "main");
    await fs.outputFile(
      path.join(primary, LEDGER),
      renderLearningsFile([{ ...entry(SHARED), rule: "Our rewrite." }])
    );
    git(primary, "commit", "-am", "ours");

    expect(() => git(primary, "merge", THEIR_BRANCH, "-m", "merge")).toThrow();
    const content = await fs.readFile(path.join(primary, LEDGER), "utf8");
    expect(content).not.toContain("<<<<<<<");
    expect(content).toContain("Our rewrite.");
  });

  it("leaves conflict markers holding both sides when Lisa is missing here", async () => {
    await applyFrom(primary, path.join(primary, HOST_ENTRY));

    const clean = await mergeDivergentLearnings();

    expect(clean).toBe(false);
    const content = await fs.readFile(path.join(primary, LEDGER), "utf8");
    expect(content).toContain("<<<<<<<");
    expect(content).toContain(">>>>>>>");
    expect(content).toContain(FROM_OURS);
    expect(content).toContain(FROM_THEIRS);
  });
});

/**
 * End-to-end proof that the union merge driver resolves the real git-layer
 * collision described in CodySwannGT/lisa#1995.
 *
 * Each learner pass runs on its own `learning/<fingerprint>` branch, so the
 * corruption is produced by git merging two branches that both rewrote the
 * JSONL block. These tests drive actual `git merge` invocations: first proving
 * the default driver conflicts (the bug), then proving the registered union
 * driver merges cleanly without resurrecting a superseded entry.
 */
import * as fs from "fs-extra";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNINGS_MERGE_DRIVER_NAME,
  buildLearningsMergeDriverCommand,
} from "../../../src/core/learnings-merge-driver.js";
import {
  renderLearningsFile,
  type LearningEntry,
} from "../../../src/core/learnings.js";

const LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const CLI_ENTRY = path.resolve("src/index.ts");
/** Branch name standing in for a real `learning/<fingerprint>` pass. */
const THEIR_BRANCH = "learning/theirs";
const SHARED = "shared";
const FROM_THEIRS = "from-theirs";

/**
 * Resolve git to an absolute executable path by scanning `PATH` on the
 * filesystem. Avoids invoking a bare command name, so the fixture never depends
 * on the ambient PATH resolution of a spawned shell.
 * @returns Absolute path to the git executable
 */
function resolveGit(): string {
  const candidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(directory => directory !== "")
    .map(directory => path.join(directory, "git"));
  const found = candidates.find(candidate => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (found === undefined) {
    throw new Error("git executable not found on PATH");
  }
  return found;
}

const GIT = resolveGit();

/**
 * Environment without the outer repository's git hook state.
 *
 * Lisa's own hooks export `GIT_DIR` / `GIT_WORK_TREE`, which would silently
 * redirect every fixture command back at the real repository — the failure mode
 * where a test passes standalone and fails under `pre-push`.
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
 * Build one valid entry.
 * @param id - Stable entry id
 * @returns Valid learning entry
 */
function entry(id: string): LearningEntry {
  return {
    id,
    rule: `Rule for ${id}.`,
    why: `Reason for ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "high",
  };
}

describe("learnings union merge driver", () => {
  let repo: string;

  /**
   * Run one git command inside the fixture repository.
   * @param args - Git arguments
   * @returns Captured stdout
   */
  function git(...args: readonly string[]): string {
    return execFileSync(GIT, [...args], {
      cwd: repo,
      env: cleanGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

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
      path.join(repo, LEDGER),
      renderLearningsFile(ids.map(entry))
    );
    git("add", LEDGER);
    git("commit", "-m", message);
  }

  /**
   * Read the ledger's entry ids from the working tree.
   * @returns Entry ids currently on disk
   */
  async function ledgerIds(): Promise<readonly string[]> {
    const content = await fs.readFile(path.join(repo, LEDGER), "utf8");
    return content
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => (JSON.parse(line) as LearningEntry).id);
  }

  /** Register the union driver in the fixture repository's local git config. */
  function registerDriver(): void {
    git(
      "config",
      `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`,
      buildLearningsMergeDriverCommand(`bun ${CLI_ENTRY}`)
    );
  }

  /** Declare the ledger as union-merged in the fixture's .gitattributes. */
  async function declareAttribute(): Promise<void> {
    await fs.outputFile(
      path.join(repo, ".gitattributes"),
      `${LEDGER} merge=${LEARNINGS_MERGE_DRIVER_NAME}\n`
    );
  }

  /**
   * Diverge two branches from a common base and merge them.
   * @param base - Entry ids at the merge base
   * @param ours - Entry ids on the branch being merged into
   * @param theirs - Entry ids on the incoming branch
   * @returns Whether git reported a clean merge
   */
  async function mergeBranches(
    base: readonly string[],
    ours: readonly string[],
    theirs: readonly string[]
  ): Promise<boolean> {
    await commitLedger(base, "base");
    git("checkout", "-b", THEIR_BRANCH);
    await commitLedger(theirs, "theirs");
    git("checkout", "main");
    await commitLedger(ours, "ours");
    try {
      git("merge", THEIR_BRANCH, "-m", "merge");
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-merge-driver-"));
    git("init", "--initial-branch=main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
  });

  afterEach(async () => {
    await fs.remove(repo);
  });

  it("conflicts under git's default driver (the reported bug)", async () => {
    const clean = await mergeBranches(
      [SHARED],
      [SHARED, "from-ours"],
      [SHARED, FROM_THEIRS]
    );
    expect(clean).toBe(false);
    const content = await fs.readFile(path.join(repo, LEDGER), "utf8");
    expect(content).toContain("<<<<<<<");
  });

  it("merges both branches' captures when the union driver is registered", async () => {
    await declareAttribute();
    registerDriver();
    const clean = await mergeBranches(
      [SHARED],
      [SHARED, "from-ours"],
      [SHARED, FROM_THEIRS]
    );
    expect(clean).toBe(true);
    expect(await ledgerIds()).toEqual(["from-ours", FROM_THEIRS, SHARED]);
  });

  it("does not resurrect an entry our branch superseded", async () => {
    await declareAttribute();
    registerDriver();
    const clean = await mergeBranches(
      ["keep", "stale"],
      ["keep", "consolidated"],
      ["keep", "stale", FROM_THEIRS]
    );
    expect(clean).toBe(true);
    expect(await ledgerIds()).toEqual(["consolidated", FROM_THEIRS, "keep"]);
  });

  it("leaves the merge unresolved when both branches rewrote one entry", async () => {
    await declareAttribute();
    registerDriver();
    await commitLedger([SHARED], "base");
    git("checkout", "-b", THEIR_BRANCH);
    await fs.outputFile(
      path.join(repo, LEDGER),
      renderLearningsFile([{ ...entry(SHARED), rule: "Their rewrite." }])
    );
    git("add", LEDGER);
    git("commit", "-m", "theirs");
    git("checkout", "main");
    await fs.outputFile(
      path.join(repo, LEDGER),
      renderLearningsFile([{ ...entry(SHARED), rule: "Our rewrite." }])
    );
    git("add", LEDGER);
    git("commit", "-m", "ours");
    expect(() => git("merge", THEIR_BRANCH, "-m", "merge")).toThrow();
  });

  it("falls back to git's default behavior when the driver is unregistered", async () => {
    // The .gitattributes ships with Lisa but `git config merge.<name>.driver`
    // is machine-local, so an unregistered checkout must behave exactly as it
    // does today — degraded, never broken.
    await declareAttribute();
    const clean = await mergeBranches(
      [SHARED],
      [SHARED, "from-ours"],
      [SHARED, FROM_THEIRS]
    );
    expect(clean).toBe(false);
  });
});

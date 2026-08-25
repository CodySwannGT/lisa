/**
 * What git actually does to a committed `.lisa/readiness.json` on a merge.
 *
 * `.gitattributes` maps two learnings paths to a union merge driver and nothing
 * else under `.lisa/`. The readiness report was left on the committed side with
 * no protection at all (CodySwannGT/lisa#3046), and the fix is a `.gitignore`
 * rule rather than a third merge driver — because the report is a whole-document
 * snapshot of ONE assessment of ONE tree. Union-by-record is correct for the
 * learnings ledger, whose entries are independent facts with ids; it is
 * incoherent here, where `verdict`, `narrowed_claim` and `blocker_count` are
 * single-valued and a blend of two runs describes a tree that never existed.
 *
 * Asserting that a `.gitignore` line exists proves nothing about what git does
 * with it, so every case below runs a REAL merge in a REAL repository and reads
 * the result off disk. The comparison is like-for-like: the same two diverging
 * branches, against the shipped template with the rule and against the same
 * template with the rule deleted — which is precisely the pre-fix state.
 * @module tests/unit/strategies/readiness-report-merge-exposure
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SHARED_TEMPLATE = path.join(REPO_ROOT, "all/copy-contents/gitignore");
const REPORT_PATH = ".lisa/readiness.json";
const CONFLICT_MARKER = "<<<<<<<";
const MAIN_BRANCH = "main";
const LEFT_BRANCH = "left";
const MERGE_MESSAGE = `merge ${LEFT_BRANCH}`;
const MAIN_VERDICT = "READY_WITH_WARNINGS";
const CHECKOUT = "checkout";
const COMMIT = "commit";
const COMMIT_ALL = "-am";
const LEFT_FILE = "left.txt";
const RIGHT_FILE = "right.txt";

/**
 * Render one readiness report body, differing only in the fields a second
 * concurrent run would genuinely differ in.
 * @param verdict - The verdict this run recorded
 * @param generatedAt - The ISO timestamp this run stamped
 * @returns Serialized report, newline-terminated as the writer emits it
 */
function report(verdict: string, generatedAt: string): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      generated_at: generatedAt,
      lisa_version: "4.6.2",
      worker_signature: "claude/unknown/unknown",
      verdict,
      narrowed_claim: `claim recorded at ${generatedAt}`,
      blockers: [],
      blocker_count: 0,
      dimensions: [],
    },
    null,
    2
  )}\n`;
}

/** The base run both branches inherit. */
const BASE_RUN = report("READY", "2026-08-24T00:00:00.000Z");

/** The run the side branch recorded. */
const LEFT_RUN = report("NOT_READY", "2026-08-25T01:00:00.000Z");

/** The run the main branch recorded. */
const MAIN_RUN = report(MAIN_VERDICT, "2026-08-25T02:00:00.000Z");

/**
 * The shipped ignore template, exactly as host projects receive it.
 * @returns Template content carrying the readiness rule
 */
function templateWithRule(): string {
  return fse.readFileSync(SHARED_TEMPLATE, "utf-8");
}

/**
 * The same template with the readiness rule deleted — the pre-fix state.
 *
 * Synthesized from the shipped file rather than pinned as a literal, so the
 * control can never drift away from the thing under test.
 * @returns Template content with no rule covering the readiness report
 */
function templateWithoutRule(): string {
  const stripped = templateWithRule()
    .split("\n")
    .filter(line => line.trim() !== REPORT_PATH)
    .join("\n");
  if (stripped === templateWithRule()) {
    throw new Error(
      `${SHARED_TEMPLATE} carries no ${REPORT_PATH} rule, so the control is not a control`
    );
  }
  return stripped;
}

/**
 * Environment without the outer repository's git state.
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
 * Run one git command that must succeed.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 */
function git(cwd: string, args: readonly string[]): void {
  boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd,
    env: cleanGitEnv(),
    stdio: "ignore",
  });
}

/**
 * Run one git command that is allowed to fail, returning its exit status.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 * @returns Exit status of the command
 */
function gitStatusOf(cwd: string, args: readonly string[]): number {
  return (
    boundedSpawnSync({
      label: `git ${args.join(" ")}`,
      command: GIT,
      args,
      cwd,
      env: cleanGitEnv(),
      stdio: "ignore",
    }).status ?? -1
  );
}

/**
 * Run one git command that must succeed and return its stdout.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 * @returns Command stdout
 */
function gitOutput(cwd: string, args: readonly string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd,
    env: cleanGitEnv(),
  });
}

describe("`.lisa/readiness.json` merge exposure", () => {
  let repo: string;

  /**
   * Build a fixture repository whose `.gitignore` is the given template.
   * @param gitignore - Content to write as the host `.gitignore`
   */
  async function initRepo(gitignore: string): Promise<void> {
    git(repo, ["init"]);
    git(repo, ["symbolic-ref", "HEAD", `refs/heads/${MAIN_BRANCH}`]);
    git(repo, ["config", "user.email", "fixture@example.invalid"]);
    git(repo, ["config", "user.name", "Fixture"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    await fse.outputFile(path.join(repo, ".gitignore"), gitignore);
    git(repo, ["add", ".gitignore"]);
    git(repo, [COMMIT, "-m", "chore: seed"]);
  }

  /**
   * Write the readiness report into the working tree.
   * @param body - Serialized report content
   */
  async function writeReport(body: string): Promise<void> {
    await fse.outputFile(path.join(repo, REPORT_PATH), body);
  }

  /**
   * Read the readiness report back off disk.
   * @returns Report content as it stands in the working tree
   */
  function readReport(): string {
    return fse.readFileSync(path.join(repo, REPORT_PATH), "utf-8");
  }

  beforeEach(async () => {
    repo = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(repo);
  });

  it("corrupts the report into unparseable JSON when nothing ignores it and two branches each commit one", async () => {
    await initRepo(templateWithoutRule());
    await writeReport(BASE_RUN);
    // Without the rule the report enters the index with a plain `git add`.
    expect(gitStatusOf(repo, ["add", REPORT_PATH])).toBe(0);
    git(repo, [COMMIT, "-m", "chore: first doctor run"]);

    git(repo, [CHECKOUT, "-b", LEFT_BRANCH]);
    await writeReport(LEFT_RUN);
    git(repo, [COMMIT, COMMIT_ALL, "chore: doctor run on left"]);

    git(repo, [CHECKOUT, MAIN_BRANCH]);
    await writeReport(MAIN_RUN);
    git(repo, [COMMIT, COMMIT_ALL, "chore: doctor run on main"]);

    const merge = gitStatusOf(repo, [
      "merge",
      LEFT_BRANCH,
      "-m",
      MERGE_MESSAGE,
    ]);

    expect(merge).not.toBe(0);
    const merged = readReport();
    expect(merged).toContain(CONFLICT_MARKER);
    expect(() => JSON.parse(merged)).toThrow();
  });

  it("keeps the report out of the index entirely once the shipped rule is present", async () => {
    await initRepo(templateWithRule());
    await writeReport(BASE_RUN);

    expect(gitStatusOf(repo, ["check-ignore", "-q", REPORT_PATH])).toBe(0);
    expect(gitStatusOf(repo, ["add", REPORT_PATH])).not.toBe(0);
    expect(
      gitOutput(repo, ["status", "--short", "--untracked-files=all"])
    ).not.toContain(REPORT_PATH);
  });

  it("lets the same two diverging branches merge cleanly, leaving valid JSON on disk", async () => {
    // `git add -A` deliberately, because that is how an agent commits: it is
    // the command that sweeps an unignored report into the index without anyone
    // deciding to commit it. Pre-fix this test conflicts exactly like the first
    // one; the ignore rule is the only thing keeping the report out.
    await initRepo(templateWithRule());
    await writeReport(BASE_RUN);

    git(repo, [CHECKOUT, "-b", LEFT_BRANCH]);
    await writeReport(LEFT_RUN);
    await fse.outputFile(path.join(repo, LEFT_FILE), "left\n");
    git(repo, ["add", "-A"]);
    git(repo, [COMMIT, "-m", "chore: work on left"]);

    git(repo, [CHECKOUT, MAIN_BRANCH]);
    await writeReport(MAIN_RUN);
    await fse.outputFile(path.join(repo, RIGHT_FILE), "right\n");
    git(repo, ["add", "-A"]);
    git(repo, [COMMIT, "-m", "chore: work on main"]);

    const merge = gitStatusOf(repo, [
      "merge",
      LEFT_BRANCH,
      "-m",
      MERGE_MESSAGE,
    ]);

    expect(merge).toBe(0);
    const merged = readReport();
    expect(merged).not.toContain(CONFLICT_MARKER);
    expect(JSON.parse(merged).verdict).toBe(MAIN_VERDICT);
  });

  it("still conflicts when the rule shipped but the report was already tracked, which is the retrofit gap doctor reports", async () => {
    // Control, not a regression guard: this conflicts both before and after
    // the fix, and that is the point. `.gitignore` binds UNTRACKED paths only.
    // A host that committed a report
    // before the rule arrived keeps committing it, and the ignore line is
    // silent about that — hence the `Readiness report untracked?` doctor check.
    await initRepo(templateWithRule());
    await writeReport(BASE_RUN);
    git(repo, ["add", "--force", REPORT_PATH]);
    git(repo, [COMMIT, "-m", "chore: report committed before the rule"]);

    git(repo, [CHECKOUT, "-b", LEFT_BRANCH]);
    await writeReport(LEFT_RUN);
    git(repo, [COMMIT, COMMIT_ALL, "chore: doctor run on left"]);

    git(repo, [CHECKOUT, MAIN_BRANCH]);
    await writeReport(MAIN_RUN);
    git(repo, [COMMIT, COMMIT_ALL, "chore: doctor run on main"]);

    const merge = gitStatusOf(repo, [
      "merge",
      LEFT_BRANCH,
      "-m",
      MERGE_MESSAGE,
    ]);

    expect(merge).not.toBe(0);
    expect(readReport()).toContain(CONFLICT_MARKER);
  });

  it("negative control: an unrelated non-conflicting merge is untouched by the rule", async () => {
    await initRepo(templateWithRule());

    git(repo, [CHECKOUT, "-b", LEFT_BRANCH]);
    await fse.outputFile(path.join(repo, LEFT_FILE), "left\n");
    git(repo, ["add", LEFT_FILE]);
    git(repo, [COMMIT, "-m", "chore: work on left"]);

    git(repo, [CHECKOUT, MAIN_BRANCH]);
    await fse.outputFile(path.join(repo, RIGHT_FILE), "right\n");
    git(repo, ["add", RIGHT_FILE]);
    git(repo, [COMMIT, "-m", "chore: work on main"]);

    const merge = gitStatusOf(repo, [
      "merge",
      LEFT_BRANCH,
      "-m",
      MERGE_MESSAGE,
    ]);

    expect(merge).toBe(0);
    expect(fse.readFileSync(path.join(repo, "left.txt"), "utf-8")).toBe(
      "left\n"
    );
    expect(fse.readFileSync(path.join(repo, "right.txt"), "utf-8")).toBe(
      "right\n"
    );
    expect(gitOutput(repo, ["status", "--short"])).toBe("");
  });
});

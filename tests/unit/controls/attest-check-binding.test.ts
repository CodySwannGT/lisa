/**
 * `lisa controls attest --check` holds a verdict to the content of what
 * defines the checks, not to a commit.
 *
 * An earlier version compared the commit the evidence named with the commit
 * the repository was at. That could not pass in ordinary use: after a
 * squash or rebase merge the recorded commit is gone, a shallow clone never
 * had it, a checkout another user owns makes git refuse, and the operator
 * had to commit in one particular order. So the evidence now carries a
 * digest of what defined the checks where the proofs ran, and the check
 * takes the same digest from the repository as it is. These cases hold it
 * to that, in the places the commit comparison failed.
 */
import {
  appendFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../../src/controls/evidence-types.js";
import { copyGit } from "../../../src/controls/proof-copy-git.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  checks,
  F_NONE_SOURCE,
  PROOFS,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkVerdict,
  editJson,
  evidenceIn,
  record,
  textOf,
  WRITTEN_FILES,
} from "./support/attest-record-run.js";
import { hookEnvironment, removeScratch } from "./support/proof-copy-run.js";
import {
  removeCopies,
  setting,
  type ProofSetting,
} from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const DECLARATION = ".lisa.config.json";
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;
const CLEAN_PATCH = `${PROOFS}/lint.clean.patch`;
const NOT_AS_PROVED =
  "What defines the checks is not what the proofs ran against.";
const ABOUT =
  "The verdict is about the checks as they were proved, so it does not describe what is here.";

const clones: string[] = [];

/**
 * Run git in a repository.
 * @param repoPath - The repository
 * @param args - Arguments to git
 * @returns What it printed
 */
function git(repoPath: string, ...args: readonly string[]): string {
  return runControlAuditGit(repoPath, args);
}

/**
 * Commit everything that has changed in a repository.
 * @param repoPath - The repository
 * @param message - The commit's message
 */
function commitAll(repoPath: string, message: string): void {
  git(repoPath, "add", "--all");
  git(repoPath, "commit", "--quiet", "-m", message);
}

/**
 * Build a repository with one working control, run its proofs, write down
 * what they found and commit the three files of results, the way an
 * operator leaves a repository for someone else to check.
 * @returns The repository, and the commit the proofs' records name
 */
async function attestedAndCommitted(): Promise<
  ProofSetting & { readonly proved: string }
> {
  const where = setting(WORKING);
  const proved = git(where.repoPath, "rev-parse", "HEAD");
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  commitAll(where.repoPath, "chore: record the attest results");
  return { ...where, proved };
}

/**
 * Name a folder for a clone, removed after the case.
 * @returns The folder's path; it does not exist yet
 */
function cloneFolder(): string {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-clone-")));
  clones.push(parent);
  return path.join(parent, "clone");
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeCopies();
  removeFixtures();
  clones.splice(0).forEach(folder => {
    rmSync(folder, { force: true, maxRetries: 10, recursive: true });
  });
});

describe("what a run writes down about what defines the checks", () => {
  it("is one digest, the list it covers, and that digest on every record", async () => {
    const where = await attestedAndCommitted();
    const evidence = evidenceIn(where.repoPath);

    expect(evidence.checks.covered.map(file => file.path)).toEqual([
      DECLARATION,
      CLEAN_PATCH,
      VIOLATION_PATCH,
    ]);
    expect(evidence.checks.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.records.length).toBeGreaterThan(0);
    expect(
      evidence.records.filter(
        each => each.checks_digest !== evidence.checks.digest
      )
    ).toEqual([]);
  });
});

describe("lisa controls attest --check, where comparing commits could not pass", () => {
  it("passes in a shallow clone, which does not have the commit the records name", async () => {
    const where = await attestedAndCommitted();
    const shallow = cloneFolder();
    git(
      where.repoPath,
      "clone",
      "--quiet",
      "--depth",
      "1",
      `file://${where.repoPath}`,
      shallow
    );

    const run = await checkVerdict(shallow);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(() => git(shallow, "cat-file", "-e", where.proved)).toThrow();
    WRITTEN_FILES.forEach(file => {
      expect(git(shallow, "status", "--short", "--", file)).toBe("");
    });
  });

  it("passes after a squash merge has replaced every commit the proofs ever saw", async () => {
    const where = await attestedAndCommitted();
    git(where.repoPath, "checkout", "--quiet", "--orphan", "squashed");
    commitAll(where.repoPath, "feat: everything, as one commit");
    const fresh = cloneFolder();
    git(
      where.repoPath,
      "clone",
      "--quiet",
      "--single-branch",
      "--branch",
      "squashed",
      `file://${where.repoPath}`,
      fresh
    );

    const run = await checkVerdict(fresh);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(() => git(fresh, "cat-file", "-e", where.proved)).toThrow();
  });

  it("passes with git's own folder gone: no history is read, and git is not asked", async () => {
    const where = await attestedAndCommitted();
    rmSync(path.join(where.repoPath, ".git"), { force: true, recursive: true });

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
  });

  it("passes with no git to be found on the machine: git is not started at all", async () => {
    const where = await attestedAndCommitted();
    vi.stubEnv("PATH", cloneFolder());

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    // The way Lisa starts git finds none there, so a pass used none.
    expect(copyGit(where.repoPath)(["status"]).code).not.toBe(0);
  });

  it("passes whichever is committed first: the results before the files that define the checks, or after", async () => {
    const where = setting(WORKING);
    // Neither change is committed when the proofs run: the declaration is
    // laid out differently, and the proofs folder holds one more file.
    writeFileSync(
      path.join(where.repoPath, DECLARATION),
      `${textOf(where.repoPath, DECLARATION).trimEnd()}\n\n`
    );
    writeFileSync(path.join(where.repoPath, PROOFS, "notes.patch"), "x\n");
    const recorded = await record(where);

    expect(recorded.problems).toBeNull();
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
    git(where.repoPath, "add", "--", ...WRITTEN_FILES);
    git(where.repoPath, "commit", "--quiet", "-m", "chore: the results");
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
    commitAll(where.repoPath, "chore: the declaration, afterwards");
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("passes when another setting in the declaration file changes", async () => {
    const where = await attestedAndCommitted();
    editJson<Readonly<Record<string, unknown>>>(
      where.repoPath,
      DECLARATION,
      current => ({ ...current, harness: "claude" })
    );
    commitAll(where.repoPath, "chore: a setting that is not a check");

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
  });

  it("prints the commit the proofs' copy was cloned from, for the reader, and decides nothing by it", async () => {
    const where = await attestedAndCommitted();

    const run = await checkVerdict(where.repoPath);

    expect(run.stdout.join("\n")).toContain(
      `What defines the checks is what the proofs ran against (3 files compared by content). The proofs ran in a copy cloned from commit ${where.proved.slice(0, 7)}; that is for your information, and nothing was compared with it.`
    );
  });
});

describe("lisa controls attest --check, when what defines the checks has changed", () => {
  it("fails and names a proof's patch file that was rewritten", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, VIOLATION_PATCH), "\n");

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toContain(
      `${NOT_AS_PROVED} Changed since: ${VIOLATION_PATCH}. ${ABOUT}`
    );
    expect(run.stderr.at(-1)).toMatch(
      /^attest --check: FAIL\. 1 difference .* Run "lisa controls attest"/u
    );
  });

  it("fails the same way whether or not the change is committed", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, VIOLATION_PATCH), "\n");
    commitAll(where.repoPath, "test: weaken the violating change");

    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.DIFFERS
    );
  });

  it("fails and names a proof file that is gone, and one that was added", async () => {
    const where = await attestedAndCommitted();
    rmSync(path.join(where.repoPath, CLEAN_PATCH));
    writeFileSync(path.join(where.repoPath, PROOFS, "extra.patch"), "x\n");

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr).toContain(
      `${NOT_AS_PROVED} No longer here: ${CLEAN_PATCH}. ${ABOUT}`
    );
    expect(run.stderr).toContain(
      `${NOT_AS_PROVED} Here now and not there then: ${PROOFS}/extra.patch. ${ABOUT}`
    );
  });

  it("fails and names the gates block when a check's declaration changes", async () => {
    const where = await attestedAndCommitted();
    editJson<{ readonly gates: Readonly<Record<string, object>> }>(
      where.repoPath,
      DECLARATION,
      current => ({
        ...current,
        gates: {
          ...current.gates,
          "code-style": { ...current.gates["code-style"], owner: "someone" },
        },
      })
    );

    const run = await checkVerdict(where.repoPath);

    expect(run.code).not.toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stderr.join("\n")).toContain(
      `Changed since: the gates block of ${DECLARATION}.`
    );
  });

  it("does not see a change to the checked tool's own files: there is no list of them", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, "Makefile"), "\n# changed\n");

    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });
});

describe("lisa controls attest --check and evidence written before the binding", () => {
  it("says the evidence predates the binding and exits non-zero, though the three files agree", async () => {
    const where = await attestedAndCommitted();
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, current => ({
      schema_version: current.schema_version,
      records: current.records.map(
        ({ checks_digest: _digest, ...before }) => before
      ),
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(
      `${EVIDENCE_PATH} was written before evidence was bound to what defines the checks: it has no "checks", so nothing in it says which checks its records are about. Run "lisa controls attest" to prove the controls again and write it anew.`
    );
    expect(run.stderr.at(-1)).toMatch(/^attest --check: FAIL\. /u);
    expect(run.stderr.join("\n")).not.toContain("checks_digest");
  });

  it("fails when the digest in the file is not the digest of the files it lists", async () => {
    const where = await attestedAndCommitted();
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, current => ({
      ...current,
      checks: {
        ...current.checks,
        covered: current.checks.covered.filter(
          file => file.path !== VIOLATION_PATCH
        ),
      },
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).toContain(
      "The evidence file's own account of what defines the checks does not add up"
    );
  });
});

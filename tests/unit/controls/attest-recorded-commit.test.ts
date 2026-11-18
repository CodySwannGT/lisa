/**
 * The commit an evidence record names, and what `lisa controls attest
 * --check` does with it.
 *
 * A record names the commit the proofs were run against. That is the commit
 * the run's copy was made from, which is not always the commit the
 * repository is at when the results are written: a run takes time, and the
 * operator can commit meanwhile.
 *
 * The check then holds the verdict to that commit. A verdict is about the
 * checks as they were when they were proved. If the repository has moved on
 * and a file that says what the checks are, or runs them, has changed since,
 * the verdict no longer describes what is here, and the check says so. If
 * the commit is not in this clone, nothing can be compared, and the check
 * says that instead of calling the verdict current.
 */
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import {
  ATTEST_EXIT,
  runAttest,
} from "../../../src/controls/commands/attest.js";
import { openAttestWorkspace } from "../../../src/controls/commands/attest-workspace.js";
import { loadProofTools } from "../../../src/controls/proof-tools.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  checks,
  F_NONE_SOURCE,
  PROOFS,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkVerdict,
  evidenceIn,
  record,
  WRITTEN_FILES,
} from "./support/attest-record-run.js";
import { standInCopy } from "./support/attest-run.js";
import {
  hookEnvironment,
  ownTemporaryFolder,
  removeScratch,
} from "./support/proof-copy-run.js";
import {
  removeCopies,
  setting,
  steppingClock,
  type ProofSetting,
} from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const DECLARATION = ".lisa.config.json";
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;
const SHORT = 7;

const clones: string[] = [];

/**
 * The commit a repository is at.
 * @param repoPath - The repository
 * @returns The full commit id
 */
function headOf(repoPath: string): string {
  return runControlAuditGit(repoPath, ["rev-parse", "HEAD"]);
}

/**
 * Commit everything that has changed in a repository.
 * @param repoPath - The repository
 * @param message - The commit's message
 * @returns The new commit's id
 */
function commitAll(repoPath: string, message: string): string {
  runControlAuditGit(repoPath, ["add", "--all"]);
  runControlAuditGit(repoPath, ["commit", "--quiet", "-m", message]);
  return headOf(repoPath);
}

/**
 * Build a repository with one working control, run its proofs, and commit
 * the three files of results, the way an operator does.
 * @returns The repository, and the commit the proofs were run against
 */
async function attestedAndCommitted(): Promise<
  ProofSetting & { readonly proved: string }
> {
  const where = setting(WORKING);
  const proved = headOf(where.repoPath);
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  commitAll(where.repoPath, "chore: record the attest results");
  return { ...where, proved };
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

describe("the commit an evidence record names", () => {
  it("is the commit the run's copy was made from, not the commit the repository has moved to since", async () => {
    const where = setting(WORKING);
    const cloned = headOf(where.repoPath);
    const open = standInCopy(where);

    const code = await runAttest(
      where.repoPath,
      {},
      {
        clock: steppingClock(),
        stdout: () => undefined,
        stderr: () => undefined,
        openWorkspace: async request => {
          const opening = await open(request);
          // The operator commits while the proofs are still running.
          appendFileSync(path.join(where.repoPath, "NOTES.md"), "later\n");
          commitAll(where.repoPath, "docs: a note written meanwhile");
          return opening.problem === null
            ? { ...opening, commit: cloned }
            : opening;
        },
      }
    );

    expect(code).toBe(ATTEST_EXIT.PASSED);
    expect(headOf(where.repoPath)).not.toBe(cloned);
    expect(evidenceIn(where.repoPath).records.map(each => each.commit)).toEqual(
      [cloned, cloned]
    );
  });

  it("is handed over by the copy the command makes for itself", async () => {
    const where = setting(WORKING);
    ownTemporaryFolder();

    const opening = await openAttestWorkspace({
      root: where.repoPath,
      named: undefined,
      tools: await loadProofTools(),
    });
    if (opening.problem !== null) throw new Error(opening.problem);
    await opening.close();

    expect(opening.commit).toBe(headOf(where.repoPath));
  });

  it("is the commit the repository is at when nothing was cloned", async () => {
    const where = setting(WORKING);

    await record(where);

    expect(evidenceIn(where.repoPath).records.map(each => each.commit)).toEqual(
      [headOf(where.repoPath), headOf(where.repoPath)]
    );
  });
});

describe("lisa controls attest --check and the commit the evidence names", () => {
  it("names the commit, and passes while the repository is still at it", async () => {
    const where = setting(WORKING);
    await record(where);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stdout.join("\n")).toContain(
      `The evidence was recorded at commit ${headOf(where.repoPath).slice(0, SHORT)}, the commit this repository is at.`
    );
  });

  it("passes after the results are committed, because no file that defines the checks changed", async () => {
    const where = await attestedAndCommitted();

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stdout.join("\n")).toContain(
      `The evidence was recorded at commit ${where.proved.slice(0, SHORT)}. This repository is now at ${headOf(where.repoPath).slice(0, SHORT)}, and no file that says what the checks are or runs them has changed since.`
    );
  });

  it("fails when a proof's change was rewritten after the proofs ran", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, VIOLATION_PATCH), "\n");
    const now = commitAll(where.repoPath, "test: weaken the violating change");

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toContain(
      `The evidence was recorded at commit ${where.proved.slice(0, SHORT)}, and this repository is now at ${now.slice(0, SHORT)}. Between the two, a file that says what the checks are or runs them has changed: ${VIOLATION_PATCH}. The verdict is about the checks as they were, so it no longer describes what is here.`
    );
    expect(run.stderr.at(-1)).toMatch(
      /^attest --check: FAIL\. 1 difference .* Run "lisa controls attest"/u
    );
  });

  it("fails when the file that declares the checks changed, even in a way the register does not show", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, DECLARATION), "\n");
    commitAll(where.repoPath, "chore: touch the declaration");

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).toContain(
      `a file that says what the checks are or runs them has changed: ${DECLARATION}.`
    );
  });

  it("does not see a change to the checked tool's own files: that is outside what it compares", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, "Makefile"), "\n# changed\n");
    commitAll(where.repoPath, "build: change the tool's set-up");

    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("says it could not compare, and exits non-zero, in a clone that does not have the commit", async () => {
    const where = await attestedAndCommitted();
    const shallow = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-shallow-"))),
      "clone"
    );
    clones.push(path.dirname(shallow));
    runControlAuditGit(where.repoPath, [
      "clone",
      "--quiet",
      "--depth",
      "1",
      `file://${where.repoPath}`,
      shallow,
    ]);

    const run = await checkVerdict(shallow);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.NOT_CHECKED);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toEqual([
      `The evidence was recorded at commit ${where.proved}, and this clone does not have that commit (a shallow clone leaves history out), so what has changed since could not be compared. Fetch the full history (git fetch --unshallow), or run "lisa controls attest" again.`,
      "attest --check: FAIL. The three files agree with each other, but the commit the evidence was recorded at could not be compared with this repository, so the verdict is not shown to be current",
    ]);
    WRITTEN_FILES.forEach(file => {
      expect(
        runControlAuditGit(shallow, ["status", "--short", "--", file])
      ).toBe("");
    });
  });
});

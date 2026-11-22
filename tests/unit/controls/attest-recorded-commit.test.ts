/**
 * The commit an evidence record names, and what `lisa controls attest
 * --check` does with it: prints it, and decides nothing by it.
 *
 * A record names the commit the run's copy was cloned from. That is not
 * always the commit the repository is at when the results are written: a
 * run takes time, and the operator can commit meanwhile.
 *
 * The check once held the verdict to that commit, and that could not pass
 * in ordinary use: a squash or rebase merge replaces the commit, and a
 * shallow clone never has it. What is compared now is the content of what
 * defines the checks (`tests/unit/controls/attest-check-binding.test.ts`).
 * The commit stays in the records for a reader, and these cases hold the
 * check to never failing on it.
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
    // With it, what defined the checks in that copy: what the run's
    // evidence is bound to.
    expect(opening.checks?.covered.map(file => file.path)).toEqual([
      DECLARATION,
      `${PROOFS}/lint.clean.patch`,
      VIOLATION_PATCH,
    ]);
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
  it("names the commit, for the reader, and passes while the repository is still at it", async () => {
    const where = setting(WORKING);
    await record(where);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stdout.join("\n")).toContain(
      `The proofs ran in a copy cloned from commit ${headOf(where.repoPath).slice(0, SHORT)}; that is for your information, and nothing was compared with it.`
    );
  });

  it("passes after the repository has moved on, and still names the commit the records hold", async () => {
    const where = await attestedAndCommitted();

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(headOf(where.repoPath)).not.toBe(where.proved);
    expect(run.stdout.join("\n")).toContain(
      `cloned from commit ${where.proved.slice(0, SHORT)};`
    );
  });

  it("passes in a clone that does not have the commit: nothing is asked of history", async () => {
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

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stdout.join("\n")).toContain(
      `cloned from commit ${where.proved.slice(0, SHORT)};`
    );
    WRITTEN_FILES.forEach(file => {
      expect(
        runControlAuditGit(shallow, ["status", "--short", "--", file])
      ).toBe("");
    });
  });

  it("passes when the declaration file is touched and its gates block is not: a commit that changes the file is not a change to a check", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, DECLARATION), "\n");
    commitAll(where.repoPath, "chore: touch the declaration");

    const run = await checkVerdict(where.repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
  });

  it("fails on the content of a proof's change that was rewritten, and says nothing of commits", async () => {
    const where = await attestedAndCommitted();
    appendFileSync(path.join(where.repoPath, VIOLATION_PATCH), "\n");
    commitAll(where.repoPath, "test: weaken the violating change");

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.join("\n")).toContain(
      `Changed since: ${VIOLATION_PATCH}.`
    );
    expect(run.stderr.join("\n")).not.toMatch(/commit [0-9a-f]{7}/u);
  });
});

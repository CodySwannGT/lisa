/**
 * What an attest run is bound to when it writes its results down, and what
 * it tells the operator when the repository is not what the proofs ran
 * against.
 *
 * The proofs run in a copy of the last commit. A file that defines the
 * checks and differs between that copy and the repository would make
 * `lisa controls attest --check` fail straight away, with nothing to say
 * why. So the run says it itself, at the moment it writes: which files, and
 * what puts each right.
 */
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { bindChecks } from "../../../src/controls/checks-binding.js";
import { DEFAULT_FRESHNESS_SECONDS } from "../../../src/controls/evidence-types.js";
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
} from "./support/attest-record-run.js";
import { put } from "./support/binding-folders.js";
import { hookEnvironment, removeScratch } from "./support/proof-copy-run.js";
import {
  removeCopies,
  setting,
  type ProofSetting,
} from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;
const RUNNER = "scripts/lisa-run-gates.mjs";

const copies: string[] = [];

/**
 * Copy a repository's files, without git's own folder, the way the run's
 * copy holds them.
 * @param where - The repository
 * @returns The copy's real path
 */
function copyOf(where: ProofSetting): string {
  const copy = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-ran-in-")));
  copies.push(copy);
  cpSync(where.repoPath, copy, {
    recursive: true,
    filter: source => path.basename(source) !== ".git",
  });
  return copy;
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeCopies();
  removeFixtures();
  copies.splice(0).forEach(folder => {
    rmSync(folder, { force: true, maxRetries: 10, recursive: true });
  });
});

describe("the binding an attest run writes down", () => {
  it("is the one the run hands over, taken where the proofs ran", async () => {
    const where = setting(WORKING);
    const ranIn = await bindChecks({
      repository: where.repoPath,
      copy: copyOf(where),
    });

    const recorded = await record(where, { checks: ranIn });

    expect(recorded.problems).toBeNull();
    expect(evidenceIn(where.repoPath).checks).toEqual(ranIn);
    expect(recorded.problems === null ? recorded.warnings : null).toEqual([]);
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("is taken from the repository itself when the run hands none over", async () => {
    const where = setting(WORKING);

    const recorded = await record(where);

    expect(evidenceIn(where.repoPath).checks).toEqual(
      await bindChecks({ repository: where.repoPath })
    );
    expect(recorded.problems === null ? recorded.warnings : null).toEqual([]);
  });
});

describe("a file that is not the same in the repository as where the proofs ran", () => {
  it("is named when the results are written, with what puts it right, and the check then fails on the same file", async () => {
    const where = setting(WORKING);
    put(where.repoPath, RUNNER, "console.log('an older runner');\n");
    const copy = copyOf(where);
    put(copy, RUNNER, "console.log('the runner the run installed');\n");
    put(copy, VIOLATION_PATCH, "as it was at the last commit\n");

    const recorded = await record(where, {
      checks: await bindChecks({ repository: where.repoPath, copy }),
    });

    expect(recorded.problems === null ? recorded.warnings : null).toEqual([
      `What defines the checks in this repository is not what the proofs ran against, so "lisa controls attest --check" will not pass yet: ${VIOLATION_PATCH}, ${RUNNER}. The proofs ran in a copy of the last commit with the carriers freshly installed. Where the file is a hook script or the gate runner, run "lisa controls install-carriers" to bring this repository's copy up to date. Any other was changed since the last commit: commit it, or undo the change. Then run this again.`,
    ]);
    const run = await checkVerdict(where.repoPath);
    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).toContain(
      `Changed since: ${VIOLATION_PATCH}, ${RUNNER}.`
    );
  });
});

describe("the lifetime a run may give its records", () => {
  it.each([DEFAULT_FRESHNESS_SECONDS + 1, 90 * 24 * 60 * 60])(
    "is never more than the default: %d seconds is refused",
    async freshnessSeconds => {
      const recorded = await record(setting(WORKING), { freshnessSeconds });

      expect(recorded.problems).toEqual([
        `The freshness lifetime must be a whole number of seconds from 1 to ${String(DEFAULT_FRESHNESS_SECONDS)} (thirty days, the longest a record is relied on); it was ${String(freshnessSeconds)}.`,
      ]);
    }
  );

  it("may be the default itself", async () => {
    const recorded = await record(setting(WORKING), {
      freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
    });

    expect(recorded.problems).toBeNull();
  });
});

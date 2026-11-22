/**
 * New evidence can change the control register, so the attest step writes
 * the register again after the evidence and before it computes the verdict
 * (CodySwannGT/lisa#4998).
 *
 * An entry whose pull-request check runs from a file Lisa did not write
 * reads `unproved` until both halves of its proof at that moment are on
 * record and held. These cases hand the writer pull-request results the way
 * the step that judges that moment will, and look at what the three files
 * say afterwards.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { runRegister } from "../../../src/controls/commands/register.js";
import type {
  EntryEvidenceResult,
  EvidenceBatch,
  EvidenceResultInput,
} from "../../../src/controls/evidence-types.js";
import type { ProofHalf } from "../../../src/controls/proof-halves.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "../../../src/controls/register-types.js";
import { digestOf } from "../../../src/controls/verdict-digest.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkVerdict,
  evidenceIn,
  jsonOf,
  record,
  verdictIn,
} from "./support/attest-record-run.js";
import { withExecutor } from "./support/executor-fixtures.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const ENTRY = "code-style@.";
const PULL_REQUEST = "pull-request";

/** One control, checked at commit and, from a pipeline file Lisa did not write, on pull requests. */
const PIPELINE_RUN = withExecutor(
  provedGates([{ command: checks(F_NONE_SOURCE) }], "code-style", [
    "commit",
    PULL_REQUEST,
  ])
);

/**
 * One half of a pull-request proof, as the step that judges that moment
 * hands it over.
 * @param half - Which half
 * @param result - What it showed
 * @returns The result
 */
function canary(
  half: ProofHalf,
  result: EntryEvidenceResult = "held"
): EvidenceResultInput {
  return {
    entry_id: ENTRY,
    moment: PULL_REQUEST,
    rung: "exercised",
    half,
    result,
    reason: half === "violation" ? "merge-blocked" : "merge-allowed",
    detail: `The ${half} change was judged on a pull request.`,
    command: null,
    exit_status: null,
    started_at: "2026-01-01T00:00:10.000Z",
    completed_at: "2026-01-01T00:00:20.000Z",
    output_excerpt: "",
    output_truncated: false,
  };
}

/**
 * What a run found out at the pull-request moment.
 * @param results - Its results
 * @returns The batch
 */
function pullRequestBatch(
  results: readonly EvidenceResultInput[]
): EvidenceBatch {
  return { entries: [ENTRY], moments: [PULL_REQUEST], results };
}

/**
 * The status the committed register gives the entry.
 * @param repoPath - The repository
 * @returns The status, or `undefined` when the entry has none
 */
function statusIn(repoPath: string): string | undefined {
  return jsonOf<ControlRegister>(repoPath, CONTROL_REGISTER_PATH).entries.find(
    entry => entry.id === ENTRY
  )?.status;
}

/**
 * Run `lisa controls register --check` on a repository.
 * @param repoPath - The repository
 * @returns Its exit code
 */
function registerCheck(repoPath: string): Promise<number> {
  return runRegister(
    repoPath,
    { check: true },
    { stdout: () => undefined, stderr: () => undefined }
  );
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("the register an attest run writes after the evidence", () => {
  it("still reads unproved when only the local proof is on record", async () => {
    const where = setting(PIPELINE_RUN);

    await record(where);

    expect(statusIn(where.repoPath)).toBe("unproved");
    expect(await registerCheck(where.repoPath)).toBe(0);
  });

  it("no longer reads unproved once both pull-request halves held, in the same run", async () => {
    const where = setting(PIPELINE_RUN);

    const recorded = await record(where, {
      batches: [pullRequestBatch([canary("violation"), canary("clean")])],
    });

    expect(recorded.problems).toBeNull();
    expect(statusIn(where.repoPath)).toBeUndefined();
    expect(await registerCheck(where.repoPath)).toBe(0);
  });

  it("is the register the verdict's digest covers", async () => {
    const where = setting(PIPELINE_RUN);

    await record(where, {
      batches: [pullRequestBatch([canary("violation"), canary("clean")])],
    });
    const register = jsonOf<unknown>(where.repoPath, CONTROL_REGISTER_PATH);

    expect(verdictIn(where.repoPath).digest.register).toBe(digestOf(register));
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("goes on reading unproved when a pull-request half was run and did not hold", async () => {
    const where = setting(PIPELINE_RUN);

    await record(where, {
      batches: [
        pullRequestBatch([canary("violation", "failed"), canary("clean")]),
      ],
    });

    expect(statusIn(where.repoPath)).toBe("unproved");
    expect(
      verdictIn(where.repoPath).criteria.find(each => each.criterion === "SI7")
    ).toMatchObject({ verdict: "non-conforming", reason: "control-failed" });
  });

  it("reads unproved again when a later run has no pull-request result to repeat", async () => {
    const where = setting(PIPELINE_RUN);
    await record(where, {
      batches: [pullRequestBatch([canary("violation"), canary("clean")])],
    });

    await record(where, { batches: [pullRequestBatch([])] });

    expect(evidenceIn(where.repoPath).records.map(each => each.moment)).toEqual(
      ["commit", "commit"]
    );
    expect(statusIn(where.repoPath)).toBe("unproved");
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("keeps the pull-request records when a later run does not speak for that moment", async () => {
    const where = setting(PIPELINE_RUN);
    await record(where, {
      batches: [pullRequestBatch([canary("violation"), canary("clean")])],
    });

    await record(where);

    expect(
      evidenceIn(where.repoPath)
        .records.map(each => each.id)
        .filter(id => id.includes(PULL_REQUEST))
    ).toEqual([
      `${ENTRY}/${PULL_REQUEST}/clean/SI7`,
      `${ENTRY}/${PULL_REQUEST}/violation/SI7`,
    ]);
    expect(statusIn(where.repoPath)).toBeUndefined();
  });
});

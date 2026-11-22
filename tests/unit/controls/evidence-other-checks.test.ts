/**
 * A record made when the checks were defined differently is not kept.
 *
 * A plain attest run leaves an earlier run's canary results at the
 * pull-request moment in place, because it planted nothing against them.
 * When the checks have been redefined since, those results say how other
 * checks behaved. Kept, the verdict written from them failed its own
 * `--check`, and running attest again did not clear it. So an earlier
 * record is kept only when it was recorded under the digest this run took
 * of what defines the checks, and the operator is told how many were
 * dropped and how to produce them again.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import type {
  EvidenceBatch,
  EvidenceDocument,
  EvidenceRecord,
} from "../../../src/controls/evidence-types.js";
import {
  droppedForOtherChecks,
  droppedForOtherChecksLine,
  mergedEvidence,
} from "../../../src/controls/evidence-write.js";
import { pullRequestBatch } from "../../../src/controls/pull-request-evidence.js";
import type { ControlRegisterEntry } from "../../../src/controls/register-types.js";
import { PROOFS } from "../../helpers/control-proofs.js";
import {
  AFTER_BOTH,
  attestIn,
  NEXT_DAY,
  pullRequestSetting,
} from "./support/attest-pull-request-run.js";
import {
  checkVerdict,
  editJson,
  evidenceIn,
  verdictIn,
} from "./support/attest-record-run.js";
import { canaryPlatform } from "./support/canary-run.js";
import {
  entryServing,
  heldPair,
  observedRecord,
  OTHER_CHECKS_DIGEST,
  registerOf,
  SAMPLE_CHECKS,
  SOON_AFTER,
} from "./support/evidence-samples.js";
import { removeCopies } from "./support/proof-run.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
} from "./support/pull-request-run.js";
import { point, settled } from "./support/pull-request-samples.js";
import { removeFixtures } from "./support/report-check-run.js";
import { of } from "./support/verdict-run.js";

const API = "code-style@api";
const PULL_REQUEST = "pull-request";
const CANARIES = { json: true, pullRequestCanaries: true } as const;
const OTHER = { checks_digest: OTHER_CHECKS_DIGEST };
const DROPPED = /^attest: note\. (\d+) earlier pull-request records? w/u;

/** The sample entry, enforced at commit and on pull requests. */
const ON_PULL_REQUESTS: ControlRegisterEntry = {
  ...entryServing(API),
  enforcement_points: [
    ...entryServing(API).enforcement_points,
    { moment: PULL_REQUEST, level: "required", location: "hosting-platform" },
  ],
};

/** What a run at commit and push speaks for. */
const LOCAL: EvidenceBatch = {
  entries: [API],
  moments: ["commit", "push"],
  results: [],
};

/**
 * What goes into the evidence file after a run at commit and push that
 * wrote nothing, under the samples' digest.
 * @param earlier - What the file held before
 * @param records - What the run wrote
 * @returns The parts the writer takes
 */
function parts(
  earlier: readonly EvidenceRecord[],
  records: readonly EvidenceRecord[] = []
): Parameters<typeof mergedEvidence>[0] {
  return {
    earlier,
    register: registerOf(ON_PULL_REQUESTS),
    batches: [LOCAL],
    records,
    checksDigest: SAMPLE_CHECKS.digest,
  };
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("an earlier canary result, when a run merges what it found", () => {
  it("is kept when it was recorded under the digest this run took", () => {
    const pair = heldPair(API, "SI7", { moment: PULL_REQUEST });

    expect(mergedEvidence(parts(pair))).toEqual(pair);
    expect(droppedForOtherChecks(parts(pair))).toBe(0);
  });

  it("is dropped when it was recorded under another digest, and counted", () => {
    const pair = heldPair(API, "SI7", { moment: PULL_REQUEST, ...OTHER });

    expect(mergedEvidence(parts(pair))).toEqual([]);
    expect(droppedForOtherChecks(parts(pair))).toBe(2);
  });

  it("is dropped one half at a time: a pair of two digests is no pair", () => {
    const [violation, clean] = heldPair(API, "SI7", { moment: PULL_REQUEST });
    if (violation === undefined || clean === undefined) throw new Error("pair");
    const mixed = [violation, { ...clean, ...OTHER }];

    expect(mergedEvidence(parts(mixed))).toEqual([violation]);
    expect(droppedForOtherChecks(parts(mixed))).toBe(1);
  });

  it("is not counted when this run exercised it again: it was replaced, not dropped", () => {
    const earlier = heldPair(API, "SI7", { moment: PULL_REQUEST, ...OTHER });
    const again = heldPair(API, "SI7", { moment: PULL_REQUEST });

    expect(mergedEvidence(parts(earlier, again))).toEqual(again);
    expect(droppedForOtherChecks(parts(earlier, again))).toBe(0);
  });

  it("is not counted when it is a setting that was read, which any run reads again", () => {
    const read = [observedRecord(API, "SI7", OTHER)];

    expect(mergedEvidence(parts(read))).toEqual([]);
    expect(droppedForOtherChecks(parts(read))).toBe(0);
  });

  it.each([
    [0, null],
    [
      1,
      '1 earlier pull-request record was made when the checks were defined differently, so it was dropped: a record counts only for the checks it was made against. Run "lisa controls attest --pull-request-canaries" to produce it again.',
    ],
    [
      4,
      '4 earlier pull-request records were made when the checks were defined differently, so they were dropped: a record counts only for the checks it was made against. Run "lisa controls attest --pull-request-canaries" to produce them again.',
    ],
  ])("is told to the operator as a count: %d", (count, line) => {
    expect(droppedForOtherChecksLine(count)).toBe(line);
  });
});

describe("a run that only read the settings, and an earlier canary proof", () => {
  const now = { now: SOON_AFTER, checksDigest: SAMPLE_CHECKS.digest };
  const required = settled([point({ entry_id: API })]);

  it("leaves the entry alone while the proof is of the checks as they are", () => {
    const proof = heldPair(API, "SI7", { moment: PULL_REQUEST });

    expect(pullRequestBatch(required, proof, now).entries).toEqual([]);
  });

  it("speaks for the entry when the proof is of checks that have been redefined, so what it read is written", () => {
    const proof = heldPair(API, "SI7", { moment: PULL_REQUEST, ...OTHER });
    const batch = pullRequestBatch(required, proof, now);

    expect(batch.entries).toEqual([API]);
    expect(batch.results.map(result => result.rung)).toEqual(["observed"]);
  });

  it("speaks for the entry when only one of the earlier records is of other checks", () => {
    const [violation, clean] = heldPair(API, "SI7", { moment: PULL_REQUEST });
    if (violation === undefined || clean === undefined) throw new Error("pair");

    expect(
      pullRequestBatch(required, [violation, { ...clean, ...OTHER }], now)
        .entries
    ).toEqual([API]);
  });
});

describe("lisa controls attest, after the checks were redefined since a canary run", () => {
  it("drops the canary results, says how many, and writes a verdict its own check accepts", async () => {
    const where = pullRequestSetting(PULL_ONLY_GATES);
    const platform = canaryPlatform();
    await attestIn(where, CANARIES, { gh: platform.gh });
    const before = evidenceIn(where.repoPath);
    // One more file among the proofs: what defines the checks has changed.
    writeFileSync(path.join(where.repoPath, PROOFS, "later.patch"), "x\n");

    const run = await attestIn(
      where,
      { json: true },
      { gh: platform.gh },
      NEXT_DAY
    );

    const after = evidenceIn(where.repoPath);
    expect(
      before.records.filter(each => each.rung === "exercised")
    ).toHaveLength(2);
    expect(after.checks.digest).not.toBe(before.checks.digest);
    expect(after.records.map(each => each.id)).toEqual([
      `${PULL_ONLY_ENTRY}/pull-request/observed/SI7`,
    ]);
    expect(
      after.records.filter(each => each.checks_digest !== after.checks.digest)
    ).toEqual([]);
    expect(run.stderr.filter(line => DROPPED.test(line))).toEqual([
      'attest: note. 2 earlier pull-request records were made when the checks were defined differently, so they were dropped: a record counts only for the checks it was made against. Run "lisa controls attest --pull-request-canaries" to produce them again.',
    ]);
    expect(of(verdictIn(where.repoPath), "SI7").verdict).toBe("unknown");
    expect((await checkVerdict(where.repoPath, AFTER_BOTH)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("keeps the canary results when nothing that defines the checks changed, and says nothing", async () => {
    const where = pullRequestSetting(PULL_ONLY_GATES);
    const platform = canaryPlatform();
    await attestIn(where, CANARIES, { gh: platform.gh });

    const run = await attestIn(
      where,
      { json: true },
      { gh: platform.gh },
      NEXT_DAY
    );

    expect(
      evidenceIn(where.repoPath).records.filter(
        each => each.rung === "exercised"
      )
    ).toHaveLength(2);
    expect(run.stderr.filter(line => DROPPED.test(line))).toEqual([]);
    expect((await checkVerdict(where.repoPath, AFTER_BOTH)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("drops the canary results of a file written before records carried a digest, and counts them", async () => {
    const where = pullRequestSetting(PULL_ONLY_GATES);
    const platform = canaryPlatform();
    await attestIn(where, CANARIES, { gh: platform.gh });
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, current => ({
      schema_version: current.schema_version,
      records: current.records.map(
        ({ checks_digest: _digest, ...earlier }) => earlier
      ),
    }));

    const run = await attestIn(
      where,
      { json: true },
      { gh: platform.gh },
      NEXT_DAY
    );

    expect(evidenceIn(where.repoPath).records.map(each => each.id)).toEqual([
      `${PULL_ONLY_ENTRY}/pull-request/observed/SI7`,
    ]);
    expect(run.stderr.filter(line => DROPPED.test(line))).toHaveLength(1);
    expect(run.stderr.join("\n")).toMatch(/^attest: note\. 2 earlier /mu);
    expect((await checkVerdict(where.repoPath, AFTER_BOTH)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });
});

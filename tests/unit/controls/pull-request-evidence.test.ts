/**
 * What the hosting platform said about the pull-request moment, as results
 * the evidence writer takes (CodySwannGT/lisa#4997, CodySwannGT/lisa#4998).
 *
 * `lisa controls attest` settles the pull-request moment in one step and
 * writes evidence in another. These cases hold the join between the two to
 * its table: which settled point becomes which result, that a canary half is
 * handed over exactly once, and that a run which only read the platform's
 * settings does not remove a canary proof that is still current.
 */
import { describe, expect, it } from "vitest";

import type { EvidenceRecord } from "../../../src/controls/evidence-types.js";
import { proofRunBatch } from "../../../src/controls/evidence-write.js";
import { proofRunOf } from "../../../src/controls/proof-runner.js";
import {
  pullRequestBatch,
  pullRequestBatches,
} from "../../../src/controls/pull-request-evidence.js";
import { entryResultOf } from "../../../src/controls/pull-request-points.js";
import {
  EXPIRY,
  heldPair,
  observedRecord,
  SAMPLE_CHECKS,
  SOON_AFTER,
} from "./support/evidence-samples.js";
import {
  CANARY_BEGAN,
  exercisedPoint,
  OBSERVED_REQUIRED,
  point,
  PULL_REQUEST,
  READ_AT,
  SAMPLE_CHECK,
  SAMPLE_ENTRY,
  settled,
} from "./support/pull-request-samples.js";

const NOT_REQUIRED = "not-required";
const UNREAD = "merge-protection-unread";
const CANARIES = "canaries";

/** A minute after the samples were recorded, under the samples' digest. */
const AT_SOON_AFTER = {
  now: SOON_AFTER,
  checksDigest: SAMPLE_CHECKS.digest,
};

/** Both halves of a canary proof that held, on record a minute ago. */
const EARLIER_PROOF: readonly EvidenceRecord[] = [
  ...heldPair(SAMPLE_ENTRY, "SI7", { moment: PULL_REQUEST }),
  observedRecord(SAMPLE_ENTRY),
];

describe("what the platform's settings said, as an evidence result", () => {
  it.each([
    ["required", "held", OBSERVED_REQUIRED],
    [NOT_REQUIRED, "failed", "observed-not-required"],
    ["unknown", "unknown", UNREAD],
  ] as const)(
    "says a check that is %s shows the control %s",
    (observed, result, reason) => {
      const batch = pullRequestBatch(
        settled([point({ observed, reason, detail: `Why: ${reason}.` })]),
        [],
        AT_SOON_AFTER
      );

      expect(batch.entries).toEqual([SAMPLE_ENTRY]);
      expect(batch.moments).toEqual([PULL_REQUEST]);
      expect(batch.results).toEqual([
        expect.objectContaining({
          entry_id: SAMPLE_ENTRY,
          moment: PULL_REQUEST,
          rung: "observed",
          result,
          reason,
          command: null,
          exit_status: null,
          started_at: READ_AT,
          completed_at: READ_AT,
          output_excerpt: `"${SAMPLE_CHECK}": required`,
          output_truncated: false,
        }),
      ]);
      expect(batch.results[0]).not.toHaveProperty("half");
    }
  );

  it("says in plain words what was read when the check is required", () => {
    const [result] = pullRequestBatch(
      settled([point()]),
      [],
      AT_SOON_AFTER
    ).results;

    expect(result?.detail).toBe(
      `The hosting platform requires "${SAMPLE_CHECK}" on main before a pull request can be merged. That was read from its merge-protection settings; no change was planted to see the check turn one away.`
    );
  });

  it("keeps the settlement's own sentence when the check is not required or could not be read", () => {
    const [result] = pullRequestBatch(
      settled([
        point({
          observed: NOT_REQUIRED,
          reason: "observed-not-required",
          detail: "The hosting platform does not require it.",
        }),
      ]),
      [],
      AT_SOON_AFTER
    ).results;

    expect(result?.detail).toBe("The hosting platform does not require it.");
  });

  it("writes nothing for an entry the platform was not asked about, and still speaks for it", () => {
    const batch = pullRequestBatch(
      settled([
        point({
          observed: "not-asked",
          reason: "not-asked-of-platform",
          checks: [],
        }),
      ]),
      [],
      AT_SOON_AFTER
    );

    expect(batch.results).toEqual([]);
    expect(batch.entries).toEqual([SAMPLE_ENTRY]);
  });
});

describe("an exercised canary pair, as evidence results", () => {
  it("is the observed result and one result per half", () => {
    const batch = pullRequestBatch(
      settled([exercisedPoint()], CANARIES),
      [],
      AT_SOON_AFTER
    );

    expect(
      batch.results.map(result => [
        result.rung,
        result.half ?? null,
        result.result,
        result.reason,
      ])
    ).toEqual([
      ["observed", null, "held", OBSERVED_REQUIRED],
      ["exercised", "violation", "held", "rejected-as-declared"],
      ["exercised", "clean", "held", "accepted"],
    ]);
  });

  it("dates the observed result no later than the first canary began", () => {
    const [observed] = pullRequestBatch(
      settled([exercisedPoint()], CANARIES),
      [],
      AT_SOON_AFTER
    ).results;

    expect(observed).toMatchObject({
      started_at: CANARY_BEGAN,
      completed_at: CANARY_BEGAN,
    });
  });

  it.each([
    ["violation", "rejected", "held"],
    ["violation", "accepted", "failed"],
    ["violation", "unknown", "unknown"],
    ["clean", "accepted", "held"],
    ["clean", "rejected", "failed"],
    ["clean", "unknown", "unknown"],
  ] as const)(
    "says a %s canary the platform %s shows the control %s",
    (half, outcome, result) => {
      const batch = pullRequestBatch(
        settled(
          [
            half === "violation"
              ? exercisedPoint(outcome, "accepted")
              : exercisedPoint("rejected", outcome),
          ],
          CANARIES
        ),
        [],
        AT_SOON_AFTER
      );

      expect(batch.results.find(each => each.half === half)).toMatchObject({
        rung: "exercised",
        moment: PULL_REQUEST,
        result,
        command: null,
        exit_status: null,
      });
    }
  );

  it("is handed over by this step only: the paired-proof batch leaves a pull-request half out", () => {
    const run = proofRunOf([entryResultOf(exercisedPoint())]);

    expect(run.entries[0]?.halves).toHaveLength(2);
    expect(proofRunBatch(run).results).toEqual([]);
  });
});

describe("a run that only read the settings, and an earlier canary proof", () => {
  it("leaves the entry out, so the proof and its observation stay on record", () => {
    const batch = pullRequestBatch(
      settled([point()]),
      EARLIER_PROOF,
      AT_SOON_AFTER
    );

    expect(batch).toEqual({
      entries: [],
      moments: [PULL_REQUEST],
      results: [],
    });
  });

  it("still leaves it out when the settings could not be read today", () => {
    const batch = pullRequestBatch(
      settled([point({ observed: "unknown", reason: UNREAD })]),
      EARLIER_PROOF,
      AT_SOON_AFTER
    );

    expect(batch.entries).toEqual([]);
  });

  it("keeps a canary failure on record as well as a canary pass", () => {
    const failure = EARLIER_PROOF.map(record =>
      record.half === "violation"
        ? { ...record, result: "failed" as const }
        : record
    );

    expect(
      pullRequestBatch(settled([point()]), failure, AT_SOON_AFTER).entries
    ).toEqual([]);
  });

  it.each([
    [
      "the platform no longer requires the check",
      settled([point({ observed: NOT_REQUIRED })]),
      EARLIER_PROOF,
      SOON_AFTER,
    ],
    [
      "the proof is past its lifetime",
      settled([point()]),
      EARLIER_PROOF,
      EXPIRY,
    ],
    [
      "the earlier canaries gave no answer",
      settled([point()]),
      EARLIER_PROOF.map(record => ({ ...record, result: "unknown" as const })),
      SOON_AFTER,
    ],
    [
      "this run was asked for canaries",
      settled([point()], CANARIES),
      EARLIER_PROOF,
      SOON_AFTER,
    ],
    [
      "the earlier proof was of another moment",
      settled([point()]),
      heldPair(SAMPLE_ENTRY),
      SOON_AFTER,
    ],
  ] as const)(
    "replaces what is on record when %s",
    (_name, settlement, earlier, now) => {
      const batch = pullRequestBatch(settlement, earlier, {
        now,
        checksDigest: SAMPLE_CHECKS.digest,
      });

      expect(batch.entries).toEqual([SAMPLE_ENTRY]);
      expect(batch.results).toHaveLength(1);
    }
  );
});

describe("the batches of a run", () => {
  it("are none when the register has no pull-request entry", () => {
    expect(
      pullRequestBatches(proofRunOf([]), { root: "/nowhere", ...AT_SOON_AFTER })
    ).toEqual([]);
  });

  it("are one, for the pull-request moment, when it has", () => {
    const run = { ...proofRunOf([]), pull_request: settled([point()]) };

    expect(
      pullRequestBatches(run, { root: "/nowhere", ...AT_SOON_AFTER })
    ).toEqual([
      expect.objectContaining({
        entries: [SAMPLE_ENTRY],
        moments: [PULL_REQUEST],
      }),
    ]);
  });
});

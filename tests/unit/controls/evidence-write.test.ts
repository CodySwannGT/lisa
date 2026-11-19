/**
 * What the attest step writes down as evidence (CodySwannGT/lisa#4998).
 *
 * One record per result per requirement, with an identifier made only of
 * what the record is about, so a later run replaces a record instead of
 * adding one beside it.
 */
import { describe, expect, it } from "vitest";

import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  EVIDENCE_EXCERPT_LIMIT,
  type EvidenceBatch,
  type EvidenceRecord,
  type EvidenceResultInput,
} from "../../../src/controls/evidence-types.js";
import {
  batchRecords,
  prepareEvidenceExcerpt,
  proofRunBatch,
  type EvidenceStamp,
} from "../../../src/controls/evidence-write.js";
import {
  hasBothProofHalves,
  parseProofHalfRecords,
} from "../../../src/controls/proof-halves.js";
import { proofRunOf } from "../../../src/controls/proof-runner.js";
import type {
  ProofEntryResult,
  ProofHalfResult,
} from "../../../src/controls/proof-types.js";
import {
  entryServing,
  evidenceOf,
  RECORDED_AT,
  registerOf,
  SAMPLE_CHECKS,
  SAMPLE_COMMIT,
} from "./support/evidence-samples.js";

const API = "code-style@api";
const PULL_REQUEST = "pull-request";
const REJECTED = "rejected";
const FAILURE_TEXT = "Found 1 error";
const STAMP: EvidenceStamp = {
  commit: SAMPLE_COMMIT,
  freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
  checksDigest: SAMPLE_CHECKS.digest,
};

/**
 * One half as the paired-proof runner reports it.
 * @param half - Which half
 * @param outcome - What the check did with the change
 * @param entryId - The register entry
 * @returns The half's result
 */
function ranHalf(
  half: ProofHalfResult["half"],
  outcome: ProofHalfResult["outcome"],
  entryId = API
): ProofHalfResult {
  return {
    entry_id: entryId,
    half,
    moment: "commit",
    patch: `.lisa/controls/proofs/lint.${half}.patch`,
    command: ["ruff", "check", "."],
    exit_status: outcome === REJECTED ? 1 : 0,
    started_at: "2026-11-17T11:59:58.000Z",
    completed_at: RECORDED_AT,
    output_excerpt: outcome === REJECTED ? FAILURE_TEXT : "All good",
    output_truncated: false,
    matched_lines: [],
    outcome,
    reason: outcome === REJECTED ? "rejected-as-declared" : "accepted",
    detail: `The ${half} change was ${outcome}.`,
  };
}

/**
 * One entry's result as the paired-proof runner reports it.
 * @param halves - The halves that were run
 * @param entryId - The register entry
 * @returns The entry's result
 */
function ranEntry(
  halves: readonly ProofHalfResult[],
  entryId = API
): ProofEntryResult {
  return {
    entry_id: entryId,
    gate: "code-style",
    scope: "api",
    criteria: ["SI7"],
    moment: halves.length === 0 ? null : "commit",
    outcome: halves.length === 0 ? "unproved" : "passed",
    failed_halves: [],
    reason: halves.length === 0 ? "half-missing" : "proved",
    detail: "",
    time_limit_seconds: halves.length === 0 ? null : 120,
    halves,
  };
}

const PASSED = [ranHalf("violation", REJECTED), ranHalf("clean", "accepted")];

/**
 * The records a run's results become.
 * @param batches - What each run found out
 * @param criteria - The requirements the entry serves
 * @returns The records
 */
function written(
  batches: readonly EvidenceBatch[],
  criteria: readonly string[] = ["SI7"]
): readonly EvidenceRecord[] {
  const built = batchRecords(
    batches,
    registerOf(entryServing(API, criteria)),
    STAMP
  );
  if (built.problems !== null) throw new Error(built.problems.join("\n"));
  return built.records;
}

describe("the records of a paired proof", () => {
  it("are one per half, carrying what the requirement asks a record to carry", () => {
    const records = written([proofRunBatch(proofRunOf([ranEntry(PASSED)]))]);

    expect(records).toEqual([
      {
        id: `${API}/commit/violation/SI7`,
        criterion: "SI7",
        entry_id: API,
        scope: "api",
        rung: "exercised",
        half: "violation",
        moment: "commit",
        result: "held",
        reason: "rejected-as-declared",
        detail: "The violation change was rejected.",
        commit: SAMPLE_COMMIT,
        checks_digest: SAMPLE_CHECKS.digest,
        command: ["ruff", "check", "."],
        exit_status: 1,
        started_at: "2026-11-17T11:59:58.000Z",
        completed_at: RECORDED_AT,
        freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
        output_excerpt: FAILURE_TEXT,
        output_truncated: false,
      },
      expect.objectContaining({
        id: `${API}/commit/clean/SI7`,
        half: "clean",
        result: "held",
        exit_status: 0,
      }),
    ]);
    expect(parseEvidenceDocument(evidenceOf(records)).problems).toBeNull();
  });

  it.each([
    ["violation", REJECTED, "held"],
    ["violation", "accepted", "failed"],
    ["violation", "unknown", "unknown"],
    ["clean", "accepted", "held"],
    ["clean", REJECTED, "failed"],
    ["clean", "unknown", "unknown"],
  ] as const)(
    "say a %s change that was %s shows the control %s",
    (half, outcome, result) => {
      const [record] = written([
        proofRunBatch(proofRunOf([ranEntry([ranHalf(half, outcome)])])),
      ]);

      expect(record).toMatchObject({ half, result });
    }
  );

  it("are written once for each requirement the entry serves", () => {
    const records = written(
      [proofRunBatch(proofRunOf([ranEntry(PASSED)]))],
      ["SI7", "AC5.4"]
    );

    expect(records.map(record => record.id)).toEqual([
      `${API}/commit/violation/SI7`,
      `${API}/commit/violation/AC5.4`,
      `${API}/commit/clean/SI7`,
      `${API}/commit/clean/AC5.4`,
    ]);
  });

  it("are not written for an entry that serves no requirement", () => {
    expect(
      written([proofRunBatch(proofRunOf([ranEntry(PASSED)]))], [])
    ).toEqual([]);
  });

  it("have the same identifiers on every run", () => {
    const later = PASSED.map(half => ({
      ...half,
      started_at: "2026-12-01T00:00:00.000Z",
      completed_at: "2026-12-01T00:00:01.000Z",
    }));
    const ids = (halves: readonly ProofHalfResult[]): readonly string[] =>
      written([proofRunBatch(proofRunOf([ranEntry(halves)]))]).map(
        record => record.id
      );

    expect(ids(later)).toEqual(ids(PASSED));
  });

  it("clear an entry's unproved mark only when both halves held", () => {
    const pullRequest = (halves: readonly ProofHalfResult[]): boolean =>
      hasBothProofHalves(
        parseProofHalfRecords(
          evidenceOf(
            written([
              {
                entries: [API],
                moments: [PULL_REQUEST],
                results: proofRunBatch(
                  proofRunOf([ranEntry(halves)])
                ).results.map(result => ({
                  ...result,
                  moment: PULL_REQUEST,
                })),
              },
            ])
          )
        ),
        API,
        PULL_REQUEST
      );

    expect(pullRequest(PASSED)).toBe(true);
    expect(
      pullRequest([
        ranHalf("violation", "accepted"),
        ranHalf("clean", "accepted"),
      ])
    ).toBe(false);
  });
});

describe("a result another step hands the writer", () => {
  const observed: EvidenceResultInput = {
    entry_id: API,
    moment: PULL_REQUEST,
    rung: "observed",
    result: "held",
    reason: "check-required",
    detail: "The hosting platform requires this check before a merge.",
    command: null,
    exit_status: null,
    started_at: RECORDED_AT,
    completed_at: RECORDED_AT,
    output_excerpt: "",
    output_truncated: false,
  };
  const batch = (results: readonly EvidenceResultInput[]): EvidenceBatch => ({
    entries: [API],
    moments: [PULL_REQUEST],
    results,
  });

  it("becomes an observed record that names no half", () => {
    const [record] = written([batch([observed])]);

    expect(record).toMatchObject({
      id: `${API}/pull-request/observed/SI7`,
      rung: "observed",
      moment: PULL_REQUEST,
      result: "held",
    });
    expect(record).not.toHaveProperty("half");
    expect(parseEvidenceDocument(evidenceOf(record ?? [])).problems).toBeNull();
  });

  it.each([
    [
      "names an entry the register does not hold",
      { entry_id: "gone@." },
      "holds no entry",
    ],
    [
      "is observed and names a half",
      { half: "clean" as const },
      "names its half",
    ],
    [
      "is exercised and names no half",
      { rung: "exercised" as const },
      "names its half",
    ],
    [
      "is for a moment its run did not speak for",
      { moment: "commit" },
      "does not say it spoke for",
    ],
  ])("is refused when it %s", (_name, change, saying) => {
    const built = batchRecords(
      [batch([{ ...observed, ...change }])],
      registerOf(entryServing(API)),
      STAMP
    );

    expect(built.problems?.join("\n")).toContain(saying);
  });
});

describe("the end of a check's output kept in a record", () => {
  it("is all of it when it is short", () => {
    expect(prepareEvidenceExcerpt(FAILURE_TEXT, false)).toEqual({
      output_excerpt: FAILURE_TEXT,
      output_truncated: false,
    });
  });

  it("is the last lines of it, and says so, when it is long", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`);
    const kept = prepareEvidenceExcerpt(lines.join("\n"), false);

    expect(kept.output_truncated).toBe(true);
    expect(kept.output_excerpt.length).toBeLessThanOrEqual(
      EVIDENCE_EXCERPT_LIMIT
    );
    expect(kept.output_excerpt.endsWith("line 399")).toBe(true);
    expect(kept.output_excerpt.startsWith("line ")).toBe(true);
  });

  it("stays marked as cut when the runner had already cut it", () => {
    expect(prepareEvidenceExcerpt("tail", true).output_truncated).toBe(true);
  });
});

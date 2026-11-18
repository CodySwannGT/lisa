/**
 * A record somebody added to the evidence file by hand does not outlive a
 * real attest run.
 *
 * A run replaces what it speaks for and leaves the rest of the file alone,
 * so that a pull-request proof is not thrown away by a run that only read
 * the settings. That rule must not be a way in: a pair of records typed in
 * at a moment no run ever speaks for, with a lifetime of a year, would
 * otherwise be kept by every later run, given a fresh digest, and read as a
 * proof for a year.
 */
import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
  type EvidenceBatch,
  type EvidenceDocument,
  type EvidenceRecord,
} from "../../../src/controls/evidence-types.js";
import {
  EVIDENCE_MOMENTS,
  mergedEvidence,
} from "../../../src/controls/evidence-write.js";
import type { ControlRegisterEntry } from "../../../src/controls/register-types.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkVerdict,
  editJson,
  evidenceIn,
  record,
  RECORDED_NOW,
  verdictIn,
} from "./support/attest-record-run.js";
import {
  entryServing,
  heldPair,
  observedRecord,
  registerOf,
} from "./support/evidence-samples.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const API = "code-style@api";
const WHOLE = "code-style@.";
const A_YEAR = { freshness_seconds: MAX_FRESHNESS_SECONDS };
const PULL_REQUEST = "pull-request";

/** What a run at commit and push speaks for. */
const LOCAL: EvidenceBatch = {
  entries: [API],
  moments: ["commit", "push"],
  results: [],
};

/** The sample entry, enforced at commit only. */
const AT_COMMIT = entryServing(API);

/** The same entry, enforced on pull requests too. */
const ON_PULL_REQUESTS: ControlRegisterEntry = {
  ...AT_COMMIT,
  enforcement_points: [
    ...AT_COMMIT.enforcement_points,
    { moment: PULL_REQUEST, level: "required", location: "hosting-platform" },
  ],
};

/**
 * The records that stand after a run at commit and push that found nothing.
 * @param entry - The register's one entry
 * @param earlier - What the evidence file held before
 * @returns The records
 */
function after(
  entry: ControlRegisterEntry,
  earlier: readonly EvidenceRecord[]
): readonly EvidenceRecord[] {
  return mergedEvidence({
    earlier,
    register: registerOf(entry),
    batches: [LOCAL],
    records: [],
  });
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("an earlier record at a moment no attest run speaks for", () => {
  it("is not kept, whatever lifetime it claims", () => {
    expect(
      after(AT_COMMIT, heldPair(API, "SI7", { moment: "nightly", ...A_YEAR }))
    ).toEqual([]);
    expect(
      after(AT_COMMIT, heldPair(API, "SI7", { moment: "post-tool" }))
    ).toEqual([]);
  });

  it("is not kept even when the entry is enforced at that moment", () => {
    const nightly: ControlRegisterEntry = {
      ...AT_COMMIT,
      enforcement_points: [
        { moment: "nightly", level: "required", location: "scheduled-run" },
      ],
    };

    expect(after(nightly, heldPair(API, "SI7", { moment: "nightly" }))).toEqual(
      []
    );
  });

  it("names commit, push and pull-request as the moments a run speaks for", () => {
    expect(EVIDENCE_MOMENTS).toEqual(["commit", "push", PULL_REQUEST]);
  });
});

describe("an earlier record at a moment its entry is not enforced at", () => {
  it("is not kept: a pull-request proof of a check that does not run on pull requests", () => {
    expect(
      after(AT_COMMIT, [
        ...heldPair(API, "SI7", { moment: PULL_REQUEST, ...A_YEAR }),
        observedRecord(API),
      ])
    ).toEqual([]);
  });
});

describe("an earlier record the run did not speak for and may keep", () => {
  it("is kept when its entry is enforced at its moment", () => {
    const pair = heldPair(API, "SI7", { moment: PULL_REQUEST });

    expect(after(ON_PULL_REQUESTS, pair)).toEqual(pair);
  });

  it("is never relied on for longer than the default lifetime", () => {
    const kept = after(
      ON_PULL_REQUESTS,
      heldPair(API, "SI7", { moment: PULL_REQUEST, ...A_YEAR })
    );

    expect(kept.map(each => each.freshness_seconds)).toEqual([
      DEFAULT_FRESHNESS_SECONDS,
      DEFAULT_FRESHNESS_SECONDS,
    ]);
  });

  it("keeps a lifetime shorter than the default as it is", () => {
    const kept = after(
      ON_PULL_REQUESTS,
      heldPair(API, "SI7", { moment: PULL_REQUEST, freshness_seconds: 60 })
    );

    expect(kept.map(each => each.freshness_seconds)).toEqual([60, 60]);
  });
});

describe("a real attest run after a pair was added by hand", () => {
  it("removes a pair added at a moment no run covers, so an unproved check is not read as proved for a year", async () => {
    // The check declares one half only, so no proof can be run for it.
    const where = setting(
      provedGates([{ command: checks(F_NONE_SOURCE), without: ["clean"] }])
    );
    await record(where);
    const stamped = evidenceIn(where.repoPath).records.length;
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, current => ({
      ...current,
      records: [
        ...current.records,
        ...heldPair(WHOLE, "SI7", {
          moment: "nightly",
          commit: null,
          completed_at: RECORDED_NOW.toISOString(),
          started_at: RECORDED_NOW.toISOString(),
          ...A_YEAR,
        }),
      ],
    }));

    const recorded = await record(where);
    const verdict = verdictIn(where.repoPath).criteria.find(
      each => each.criterion === "SI7"
    );

    expect(recorded.problems).toBeNull();
    expect(evidenceIn(where.repoPath).records).toHaveLength(stamped);
    expect(
      evidenceIn(where.repoPath).records.filter(
        each => each.moment === "nightly"
      )
    ).toEqual([]);
    expect(verdict).toMatchObject({ verdict: "unknown", rung: null });
    expect((await checkVerdict(where.repoPath)).code).toBe(0);
  });
});

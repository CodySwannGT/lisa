/**
 * The evidence the report check reads.
 *
 * A finding may only say `proved` when an attestation record backs it. The
 * record is written by the attest step; this is the reading half, pinned so
 * the writer has an exact shape to produce (CodySwannGT/lisa#4978).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EVIDENCE_PATH,
  evidenceExpiry,
  isEvidenceFresh,
  parseEvidenceRecords,
  readEvidenceRecords,
} from "../../../src/controls/evidence.js";
import {
  buildFNone,
  type ControlAuditFixture,
} from "../../helpers/control-audit-fixtures.js";
import { writeEvidenceRecords } from "../../helpers/control-audit-report.js";

const RECORD = {
  id: "ev-0001",
  criterion: "AC5.1",
  completed_at: "2026-11-17T12:00:00.000Z",
  freshness_seconds: 3600,
} as const;

const fixtures: ControlAuditFixture[] = [];

/**
 * Build F-none and remember to remove it.
 * @returns The fixture
 */
function fixture(): ControlAuditFixture {
  const built = buildFNone();
  fixtures.push(built);
  return built;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("the evidence file", () => {
  it("lives at the path the control commands share", () => {
    expect(EVIDENCE_PATH).toBe(".lisa/controls/evidence.json");
  });

  it("is no evidence at all when the file is missing", () => {
    expect(readEvidenceRecords(fixture().repoPath)).toEqual([]);
  });

  it("yields the records the file holds", () => {
    const { repoPath } = fixture();
    writeEvidenceRecords(repoPath, [RECORD]);

    expect(readEvidenceRecords(repoPath)).toEqual([RECORD]);
  });

  it("is no evidence when the file cannot be parsed", () => {
    const { repoPath } = fixture();
    const file = path.join(repoPath, EVIDENCE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");

    expect(readEvidenceRecords(repoPath)).toEqual([]);
  });
});

describe("parseEvidenceRecords", () => {
  it("reads the four fields and ignores the rest of a record", () => {
    expect(
      parseEvidenceRecords({
        schema_version: 1,
        records: [
          {
            ...RECORD,
            entry_id: "lint:api",
            exit_status: 1,
            rung: "exercised",
          },
        ],
      })
    ).toEqual([RECORD]);
  });

  it.each([
    { name: "no id", record: { ...RECORD, id: "" } },
    { name: "no criterion", record: { ...RECORD, criterion: 7 } },
    {
      name: "a time that is not canonical UTC",
      record: { ...RECORD, completed_at: "2026-11-17 12:00" },
    },
    {
      name: "a lifetime that is not a whole number of seconds",
      record: { ...RECORD, freshness_seconds: 1.5 },
    },
    { name: "a lifetime of zero", record: { ...RECORD, freshness_seconds: 0 } },
    { name: "a value that is not a record", record: "ev-0001" },
  ])("drops a record with $name: it can back nothing", ({ record }) => {
    expect(parseEvidenceRecords({ records: [record, RECORD] })).toEqual([
      RECORD,
    ]);
  });

  it.each([
    { name: "a violating change that was let through", result: "failed" },
    { name: "a check that gave no answer", result: "unknown" },
    { name: "a requirement that does not apply", result: "not-applicable" },
  ])("drops a record of $name: it proves nothing", ({ result }) => {
    expect(
      parseEvidenceRecords({ records: [{ ...RECORD, result }, RECORD] })
    ).toEqual([RECORD]);
  });

  it("keeps a record that says what it looked at held", () => {
    expect(
      parseEvidenceRecords({
        records: [{ ...RECORD, entry_id: "lint@api", result: "held" }],
      })
    ).toEqual([RECORD]);
  });

  it("drops a record written from the audit's own finding: an audit cannot cite itself", () => {
    expect(
      parseEvidenceRecords({
        records: [{ ...RECORD, entry_id: null, result: "held" }],
      })
    ).toEqual([]);
  });

  it.each([
    { name: "a bare list", document: [RECORD] },
    { name: "no records key", document: { evidence: [RECORD] } },
    { name: "nothing", document: null },
  ])("reads $name as no evidence", ({ document }) => {
    expect(parseEvidenceRecords(document)).toEqual([]);
  });
});

describe("evidence freshness", () => {
  it("expires a record when its lifetime has passed since it completed", () => {
    expect(evidenceExpiry(RECORD).toISOString()).toBe(
      "2026-11-17T13:00:00.000Z"
    );
  });

  it.each([
    { at: "2026-11-17T12:00:00.000Z", fresh: true },
    { at: "2026-11-17T12:59:59.999Z", fresh: true },
    { at: "2026-11-17T13:00:00.000Z", fresh: false },
    { at: "2026-11-18T12:00:00.000Z", fresh: false },
    // A record from the future was not produced by a run that has happened.
    { at: "2026-11-17T11:59:59.999Z", fresh: false },
  ])("at $at fresh is $fresh", ({ at, fresh }) => {
    expect(isEvidenceFresh(RECORD, new Date(at))).toBe(fresh);
  });
});

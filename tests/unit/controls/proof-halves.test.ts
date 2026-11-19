/**
 * Which evidence records say a half of an entry's paired proof is on record.
 *
 * The control register reads an entry whose pull-request check runs from a
 * file Lisa did not write as unproved until both halves of its proof are on
 * record. The attest step writes those records; this is the reading half,
 * pinned so the writer has exact fields to produce (CodySwannGT/lisa#4991).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import {
  PROOF_HALVES,
  hasBothProofHalves,
  parseProofHalfRecords,
  readEvidenceDocument,
  type ProofHalfRecord,
} from "../../../src/controls/proof-halves.js";
import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import { writeEvidenceRecords } from "../../helpers/control-audit-report.js";
import { bothHalves, proofRecord } from "./support/executor-fixtures.js";
import { keep, removeFixtures } from "./support/report-check-run.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const ENTRY = "code-style@api";
const PULL_REQUEST = "pull-request";

/**
 * The records a document yields.
 * @param records - The `records` of an evidence file
 * @returns What the reader keeps of them
 */
function kept(records: readonly unknown[]): readonly ProofHalfRecord[] {
  return parseProofHalfRecords({ records });
}

afterEach(removeFixtures);

describe("a record of one half of a proof", () => {
  it("names the two halves the way a proof declares them", () => {
    expect(PROOF_HALVES).toEqual(["violation", "clean"]);
  });

  it("is read as the entry, the half, the moment it was run at and whether it held", () => {
    expect(
      kept([
        proofRecord(ENTRY, "violation"),
        proofRecord(ENTRY, "clean", { moment: PULL_REQUEST, commit: "abc" }),
      ])
    ).toEqual([
      { entry_id: ENTRY, half: "violation", moment: null, held: true },
      { entry_id: ENTRY, half: "clean", moment: PULL_REQUEST, held: true },
    ]);
  });

  it.each([
    ["says the half failed", { result: "failed" }],
    ["says the half gave no answer", { result: "unknown" }],
    ["does not say what the half showed", { result: undefined }],
  ])("is read as a half that did not hold when it %s", (_name, change) => {
    expect(kept([proofRecord(ENTRY, "violation", change)])).toEqual([
      { entry_id: ENTRY, half: "violation", moment: null, held: false },
    ]);
  });

  it.each([
    ["names no entry", { entry_id: undefined }],
    ["names an empty entry", { entry_id: "" }],
    ["names the entry as a number", { entry_id: 7 }],
    ["names no half", { half: undefined }],
    ["names a half that is neither", { half: "both" }],
    ["names its moment as something other than text", { moment: 3 }],
    ["has no id", { id: undefined }],
    ["has no requirement", { criterion: undefined }],
    ["has no completion time", { completed_at: undefined }],
    ["has a completion time in another form", { completed_at: "2026-11-17" }],
    ["has no freshness lifetime", { freshness_seconds: undefined }],
  ])("is not read when it %s", (_name, change) => {
    expect(kept([proofRecord(ENTRY, "violation", change)])).toEqual([]);
  });

  it.each([
    ["nothing", null],
    ["a list", []],
    ["an object with no records", {}],
    ["records that are not a list", { records: {} }],
    ["records that are not objects", { records: ["violation", 3, null] }],
  ])("is not found in %s", (_name, document) => {
    expect(parseProofHalfRecords(document)).toEqual([]);
  });
});

describe("both halves of an entry's proof", () => {
  const records = (
    extra?: Readonly<Record<string, unknown>>
  ): readonly ProofHalfRecord[] => kept(bothHalves(ENTRY, extra));

  it("are on record when each has a record that says it held", () => {
    expect(hasBothProofHalves(records(), ENTRY, PULL_REQUEST)).toBe(true);
  });

  it.each(PROOF_HALVES)(
    "are not when the %s half was run and did not hold",
    half => {
      const other = PROOF_HALVES.find(each => each !== half) ?? half;

      expect(
        hasBothProofHalves(
          kept([
            proofRecord(ENTRY, half, { result: "failed" }),
            proofRecord(ENTRY, other),
          ]),
          ENTRY,
          PULL_REQUEST
        )
      ).toBe(false);
    }
  );

  it("are not when the records do not say what each half showed", () => {
    expect(
      hasBothProofHalves(records({ result: undefined }), ENTRY, PULL_REQUEST)
    ).toBe(false);
  });

  it("are when a half that failed has a record that held beside it", () => {
    expect(
      hasBothProofHalves(
        kept([
          proofRecord(ENTRY, "violation", { result: "failed" }),
          ...bothHalves(ENTRY),
        ]),
        ENTRY,
        PULL_REQUEST
      )
    ).toBe(true);
  });

  it.each(PROOF_HALVES)("are not when only the %s half has", half => {
    expect(
      hasBothProofHalves(kept([proofRecord(ENTRY, half)]), ENTRY, PULL_REQUEST)
    ).toBe(false);
  });

  it("are not when the records are of another entry", () => {
    expect(hasBothProofHalves(records(), "code-style@web", PULL_REQUEST)).toBe(
      false
    );
  });

  it("are when the records say they were run at the moment asked about", () => {
    expect(
      hasBothProofHalves(records({ moment: PULL_REQUEST }), ENTRY, PULL_REQUEST)
    ).toBe(true);
  });

  it("are not when the records say they were run at another moment", () => {
    expect(
      hasBothProofHalves(records({ moment: "commit" }), ENTRY, PULL_REQUEST)
    ).toBe(false);
  });

  it("are not when one half was run at another moment", () => {
    expect(
      hasBothProofHalves(
        kept([
          proofRecord(ENTRY, "violation", { moment: PULL_REQUEST }),
          proofRecord(ENTRY, "clean", { moment: "push" }),
        ]),
        ENTRY,
        PULL_REQUEST
      )
    ).toBe(false);
  });
});

describe("the evidence file of a repository", () => {
  it("is nothing when it is missing", () => {
    expect(readEvidenceDocument(keep(buildFNone()).repoPath)).toBeNull();
  });

  it("is what it holds", () => {
    const { repoPath } = keep(buildFNone());
    writeEvidenceRecords(repoPath, bothHalves(ENTRY));

    expect(parseProofHalfRecords(readEvidenceDocument(repoPath))).toHaveLength(
      2
    );
  });

  it("is nothing when it is not JSON", () => {
    const { repoPath } = keep(buildFNone());
    const file = path.join(repoPath, EVIDENCE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");

    expect(readEvidenceDocument(repoPath)).toBeNull();
  });

  it("is nothing when it is reached through a link", () => {
    const { repoPath } = keep(buildFNone());
    const outside = keep(buildFNone()).repoPath;
    writeEvidenceRecords(outside, bothHalves(ENTRY));
    const file = path.join(repoPath, EVIDENCE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    createSymlink(path.join(outside, EVIDENCE_PATH), file);

    expect(readEvidenceDocument(repoPath)).toBeNull();
  });

  it("is nothing when its folder is a link", () => {
    const { repoPath } = keep(buildFNone());
    const outside = keep(buildFNone()).repoPath;
    writeEvidenceRecords(outside, bothHalves(ENTRY));
    mkdirSync(path.join(repoPath, ".lisa"), { recursive: true });
    createSymlink(
      path.join(outside, path.dirname(EVIDENCE_PATH)),
      path.join(repoPath, path.dirname(EVIDENCE_PATH))
    );

    expect(readEvidenceDocument(repoPath)).toBeNull();
  });
});

/**
 * Evidence records, register entries and a small requirements catalogue for
 * the suites that check what the attest step writes and what verdict it
 * computes from it (CodySwannGT/lisa#4998).
 *
 * The full samples are declared `Required<…>` and written as object
 * literals, so the compiler holds each to its type key for key; the suite
 * that compares the published schemas with the types reads them.
 * @module tests/unit/controls/support/evidence-samples
 */
import type { CriterionCatalogue } from "../../../../src/controls/catalogue.js";
import { digestOfCovered } from "../../../../src/controls/checks-binding.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  evidenceRecordId,
  findingRecordId,
  type ChecksBinding,
  type CoveredCheckFile,
  type EvidenceDocument,
  type EvidenceRecord,
  type EvidenceResult,
  type EvidenceRung,
} from "../../../../src/controls/evidence-types.js";
import type { ProofHalf } from "../../../../src/controls/proof-halves.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "../../../../src/controls/register-types.js";
import { BARE_ENTRY } from "./register-samples.js";

/** The moment a setting read from the hosting platform speaks for. */
const PULL_REQUEST_MOMENT = "pull-request";

/** When every sample record was completed. */
export const RECORDED_AT = "2026-11-17T12:00:00.000Z";

/** A moment a minute after the samples were recorded. */
export const SOON_AFTER = new Date("2026-11-17T12:01:00.000Z");

/** The first instant a sample record with the default lifetime is too old. */
export const EXPIRY = new Date(
  Date.parse(RECORDED_AT) + DEFAULT_FRESHNESS_SECONDS * 1000
);

/** A commit hash the samples were recorded at. */
export const SAMPLE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** What the samples say defined the checks: one file, the declaration. */
const SAMPLE_COVERED: readonly CoveredCheckFile[] = [
  { path: ".lisa.config.json", sha256: "a".repeat(64) },
];

/** The binding every sample file carries, with the digest its list gives. */
export const SAMPLE_CHECKS: ChecksBinding = {
  covered: SAMPLE_COVERED,
  digest: digestOfCovered(SAMPLE_COVERED),
};

/** The digest of a run made when the checks were defined differently. */
export const OTHER_CHECKS_DIGEST = "b".repeat(64);

/** One half of a paired proof, with each key available to paired proofs. */
export const HALF_RECORD: Required<Omit<EvidenceRecord, "exercise">> = {
  id: "code-style@api/commit/violation/SI7",
  criterion: "SI7",
  entry_id: "code-style@api",
  scope: "api",
  rung: "exercised",
  half: "violation",
  moment: "commit",
  result: "held",
  reason: "rejected-as-declared",
  detail: "The check turned the violating change away.",
  commit: SAMPLE_COMMIT,
  checks_digest: SAMPLE_CHECKS.digest,
  command: ["ruff", "check", "."],
  exit_status: 1,
  started_at: "2026-11-17T11:59:58.000Z",
  completed_at: RECORDED_AT,
  freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
  output_excerpt: "Found 1 error",
  output_truncated: false,
};

/** An evidence file with every key. */
export const EVIDENCE: Required<EvidenceDocument> = {
  schema_version: 1,
  checks: SAMPLE_CHECKS,
  records: [HALF_RECORD],
};

/** What a sample record may say differently. */
export type RecordChange = Partial<EvidenceRecord>;

/**
 * A record of one half of an entry's paired proof.
 * @param entryId - The register entry
 * @param half - Which half
 * @param criterion - The requirement
 * @param change - What differs from a half that held at commit
 * @returns The record
 */
export function halfRecord(
  entryId: string,
  half: ProofHalf,
  criterion = "SI7",
  change: RecordChange = {}
): EvidenceRecord {
  const moment = change.moment ?? "commit";
  return {
    ...HALF_RECORD,
    id: evidenceRecordId({
      entry_id: entryId,
      moment,
      rung: "exercised",
      half,
      criterion,
    }),
    criterion,
    entry_id: entryId,
    scope: entryId.slice(entryId.indexOf("@") + 1),
    half,
    moment,
    reason: half === "violation" ? "rejected-as-declared" : "accepted",
    exit_status: half === "violation" ? 1 : 0,
    ...change,
  };
}

/**
 * Both halves of an entry's paired proof, each of which held.
 * @param entryId - The register entry
 * @param criterion - The requirement
 * @param change - What differs on both records
 * @returns The two records, the violating half first
 */
export function heldPair(
  entryId: string,
  criterion = "SI7",
  change: RecordChange = {}
): readonly EvidenceRecord[] {
  return [
    halfRecord(entryId, "violation", criterion, change),
    halfRecord(entryId, "clean", criterion, change),
  ];
}

/**
 * A record of a setting read from the hosting platform, with nothing planted.
 * @param entryId - The register entry
 * @param criterion - The requirement
 * @param change - What differs from one that held
 * @returns The record
 */
export function observedRecord(
  entryId: string,
  criterion = "SI7",
  change: RecordChange = {}
): EvidenceRecord {
  const { half: _half, ...rest } = HALF_RECORD;
  return {
    ...rest,
    id: evidenceRecordId({
      entry_id: entryId,
      moment: PULL_REQUEST_MOMENT,
      rung: "observed",
      criterion,
    }),
    criterion,
    entry_id: entryId,
    scope: entryId.slice(entryId.indexOf("@") + 1),
    rung: "observed",
    moment: PULL_REQUEST_MOMENT,
    reason: "check-required",
    detail: "The hosting platform requires this check before a merge.",
    command: null,
    exit_status: null,
    output_excerpt: "",
    ...change,
  };
}

/**
 * A record written from an audit finding.
 * @param criterion - The requirement
 * @param result - What the finding showed
 * @param change - What differs from a finding about the whole repository
 * @returns The record
 */
export function findingRecord(
  criterion: string,
  result: EvidenceResult,
  change: RecordChange = {}
): EvidenceRecord {
  const scope = change.scope ?? ".";
  const { half: _half, ...rest } = HALF_RECORD;
  const rung: EvidenceRung = "asserted";
  return {
    ...rest,
    id: findingRecordId(criterion, scope),
    criterion,
    entry_id: null,
    scope,
    rung,
    moment: null,
    result,
    reason: "exists-not-enforced",
    detail: "The access review is written down in docs/access.md.",
    command: null,
    exit_status: null,
    started_at: RECORDED_AT,
    output_excerpt: "",
    ...change,
  };
}

/**
 * A record of an audit finding about a record that exists, whose file and
 * line the attest step found where the audit pointed.
 * @param criterion - The requirement
 * @param change - What differs from one about the whole repository
 * @returns The record
 */
export function locatedRecord(
  criterion: string,
  change: RecordChange = {}
): EvidenceRecord {
  return findingRecord(criterion, "held", {
    rung: "observed",
    reason: "artifact-located",
    ...change,
  });
}

/**
 * A record of an audit finding a person's answer vouches for.
 * @param criterion - The requirement
 * @param change - What differs from one about the whole repository
 * @returns The record
 */
export function attestedRecord(
  criterion: string,
  change: RecordChange = {}
): EvidenceRecord {
  return findingRecord(criterion, "held", {
    reason: "person-attested",
    ...change,
  });
}

/**
 * An evidence file holding the given records.
 * @param records - The records, in any order and nesting
 * @returns The file
 */
export function evidenceOf(
  ...records: readonly (EvidenceRecord | readonly EvidenceRecord[])[]
): EvidenceDocument {
  return { schema_version: 1, checks: SAMPLE_CHECKS, records: records.flat() };
}

/**
 * A register entry for one gate in one folder.
 * @param id - The entry's identifier, `<gate>@<scope>`
 * @param criteria - The requirements it serves
 * @returns The entry
 */
export function entryServing(
  id: string,
  criteria: readonly string[] = ["SI7"]
): ControlRegisterEntry {
  const at = id.indexOf("@");
  return {
    ...BARE_ENTRY,
    id,
    gate: id.slice(0, at),
    scope: id.slice(at + 1),
    criteria,
  };
}

/**
 * The same entry, enforced on pull requests as well as where it already is.
 * A record at the pull-request moment counts only for such an entry.
 * @param entry - The entry
 * @returns The entry with a pull-request point added
 */
export function onPullRequests(
  entry: ControlRegisterEntry
): ControlRegisterEntry {
  return {
    ...entry,
    enforcement_points: [
      ...entry.enforcement_points,
      {
        moment: PULL_REQUEST_MOMENT,
        level: "required",
        location: "hosting-platform",
      },
    ],
  };
}

/**
 * A register holding the given entries.
 * @param entries - The entries
 * @returns The register
 */
export function registerOf(
  ...entries: readonly ControlRegisterEntry[]
): ControlRegister {
  return { schema_version: 1, entries };
}

/**
 * A catalogue entry the verdict covers.
 * @param id - The requirement's id
 * @param kind - What sort of thing answers it
 * @param minimum - The weakest evidence it accepts
 * @returns The entry
 */
export function requirement(
  id: string,
  kind: string,
  minimum: EvidenceRung
): CriterionCatalogue["criteria"][number] {
  return {
    id,
    title: `Title of ${id}`,
    in_scope: true,
    question: `Is ${id} met?`,
    kind,
    minimum_rung: minimum,
    not_applicable_when: "never",
    answered: "part",
  };
}

/**
 * A small catalogue: one requirement of each kind and minimum the real one
 * has, and one left out of the verdict.
 */
export const SMALL_CATALOGUE: CriterionCatalogue = {
  specification: "spec/sample.md",
  specification_version: "0.0.1",
  level: 1,
  criteria: [
    requirement("AC1.3", "gate", "observed"),
    requirement("AC1.4", "human-attested", "asserted"),
    requirement("AC1.1", "artifact", "observed"),
    {
      id: "UX3",
      title: "Left out",
      in_scope: false,
      excluded_reason: "Not at this level.",
    },
    requirement("SI7", "gate", "exercised"),
  ],
};

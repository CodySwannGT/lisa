/**
 * What one control, or one audit finding, says about one requirement.
 *
 * A requirement is judged on every control in the register that serves it,
 * and, in every folder no such control covers, on the audit's own finding
 * for that folder. Each of those is one answer, worked out here from the
 * evidence records about it. `./verdict.ts` then takes the worst answer.
 *
 * ## Which records are read at all
 *
 * The evidence file is on disk between runs, and anyone can type into it.
 * The writer holds every earlier record it keeps to a short list of rules,
 * and a record typed in after the last run has been through no writer. So
 * the same rules are applied here, on every read (`./evidence-standing.ts`):
 * a record about a control counts only when its moment is one a run writes
 * records for, its entry is enforced at that moment, and it carries the
 * digest the evidence file gives for what defines the checks. A record of
 * an audit finding counts only when it carries that digest. A record that
 * does not count is not read: it can neither make a requirement conforming
 * nor fail it. And no record is relied on for longer than the default
 * lifetime, whatever it states (`evidenceExpiry` in `./evidence.ts`).
 *
 * ## One control
 *
 * In this order, and the first that applies decides:
 *
 * 1. No record of the control for this requirement that counts: `unknown`.
 * 2. A current record that shows a failure: `non-conforming`. A definite
 *    failure outranks a missing answer.
 * 3. A record that is not current (past its lifetime, or dated later than
 *    now): `unknown`.
 * 4. Nothing that held: `unknown`. Exercised evidence holds only as a pair:
 *    both halves, for the same moment, each of which held.
 * 5. What held is weaker than the requirement's minimum rung: `unknown`.
 * 6. Otherwise `conforming`, at the strongest rung that held.
 *
 * ## One audit finding
 *
 * A finding that is not current is `unknown`. Otherwise its result decides:
 * `not-applicable` with the fact it gives, `failed` is `non-conforming`, and
 * `unknown` is `unknown`. A finding that `held` is judged by what kind of
 * thing answers the requirement:
 *
 * - a record that exists (`artifact`): `conforming` when the record's rung
 *   is at least the requirement's minimum. The attest step writes such a
 *   record at the observed rung only after finding the file and line the
 *   audit pointed at, so this is a located file, not a proof, and it never
 *   reaches a requirement that needs exercised evidence;
 * - something a person vouches for (`human-attested`): `conforming` only
 *   when the record says a person's answer is on record. An agent's finding
 *   alone never is;
 * - a check (`gate`), or a kind the catalogue does not name: never
 *   `conforming`. Only a control in the register can show it.
 * @module controls/verdict-answers
 */
import { isEvidenceFresh } from "./evidence.js";
import { standingProblem } from "./evidence-standing.js";
import {
  ARTIFACT_EXERCISED,
  ARTIFACT_KIND,
  EVIDENCE_RUNGS,
  FINDING_REASONS,
  HUMAN_ATTESTED_KIND,
  rungAtLeast,
  type EvidenceRecord,
  type EvidenceRung,
} from "./evidence-types.js";
import { PROOF_HALVES } from "./proof-halves.js";
import type { ControlRegisterEntry } from "./register-types.js";
import {
  NOT_APPLICABLE,
  type CriterionVerdictWord,
  type VerdictReason,
} from "./verdict-types.js";
import {
  CONTROL_WORDS,
  FINDING_WORDS,
  notCurrent,
  setAside,
  whereOf,
} from "./verdict-wording.js";

/** What one control or one audit finding says about a requirement. */
export interface Answer {
  readonly verdict: CriterionVerdictWord;
  readonly reason: VerdictReason;
  /** Why, as a sentence. Empty on an answer that is conforming. */
  readonly detail: string;
  /** The rung a `conforming` answer rests on; `null` otherwise. */
  readonly rung: EvidenceRung | null;
  /** The register entry it is about, or `null` for an audit finding. */
  readonly entry_id: string | null;
  /** The folder it is about. */
  readonly scope: string;
  /** The records it was read from. */
  readonly records: readonly EvidenceRecord[];
  /** The fact that makes it `not-applicable`; `null` otherwise. */
  readonly fact: string | null;
}

/** Why evidence that held still leaves a requirement unknown. */
const RUNG_TOO_LOW = "rung-too-low";

/** What an answer is about, and the records it was read from. */
type AnswerSubject = Pick<Answer, "entry_id" | "scope" | "records">;

/** What judging an answer needs beyond its records. */
export interface AnswerContext {
  /** The weakest evidence the requirement accepts. */
  readonly minimum: EvidenceRung;
  /** What kind of thing answers the requirement, from the catalogue. */
  readonly kind: string;
  /** The current time. */
  readonly now: Date;
  /**
   * The digest the evidence file gives for what defines the checks. A
   * record that carries another one does not count.
   */
  readonly checksDigest: string;
}

/** The part of a register entry a control's answer is worked out from. */
export type AnsweredEntry = Pick<
  ControlRegisterEntry,
  "id" | "scope" | "enforcement_points"
>;

/** The verdict's reason for each reason a finding record gives for `unknown`. */
const UNKNOWN_FINDING_REASONS: Readonly<Record<string, VerdictReason>> = {
  [FINDING_REASONS.notFound]: "artifact-not-found",
  [FINDING_REASONS.noAttestation]: "no-attestation",
};

/**
 * An answer that is not conforming.
 * @param base - What the answer is about and was read from
 * @param verdict - The word
 * @param reason - Why
 * @param detail - The same as a sentence
 * @returns The answer
 */
function short(
  base: AnswerSubject,
  verdict: CriterionVerdictWord,
  reason: VerdictReason,
  detail: string
): Answer {
  return { ...base, verdict, reason, detail, rung: null, fact: null };
}

/**
 * The answer for a record that is not current.
 * @param base - What the answer is about and was read from
 * @param record - The record
 * @param now - The current time
 * @returns The answer
 */
function outOfDate(
  base: AnswerSubject,
  record: EvidenceRecord,
  now: Date
): Answer {
  return short(
    base,
    "unknown",
    Date.parse(record.completed_at) > now.getTime()
      ? "evidence-dated-later"
      : "stale-evidence",
    notCurrent(record, now)
  );
}

/**
 * Tell whether a control's records hold both halves of a proof for one
 * moment, each of which held.
 * @param records - The control's records for one requirement
 * @returns Whether a whole pair held
 */
function pairHeld(records: readonly EvidenceRecord[]): boolean {
  const exercised = records.filter(
    record => record.rung === "exercised" && record.result === "held"
  );
  return exercised.some(first =>
    PROOF_HALVES.every(half =>
      exercised.some(
        record => record.half === half && record.moment === first.moment
      )
    )
  );
}

/**
 * The strongest rung at which a control's records held.
 * @param records - The control's records for one requirement
 * @returns The rung, or `null` when nothing held
 */
function heldRung(records: readonly EvidenceRecord[]): EvidenceRung | null {
  const held = (rung: EvidenceRung): boolean =>
    rung === "exercised"
      ? pairHeld(records)
      : records.some(
          record => record.rung === rung && record.result === "held"
        );
  return [...EVIDENCE_RUNGS].reverse().find(rung => held(rung)) ?? null;
}

/**
 * The answer for a control none of whose records counts.
 * @param entry - The register entry
 * @param onFile - Every record on file about it for this requirement
 * @param context - The digest the evidence file gives for the checks
 * @returns The answer: `unknown`, and why the records were set aside when
 *   there are any
 */
function nothingCounts(
  entry: AnsweredEntry,
  onFile: readonly EvidenceRecord[],
  context: AnswerContext
): Answer {
  const base = { entry_id: entry.id, scope: entry.scope, records: [] };
  const [first] = onFile;
  const problem =
    first === undefined
      ? null
      : standingProblem(first, entry, context.checksDigest);
  return short(
    base,
    "unknown",
    "no-evidence",
    first === undefined || problem === null
      ? CONTROL_WORDS.noEvidence(entry.id)
      : setAside(`the control ${entry.id}`, first, problem)
  );
}

/**
 * What one control says about a requirement.
 * @param entry - The register entry
 * @param onFile - Every evidence record on file about it for this
 *   requirement, whether or not it counts
 * @param context - The requirement's minimum rung, the current time and the
 *   digest the evidence file gives for the checks
 * @returns The answer
 */
export function controlAnswer(
  entry: AnsweredEntry,
  onFile: readonly EvidenceRecord[],
  context: AnswerContext
): Answer {
  const { minimum, now } = context;
  // Read only what a run could have written about the checks as they are.
  const records = onFile.filter(
    record => standingProblem(record, entry, context.checksDigest) === null
  );
  const base = { entry_id: entry.id, scope: entry.scope, records };
  if (records.length === 0) return nothingCounts(entry, onFile, context);
  const failed = records.find(
    record => record.result === "failed" && isEvidenceFresh(record, now)
  );
  if (failed !== undefined) {
    return short(
      base,
      "non-conforming",
      "control-failed",
      CONTROL_WORDS.failed(entry.id, failed)
    );
  }
  const old = records.find(record => !isEvidenceFresh(record, now));
  if (old !== undefined) return outOfDate(base, old, now);
  const rung = heldRung(records);
  if (rung === null) {
    return short(
      base,
      "unknown",
      "proof-incomplete",
      CONTROL_WORDS.incomplete(
        entry.id,
        records.find(record => record.result === "unknown")
      )
    );
  }
  return rungAtLeast(rung, minimum)
    ? {
        ...base,
        verdict: "conforming",
        reason: "control-proved",
        detail: "",
        rung,
        fact: null,
      }
    : short(
        base,
        "unknown",
        RUNG_TOO_LOW,
        CONTROL_WORDS.tooWeak(entry.id, rung, minimum)
      );
}

/**
 * What a current audit finding that held says about a requirement.
 * @param base - What the answer is about and was read from
 * @param record - The record written from the finding
 * @param context - The requirement's kind and minimum rung
 * @returns The answer
 */
function heldFinding(
  base: AnswerSubject,
  record: EvidenceRecord,
  context: AnswerContext
): Answer {
  const { kind, minimum } = context;
  const attested = kind === HUMAN_ATTESTED_KIND;
  if (attested && record.reason !== FINDING_REASONS.attested) {
    return short(
      base,
      "unknown",
      "no-attestation",
      FINDING_WORDS.noAttestation(record)
    );
  }
  if (!attested && kind !== ARTIFACT_KIND) {
    return short(
      base,
      "unknown",
      RUNG_TOO_LOW,
      FINDING_WORDS.needsControl(record)
    );
  }
  return rungAtLeast(record.rung, minimum)
    ? {
        ...base,
        verdict: "conforming",
        reason: attested
          ? "person-attested"
          : record.exercise === undefined
            ? "artifact-located"
            : ARTIFACT_EXERCISED,
        detail: "",
        rung: record.rung,
        fact: null,
      }
    : short(
        base,
        "unknown",
        RUNG_TOO_LOW,
        FINDING_WORDS.tooWeak(record, minimum)
      );
}

/**
 * What a current audit finding says about a requirement.
 * @param base - What the answer is about and was read from
 * @param record - The record written from the finding
 * @param context - The requirement's kind and minimum rung
 * @returns The answer
 */
function currentFinding(
  base: AnswerSubject,
  record: EvidenceRecord,
  context: AnswerContext
): Answer {
  if (record.result === "failed") {
    return short(
      base,
      "non-conforming",
      "nothing-found",
      FINDING_WORDS.failed(record)
    );
  }
  if (record.result === "unknown") {
    const known = UNKNOWN_FINDING_REASONS[record.reason];
    return known === undefined
      ? short(base, "unknown", "audit-unknown", FINDING_WORDS.unknown(record))
      : short(base, "unknown", known, record.detail);
  }
  if (record.result === NOT_APPLICABLE) {
    return {
      ...base,
      verdict: NOT_APPLICABLE,
      reason: NOT_APPLICABLE,
      detail: "",
      rung: null,
      fact: record.detail,
    };
  }
  return heldFinding(base, record, context);
}

/**
 * What one audit finding says about a requirement.
 * @param record - The record written from the finding
 * @param context - The requirement's kind, its minimum rung, the time and
 *   the digest the evidence file gives for the checks
 * @returns The answer
 */
export function findingAnswer(
  record: EvidenceRecord,
  context: AnswerContext
): Answer {
  if (record.checks_digest !== context.checksDigest) {
    return short(
      { entry_id: null, scope: record.scope, records: [] },
      "unknown",
      "no-evidence",
      setAside(
        `the audit's finding about ${whereOf(record.scope)}`,
        record,
        "other-checks"
      )
    );
  }
  const base = { entry_id: null, scope: record.scope, records: [record] };
  return isEvidenceFresh(record, context.now)
    ? currentFinding(base, record, context)
    : outOfDate(base, record, context.now);
}

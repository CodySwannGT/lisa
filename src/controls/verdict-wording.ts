/**
 * The sentences a verdict gives an operator.
 *
 * Each requirement's verdict carries one sentence saying why it came out as
 * it did and, where something can be done about it, what. They are written
 * for someone who has not read the specification: a control is named by its
 * register entry, a folder by its path, and the strength of evidence by its
 * word together with what that word means.
 * @module controls/verdict-wording
 */
import { evidenceExpiry } from "./evidence.js";
import type { StandingProblem } from "./evidence-standing.js";
import type { EvidenceRecord, EvidenceRung } from "./evidence-types.js";
import { WHOLE_REPOSITORY_SCOPE } from "./register-types.js";

/** What each rung means, in a few words. */
const RUNG_MEANING: Readonly<Record<EvidenceRung, string>> = {
  asserted: "asserted (it was said, and nothing checked it)",
  observed:
    "observed (something was looked at where it is: a setting read from the system that holds it, or a file found where the audit pointed)",
  exercised:
    "exercised (a change was planted and the control's answer recorded)",
};

/** What gets a requirement to the rung it needs. */
const HOW_TO_REACH: Readonly<Record<EvidenceRung, string>> = {
  asserted:
    "Run the audit so that it asks a person, and answer its question in the audit report.",
  observed:
    "Run the audit again so that it points at the file and line where this is recorded, or declare a control for it in the gates block.",
  exercised:
    "Declare a control for it in the gates block, with a change that breaks the rule and one that does not, so that the attest step can prove it.",
};

/** What to do when evidence is missing or out of date. */
const RUN_ATTEST_AGAIN = "Run the attest step again.";

/**
 * Name a folder the way a person would.
 * @param scope - The folder, or `.` for the whole repository
 * @returns For example `the folder "api"` or `the whole repository`
 */
export function whereOf(scope: string): string {
  return scope === WHOLE_REPOSITORY_SCOPE
    ? "the whole repository"
    : `the folder "${scope}"`;
}

/**
 * Say a rung together with what it means.
 * @param rung - The rung
 * @returns For example `observed (a setting was read …)`
 */
export function rungInWords(rung: EvidenceRung): string {
  return RUNG_MEANING[rung];
}

/**
 * Say that a record is not current, and why.
 * @param record - The record
 * @param now - The current time
 * @returns The sentence
 */
export function notCurrent(record: EvidenceRecord, now: Date): string {
  return Date.parse(record.completed_at) > now.getTime()
    ? `Evidence record "${record.id}" is dated later than the current time, so it cannot be relied on. ${RUN_ATTEST_AGAIN}`
    : `Evidence record "${record.id}" is too old to rely on: it stopped being current at ${evidenceExpiry(record).toISOString()}. ${RUN_ATTEST_AGAIN}`;
}

/**
 * Say that evidence held at a weaker rung than a requirement needs.
 * @param subject - What the evidence is about, as the start of a sentence
 * @param rung - The rung it has
 * @param minimum - The rung the requirement needs
 * @returns The sentence
 */
export function tooWeak(
  subject: string,
  rung: EvidenceRung,
  minimum: EvidenceRung
): string {
  return `${subject} is ${rungInWords(rung)}, and this requirement needs evidence that is at least ${rungInWords(minimum)}. ${HOW_TO_REACH[minimum]}`;
}

/** Why a record on file does not count, as the end of a sentence. */
const SET_ASIDE: Readonly<Record<StandingProblem, string>> = {
  "unknown-moment":
    "it names a moment at which no attest run records anything about a control",
  "not-enforced-there":
    "it names a moment at which this control is not enforced",
  "other-checks":
    "it was recorded when the checks were defined differently from what the evidence file now says defines them",
};

/**
 * Say that records are on file and none of them counts.
 * @param subject - What the records are about, to follow the word `for`
 * @param record - One of the records
 * @param problem - Why it does not count
 * @returns The sentence
 */
export function setAside(
  subject: string,
  record: EvidenceRecord,
  problem: StandingProblem
): string {
  return `Evidence is on file for ${subject} and none of it counts: record "${record.id}" does not, because ${SET_ASIDE[problem]}. A record counts only when an attest run could have written it about the checks as they are. ${RUN_ATTEST_AGAIN}`;
}

/** The sentences about one control. */
export const CONTROL_WORDS = {
  noEvidence: (entryId: string): string =>
    `No proof of the control ${entryId} is on record for this requirement. Run the attest step.`,
  failed: (entryId: string, record: EvidenceRecord): string =>
    `The control ${entryId} did not work when it was checked. ${record.detail}`,
  incomplete: (entryId: string, unanswered?: EvidenceRecord): string =>
    unanswered === undefined
      ? `The proof of the control ${entryId} is not complete: both halves have to be on record for the same moment, and each has to have held. ${RUN_ATTEST_AGAIN}`
      : `The proof of the control ${entryId} gave no answer that can be relied on. ${unanswered.detail}`,
  tooWeak: (
    entryId: string,
    rung: EvidenceRung,
    minimum: EvidenceRung
  ): string =>
    tooWeak(
      `The strongest evidence on record for the control ${entryId}`,
      rung,
      minimum
    ),
} as const;

/** The sentences about one audit finding. */
export const FINDING_WORDS = {
  failed: (record: EvidenceRecord): string =>
    `The audit found nothing that does this in ${whereOf(record.scope)}. ${record.detail}`,
  unknown: (record: EvidenceRecord): string =>
    `The audit could not establish this for ${whereOf(record.scope)}. ${record.detail}`,
  tooWeak: (record: EvidenceRecord, minimum: EvidenceRung): string =>
    tooWeak(
      `No control in the register covers ${whereOf(record.scope)} for this requirement, and the audit's own finding there`,
      record.rung,
      minimum
    ),
  needsControl: (record: EvidenceRecord): string =>
    `No control in the register covers ${whereOf(record.scope)} for this requirement. It is met by a check that can turn a change away, so the audit finding a tool or a file does not show it. ${HOW_TO_REACH.exercised}`,
  noAttestation: (record: EvidenceRecord): string =>
    `Only a person can vouch for this requirement, and no person's answer to the audit's question about ${whereOf(record.scope)} is on record. Run the audit so that it asks, and answer the question in the audit report.`,
} as const;

/** The sentence for a requirement nothing is on record about. */
export const NOTHING_ON_RECORD =
  "No control in the register serves this requirement, and no audit finding about it is on record. Run the audit, then the attest step.";

/**
 * Say why a requirement is conforming.
 * @param parts - What it rests on
 * @param parts.controls - The controls that held
 * @param parts.located - The folders whose record was found where the audit
 *   pointed
 * @param parts.attested - The folders a person vouched for
 * @param parts.notApplicable - The folders it does not apply in
 * @param parts.rung - The weakest rung it rests on
 * @param parts.minimum - The rung it needs
 * @returns The sentence
 */
export function conformingBecause(parts: {
  readonly controls: readonly string[];
  readonly located: readonly string[];
  readonly attested: readonly string[];
  readonly notApplicable: readonly string[];
  readonly rung: EvidenceRung;
  readonly minimum: EvidenceRung;
}): string {
  const said = [
    ...(parts.controls.length === 0
      ? []
      : [
          `Every control that serves this requirement held when it was checked: ${parts.controls.join(", ")}.`,
        ]),
    ...(parts.located.length === 0
      ? []
      : [
          `The audit pointed at where this is recorded for ${parts.located.map(whereOf).join(" and ")}, and the attest step found the file and line there. That shows the record exists, not that it says what the requirement asks.`,
        ]),
    ...(parts.attested.length === 0
      ? []
      : [
          `A person vouched for it for ${parts.attested.map(whereOf).join(" and ")}, in answer to the audit's question.`,
        ]),
    ...(parts.notApplicable.length === 0
      ? []
      : [
          `It does not apply in ${parts.notApplicable.map(whereOf).join(" or ")}.`,
        ]),
  ];
  return `${said.join(" ")} The weakest evidence this rests on is ${rungInWords(parts.rung)}, and the requirement needs at least ${parts.minimum}.`;
}

/**
 * Say why a requirement does not apply.
 * @param fact - The fact the audit gave
 * @returns The sentence
 */
export function notApplicableBecause(fact: string): string {
  return `This requirement does not apply here. The audit gave this fact: ${fact}`;
}

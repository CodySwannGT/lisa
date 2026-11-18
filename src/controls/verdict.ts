/**
 * Computing the Level 1 verdict from the control register and the evidence.
 *
 * This is code from end to end: no model is asked anything, and nothing is
 * read but what it is handed — the requirements catalogue, the register, the
 * evidence file and the current time. So the same inputs always give the
 * same verdict, and anyone can compute it again.
 *
 * ## How a requirement is judged
 *
 * 1. Every register entry that lists the requirement serves it, and is one
 *    answer (`./verdict-answers.ts`).
 * 2. Every record written from an audit finding for the requirement is one
 *    answer too (what it is worth depends on the requirement's kind; see
 *    `./evidence-findings.ts`), unless a control already covers its folder: a control that
 *    serves the requirement covers its own folder, and one for the whole
 *    repository covers every folder. The audit's finding for the whole
 *    repository is set aside as soon as any control serves the requirement,
 *    because the register is then the record of what governs it.
 * 3. No answer at all: `unknown`.
 * 4. Otherwise the worst answer decides, in the order `non-conforming`,
 *    `unknown`, `conforming`, `not-applicable`. So one folder where nothing
 *    was found makes the requirement non-conforming, one control without a
 *    proof makes it unknown, and it is `not-applicable` only when it applies
 *    nowhere.
 *
 * The Level 1 result is `conforming` only when every in-scope requirement is
 * `conforming` or `not-applicable`. Unknown is never conforming.
 * @module controls/verdict
 */
import { canonicalFileText, compareCodeUnits } from "./canonical-json.js";
import {
  inScopeCriteria,
  type CriterionCatalogue,
  type InScopeCriterion,
} from "./catalogue.js";
import { evidenceExpiry, isEvidenceFresh } from "./evidence.js";
import {
  EVIDENCE_RUNGS,
  type EvidenceDocument,
  type EvidenceRecord,
  type EvidenceRung,
} from "./evidence-types.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";
import {
  controlAnswer,
  findingAnswer,
  type Answer,
  type AnswerContext,
} from "./verdict-answers.js";
import { redactJsonCredentials } from "./secret-scan-json.js";
import { digestOf, verdictDigest } from "./verdict-digest.js";
import {
  CRITERION_VERDICTS,
  NOT_APPLICABLE,
  VERDICT_SCHEMA_VERSION,
  type CriterionVerdict,
  type CriterionVerdictWord,
  type Verdict,
  type VerdictCounts,
} from "./verdict-types.js";
import {
  conformingBecause,
  NOTHING_ON_RECORD,
  notApplicableBecause,
  whereOf,
} from "./verdict-wording.js";

/** What a verdict is computed from. */
export interface VerdictInputs {
  /** The requirements catalogue. */
  readonly catalogue: CriterionCatalogue;
  /** The control register. */
  readonly register: ControlRegister;
  /** The evidence file. */
  readonly evidence: EvidenceDocument;
  /** The current time, which decides which records are still current. */
  readonly now: Date;
}

/**
 * The weakest evidence a requirement accepts.
 *
 * A catalogue entry that does not say is held to the strongest rung: a
 * requirement is never made easier to meet by a missing word.
 * @param criterion - The catalogue entry
 * @returns The rung
 */
function minimumRungOf(criterion: InScopeCriterion): EvidenceRung {
  return (
    EVIDENCE_RUNGS.find(rung => rung === criterion.minimum_rung) ?? "exercised"
  );
}

/**
 * Tell whether a control that serves a requirement covers a folder.
 * @param serving - The entries that serve the requirement
 * @param scope - The folder an audit finding is about
 * @returns Whether the finding is set aside
 */
function covered(
  serving: readonly ControlRegisterEntry[],
  scope: string
): boolean {
  return (
    serving.length > 0 &&
    (scope === WHOLE_REPOSITORY_SCOPE ||
      serving.some(
        entry => entry.scope === scope || entry.scope === WHOLE_REPOSITORY_SCOPE
      ))
  );
}

/**
 * Every answer on record about one requirement.
 * @param serving - The register entries that serve it
 * @param records - Every evidence record for it
 * @param context - Its minimum rung and the current time
 * @returns The answers: controls in register order, then findings by folder
 */
function answersFor(
  serving: readonly ControlRegisterEntry[],
  records: readonly EvidenceRecord[],
  context: AnswerContext
): readonly Answer[] {
  const findings = records
    .filter(
      record => record.entry_id === null && !covered(serving, record.scope)
    )
    .sort((left, right) => compareCodeUnits(left.scope, right.scope));
  return [
    ...serving.map(entry =>
      controlAnswer(
        entry,
        records.filter(record => record.entry_id === entry.id),
        context
      )
    ),
    ...findings.map(record => findingAnswer(record, context)),
  ];
}

/**
 * The fact a requirement that applies nowhere cites.
 * @param answers - Its answers, each `not-applicable`
 * @returns The one fact, or each folder's fact in turn
 */
function citedFact(answers: readonly Answer[]): string {
  const [only, ...others] = answers;
  if (only !== undefined && others.length === 0) return only.fact ?? "";
  return answers
    .map(answer => {
      const where = whereOf(answer.scope);
      return `In ${answer.scope === WHOLE_REPOSITORY_SCOPE ? where : answer.scope}: ${answer.fact ?? ""}`;
    })
    .join(" ");
}

/**
 * The sentence for a conforming requirement.
 * @param answers - Its answers, none worse than conforming
 * @param rung - The weakest rung it rests on
 * @param minimum - The rung it needs
 * @returns The sentence
 */
function conformingDetail(
  answers: readonly Answer[],
  rung: EvidenceRung,
  minimum: EvidenceRung
): string {
  const conforming = answers.filter(answer => answer.verdict === "conforming");
  return conformingBecause({
    controls: conforming.flatMap(answer =>
      answer.entry_id === null ? [] : [answer.entry_id]
    ),
    located: conforming.flatMap(answer =>
      answer.reason === "artifact-located" ? [answer.scope] : []
    ),
    attested: conforming.flatMap(answer =>
      answer.reason === "person-attested" ? [answer.scope] : []
    ),
    notApplicable: answers
      .filter(answer => answer.verdict === NOT_APPLICABLE)
      .map(answer => answer.scope),
    rung,
    minimum,
  });
}

/**
 * The parts of a requirement's verdict that depend on which word it got.
 * @param word - The word
 * @param answers - Its answers; at least one
 * @param minimum - The rung it needs
 * @returns The reason, the sentence, the rung and the fact
 */
function settled(
  word: CriterionVerdictWord,
  answers: readonly Answer[],
  minimum: EvidenceRung
): Pick<CriterionVerdict, "reason" | "detail" | "rung" | "fact"> {
  const deciding = answers.filter(answer => answer.verdict === word);
  const [first] = deciding;
  if (first === undefined) throw new Error(`no answer is ${word}`);
  if (word === NOT_APPLICABLE) {
    const fact = citedFact(deciding);
    return {
      reason: first.reason,
      detail: notApplicableBecause(fact),
      rung: null,
      fact,
    };
  }
  if (word !== "conforming") {
    return {
      reason: first.reason,
      detail: first.detail,
      rung: null,
      fact: null,
    };
  }
  const rung =
    EVIDENCE_RUNGS.find(each =>
      deciding.some(answer => answer.rung === each)
    ) ?? minimum;
  return {
    reason: first.reason,
    detail: conformingDetail(answers, rung, minimum),
    rung,
    fact: null,
  };
}

/**
 * One requirement's verdict.
 * @param criterion - The catalogue entry
 * @param inputs - The register, the evidence and the current time
 * @returns The verdict
 */
function criterionVerdict(
  criterion: InScopeCriterion,
  inputs: VerdictInputs
): CriterionVerdict {
  const minimum = minimumRungOf(criterion);
  const kind = typeof criterion.kind === "string" ? criterion.kind : "";
  const serving = inputs.register.entries.filter(entry =>
    entry.criteria.includes(criterion.id)
  );
  const answers = answersFor(
    serving,
    inputs.evidence.records.filter(record => record.criterion === criterion.id),
    { minimum, kind, now: inputs.now }
  );
  const word =
    CRITERION_VERDICTS.find(each =>
      answers.some(answer => answer.verdict === each)
    ) ?? "unknown";
  const read = answers.flatMap(answer =>
    answer.records.map(record => record.id)
  );
  return {
    criterion: criterion.id,
    verdict: word,
    ...(answers.length === 0
      ? {
          reason: "no-evidence" as const,
          detail: NOTHING_ON_RECORD,
          rung: null,
          fact: null,
        }
      : settled(word, answers, minimum)),
    kind,
    minimum_rung: minimum,
    entries: serving.map(entry => entry.id),
    evidence: [...read].sort(compareCodeUnits),
  };
}

/**
 * Count how many requirements got each word.
 * @param criteria - Every requirement's verdict
 * @returns The counts
 */
function countsOf(criteria: readonly CriterionVerdict[]): VerdictCounts {
  const count = (word: CriterionVerdictWord): number =>
    criteria.filter(each => each.verdict === word).length;
  return {
    conforming: count("conforming"),
    "non-conforming": count("non-conforming"),
    unknown: count("unknown"),
    [NOT_APPLICABLE]: count(NOT_APPLICABLE),
  };
}

/**
 * The earliest or latest of some times.
 * @param times - Times in milliseconds
 * @param pick - `Math.min` or `Math.max`
 * @returns The time as canonical UTC, or `null` when there is none
 */
function boundOf(
  times: readonly number[],
  pick: (...values: number[]) => number
): string | null {
  return times.length === 0 ? null : new Date(pick(...times)).toISOString();
}

/**
 * Compute the Level 1 verdict.
 * @param inputs - The catalogue, the register, the evidence and the time
 * @returns The verdict, exactly as the attest step writes it
 */
export function computeVerdict(inputs: VerdictInputs): Verdict {
  const { catalogue, register, evidence, now } = inputs;
  const criteria = inScopeCriteria(catalogue).map(criterion =>
    criterionVerdict(criterion, inputs)
  );
  const prevented = criteria
    .filter(
      each => each.verdict !== "conforming" && each.verdict !== NOT_APPLICABLE
    )
    .map(each => each.criterion);
  const relied = new Set(criteria.flatMap(each => each.evidence));
  // A verdict copies sentences out of evidence records. The attest step
  // takes credential-shaped values out of a record before it writes it, but
  // a verdict can also be computed from an evidence file someone edited, so
  // the copies go through the same scanner. It is a pure step: computing the
  // verdict again gives the same text.
  return redactJsonCredentials<Verdict>({
    schema_version: VERDICT_SCHEMA_VERSION,
    requirements: {
      specification: String(catalogue.specification ?? ""),
      specification_version: String(catalogue.specification_version ?? ""),
      level: typeof catalogue.level === "number" ? catalogue.level : 1,
      sha256: digestOf(catalogue),
    },
    result: prevented.length === 0 ? "conforming" : "non-conforming",
    prevented_by: prevented,
    counts: countsOf(criteria),
    criteria,
    evidence_as_of: boundOf(
      evidence.records.map(record => Date.parse(record.completed_at)),
      Math.max
    ),
    current_until: boundOf(
      evidence.records
        .filter(record => relied.has(record.id) && isEvidenceFresh(record, now))
        .map(record => evidenceExpiry(record).getTime()),
      Math.min
    ),
    digest: verdictDigest(register, evidence),
  });
}

/**
 * Write a verdict as the text of its file.
 *
 * Keys are ordered at every depth, the indent is two spaces and the file
 * ends with one newline, so the same verdict is always the same bytes.
 * @param verdict - The verdict
 * @returns The file content
 */
export function serializeVerdict(verdict: Verdict): string {
  return canonicalFileText(verdict);
}

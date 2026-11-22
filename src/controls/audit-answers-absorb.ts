/**
 * Bringing the record in line with what people typed on the answer lines.
 *
 * Absorbing an answer is a fixed, small change to `.lisa/audit/report.json`,
 * made by code so that no agent ever writes an answer:
 *
 * - an answer typed for a question is added to `answers`, under the
 *   question's id, with the question as it was asked. The question leaves
 *   `questions`: it is not asked again;
 * - an answer that was changed on its line replaces the one on record;
 * - an answer whose line was emptied, in an entry the report shows as
 *   answered, is withdrawn from `answers`. Nothing puts the question back: the
 *   next audit asks it again if it is still open. An empty line in an entry
 *   shown as open withdraws nothing: that is only a question nobody answered
 *   in that file, and the answer may have been typed in the other one.
 *
 * Nothing else in the record is touched. The finding a question belonged to
 * keeps its state, because deciding it from the answer is the audit's job.
 *
 * Pure: it takes the parsed record and the entries read from the files, and
 * returns the new record with what changed.
 * @module controls/audit-answers-absorb
 */
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import type { InlineEntry } from "./audit-report-types.js";

/** One change absorbing made, for the line the command prints about it. */
export interface AbsorbedChange {
  /**
   * `recorded`: a new answer. `replaced`: a changed one. `withdrawn`: one
   * whose line was emptied. `dropped`: a question that was asked again
   * although its answer is already on record.
   */
  readonly kind: "recorded" | "replaced" | "withdrawn" | "dropped";
  /** The id of the question. */
  readonly id: string;
  /** The question, as it was asked. */
  readonly question: string;
  /** The answer now on record; `null` when there is none to show. */
  readonly answer: string | null;
}

/** The record after absorbing, and what changed in it. */
export interface AbsorbOutcome {
  /** The record to write; the same object when nothing changed. */
  readonly document: JsonObject;
  readonly changes: readonly AbsorbedChange[];
}

/** One answer of the new record, with the change that produced it. */
interface AnswerStep {
  /** The answer to keep; `null` for one that was withdrawn. */
  readonly answer: JsonObject | null;
  readonly change: AbsorbedChange | null;
}

/**
 * Read a list section of the record.
 * @param value - What the record holds under the key
 * @returns The section's objects; none when the key is absent
 */
function objectsOf(value: unknown): readonly JsonObject[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is JsonObject => isJsonObject(entry))
    : [];
}

/**
 * Read a text field of an entry.
 * @param entry - A question or an answer of the record
 * @param key - The field
 * @returns The text, or `null` when the field holds none
 */
function textOf(entry: JsonObject | undefined, key: string): string | null {
  const value = entry?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Decide what becomes of one answer on record.
 * @param answer - The answer on record
 * @param entry - The question's entry in the files, when it has one
 * @returns The answer to keep, and the change when there is one
 */
function keepStep(
  answer: JsonObject,
  entry: InlineEntry | undefined
): AnswerStep {
  const untouched =
    entry === undefined ||
    entry.answer === answer.answer ||
    (entry.answer === null && !entry.answered);
  if (untouched) return { answer, change: null };
  const described = {
    id: entry.id,
    question: textOf(answer, "question") ?? entry.question,
  };
  return entry.answer === null
    ? {
        answer: null,
        change: { ...described, kind: "withdrawn", answer: null },
      }
    : {
        answer: { ...answer, answer: entry.answer },
        change: { ...described, kind: "replaced", answer: entry.answer },
      };
}

/**
 * Record one answer that is not on record yet.
 * @param entry - The question's entry in the files
 * @param questions - The questions the record still asks
 * @returns The new answer and its change; nothing for an empty answer line
 */
function addSteps(
  entry: InlineEntry,
  questions: readonly JsonObject[]
): readonly AnswerStep[] {
  if (entry.answer === null) return [];
  const question =
    textOf(
      questions.find(asked => asked.id === entry.id),
      "text"
    ) ?? entry.question;
  return [
    {
      answer: { id: entry.id, question, answer: entry.answer },
      change: {
        kind: "recorded",
        id: entry.id,
        question,
        answer: entry.answer,
      },
    },
  ];
}

/**
 * Absorb what was typed on the answer lines into the record.
 * @param document - The parsed record
 * @param entries - Every question entry read from the files, each id once
 * @returns The record to write, and what changed
 */
export function absorbInlineAnswers(
  document: JsonObject,
  entries: readonly InlineEntry[]
): AbsorbOutcome {
  const questions = objectsOf(document.questions);
  const recorded = objectsOf(document.answers);
  const steps = [
    ...recorded.map(answer =>
      keepStep(
        answer,
        entries.find(entry => entry.id === answer.id)
      )
    ),
    ...entries
      .filter(entry => !recorded.some(answer => answer.id === entry.id))
      .flatMap(entry => addSteps(entry, questions)),
  ];
  const answers = steps.flatMap(({ answer }) =>
    answer === null ? [] : [answer]
  );
  const answered = (question: JsonValue): boolean =>
    isJsonObject(question) && answers.some(answer => answer.id === question.id);
  const changes = steps.flatMap(({ change }) =>
    change === null ? [] : [change]
  );
  const dropped = questions
    .filter(
      question =>
        answered(question) && !changes.some(change => change.id === question.id)
    )
    .map(
      (question): AbsorbedChange => ({
        kind: "dropped",
        id: String(question.id),
        question: textOf(question, "text") ?? String(question.id),
        answer: null,
      })
    );
  if (changes.length === 0 && dropped.length === 0) {
    return { document, changes: [] };
  }
  return {
    document: {
      ...document,
      ...(Array.isArray(document.questions)
        ? {
            questions: document.questions.filter(
              question => !answered(question)
            ),
          }
        : {}),
      answers,
    },
    changes: [...changes, ...dropped],
  };
}

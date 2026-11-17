/**
 * The shape of the two report sections about questions: `questions`, what the
 * audit still needs a person to answer, and `answers`, what people have
 * answered so far.
 *
 * A question is read by someone who may not code. It is one plain sentence,
 * with the answers the audit found evidence for, each saying where it was
 * found, or with a statement of where the audit looked and found none. It
 * never carries an answer of its own: a person types that in the rendered
 * report, and only `lisa controls report-check --absorb` moves it into
 * `answers`.
 *
 * These functions return plain messages. `./audit-report-shape.ts` turns them
 * into the report's shape violations, so this module imports nothing from it.
 * @module controls/audit-report-questions-shape
 */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  isInlineAnswer,
  normaliseInlineAnswer,
} from "./audit-questions-format.js";

const QUESTION_FIELDS: readonly string[] = [
  "id",
  "text",
  "candidates",
  "no_candidates_reason",
  "answer",
];
const CANDIDATE_FIELDS: readonly string[] = ["answer", "found_in"];
const ANSWER_FIELDS: readonly string[] = ["id", "question", "answer"];

/**
 * Tell whether a value is text with something in it.
 * @param value - Candidate
 * @returns Whether it is a non-blank string
 */
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Name the keys of an object that are not on its closed list.
 * @param value - The object
 * @param known - The keys it may have
 * @param label - What the object is, for the message
 * @returns One problem per unknown key
 */
function unknownKeys(
  value: JsonObject,
  known: readonly string[],
  label: string
): readonly string[] {
  return Object.keys(value)
    .filter(key => !known.includes(key))
    .map(
      key =>
        `${label} has a field named "${key}" that Lisa does not read. Remove it.`
    );
}

/**
 * Name one entry of a list: by its id when it has one, by position otherwise.
 * @param raw - The entry
 * @param noun - What the entry is: `question` or `answer`
 * @param index - Its position in the list, from 0
 * @returns For example `The question "tracker"`
 */
function entryLabel(raw: JsonObject, noun: string, index: number): string {
  return isFilled(raw.id)
    ? `The ${noun} "${raw.id}"`
    : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} number ${index + 1} in the list`;
}

/**
 * Check one candidate answer.
 * @param raw - Candidate
 * @param label - Which candidate this is, for the message
 * @returns What is wrong with it
 */
function candidateProblems(raw: unknown, label: string): readonly string[] {
  if (!isJsonObject(raw)) {
    return [`${label} must be an object with an "answer" and a "found_in".`];
  }
  return [
    ...unknownKeys(raw, CANDIDATE_FIELDS, label),
    ...(isFilled(raw.answer)
      ? []
      : [`${label} needs an "answer": the candidate answer, in plain words.`]),
    ...(isFilled(raw.found_in)
      ? []
      : [
          `${label} needs a "found_in": where the audit found it, in plain words.`,
        ]),
  ];
}

/**
 * Check a question's candidates against its statement that there are none.
 * @param raw - The question
 * @param label - Which question this is, for the message
 * @returns What is wrong with them
 */
function candidatesProblems(raw: JsonObject, label: string): readonly string[] {
  if (!Array.isArray(raw.candidates)) {
    return [
      `${label}: "candidates" must be a list; leave it empty when the audit found no candidate answer.`,
    ];
  }
  const stated = raw.no_candidates_reason !== undefined;
  const each = raw.candidates.flatMap((candidate, index) =>
    candidateProblems(candidate, `${label}, candidate ${index + 1}`)
  );
  if (raw.candidates.length > 0) {
    return [
      ...each,
      ...(stated
        ? [
            `${label} lists candidate answers, so "no_candidates_reason" must be left out.`,
          ]
        : []),
    ];
  }
  return isFilled(raw.no_candidates_reason)
    ? []
    : [
        `${label} found no candidate answers, so it needs a "no_candidates_reason": where the audit looked, in plain words.`,
      ];
}

/**
 * Check one question.
 * @param raw - Candidate question
 * @param index - Its position in the list, from 0
 * @returns What is wrong with it
 */
function questionProblems(raw: unknown, index: number): readonly string[] {
  if (!isJsonObject(raw)) {
    return [`Question number ${index + 1} in the list is not an object.`];
  }
  const label = entryLabel(raw, "question", index);
  const oneLine = isFilled(raw.text) && !/[\n\r]/u.test(raw.text);
  const text = isFilled(raw.text)
    ? `${label}: "text" must be one sentence on one line.`
    : `${label} needs a "text": the question, as one plain sentence.`;
  return [
    ...unknownKeys(raw, QUESTION_FIELDS, label),
    ...(isFilled(raw.id)
      ? []
      : [`${label} needs an "id": the id its question is asked under.`]),
    ...(oneLine ? [] : [text]),
    ...candidatesProblems(raw, label),
    ...(raw.answer === undefined || raw.answer === null
      ? []
      : [
          `${label} carries an answer. Only a person answers a question, by typing on its answer line in the rendered report. Remove the "answer" from the question.`,
        ]),
  ];
}

/**
 * Check one answer on record.
 * @param raw - Candidate answer
 * @param index - Its position in the list, from 0
 * @returns What is wrong with it
 */
function answerProblems(raw: unknown, index: number): readonly string[] {
  if (!isJsonObject(raw)) {
    return [`Answer number ${index + 1} in the list is not an object.`];
  }
  const label = entryLabel(raw, "answer", index);
  const given = typeof raw.answer === "string" ? raw.answer : "";
  const answer =
    normaliseInlineAnswer(given) === ""
      ? `${label} needs an "answer": what the person typed.`
      : `${label}: "answer" must be exactly what was typed on the answer line: one line, with no space before or after it.`;
  return [
    ...unknownKeys(raw, ANSWER_FIELDS, label),
    ...(isFilled(raw.id)
      ? []
      : [`${label} needs an "id": the id of the question it answers.`]),
    ...(isFilled(raw.question)
      ? []
      : [`${label} needs a "question": the question as it was asked.`]),
    ...(isInlineAnswer(given) ? [] : [answer]),
  ];
}

/**
 * Check a list section entry by entry.
 * @param value - What the report holds under the key; `undefined` when absent
 * @param key - The section's key, for the message
 * @param check - The check for one entry
 * @returns What is wrong with the section; nothing when it is absent
 */
function listProblems(
  value: unknown,
  key: string,
  check: (raw: unknown, index: number) => readonly string[]
): readonly string[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.flatMap((entry, index) => check(entry, index))
    : [`The report's "${key}" must be a list.`];
}

/**
 * Check the `questions` section.
 * @param value - What the report holds under `questions`
 * @returns What is wrong with it
 */
export function questionsSectionProblems(value: unknown): readonly string[] {
  return listProblems(value, "questions", questionProblems);
}

/**
 * Check the `answers` section.
 * @param value - What the report holds under `answers`
 * @returns What is wrong with it
 */
export function answersSectionProblems(value: unknown): readonly string[] {
  return listProblems(value, "answers", answerProblems);
}

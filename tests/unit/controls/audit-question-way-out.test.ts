/**
 * No refusal of a question ever asks for an answer to be given up.
 *
 * A question whose lines cannot be put back one by one used to be put right
 * one way only: delete the whole question and run the audit again. For an
 * open question that works, because Lisa writes it again from the record.
 * For an answered one it does not. The record then holds an answer that is
 * written nowhere a person types, the next refusal says to remove it from
 * `answers`, and the person's answer is gone and the question asked again.
 *
 * So the way out depends on what the question holds. One that holds nothing
 * is started over. One whose answer is on record is never deleted: the
 * message says which lines to put back and where their words are. One whose
 * answer was typed and not yet recorded is started over only after the answer
 * was kept (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import { personAnswer } from "../../../src/controls/audit-answers.js";
import { parseQuestionBlock } from "../../../src/controls/audit-inline-answers.js";
import { entryMarksLine } from "../../../src/controls/audit-question-lines.js";
import { document, entry, FILE, LINE } from "./support/question-block.js";

const TRACKER = "tracker";
const QUESTION = "Which tracker does the team plan its work in?";
const QUESTION_LINE = `- **Question**: ${QUESTION}`;
const STATUS_LINE = "- **Status**: absorbed";
const DELETE = "delete the whole question";
const RECORD = {
  answers: [{ id: TRACKER, question: QUESTION, answer: "Jira" }],
};

/** Where each line of an answered entry stands in a {@link document}. */
const AT = { heading: 7, question: 9, answer: 10, status: 11, marks: 12 };

/** What every refusal of an answered question says instead of "delete it". */
const KEEP =
  'This question\'s answer is on record. Do not delete the question, and do not remove its answer from the record: the answer would be lost and the question asked again. Put the question\'s lines back instead. They are, in this order: the line "### " followed by the question\'s id; an empty line; the line "- **Question**: " followed by the question, on one line; the answer line, left as it is; the line "- **Status**: absorbed"; and the comment line that starts "<!-- lisa:audit-question-lines:", left as it is. The id and the question are in .lisa/audit/report.json, under "id" and "question" in the entry of "answers" that holds this answer.';

/**
 * An answered question as Lisa renders it: no candidates, the answer on its
 * line, and the status that says the answer is on record.
 * @returns The entry's lines, the comment line of marks last
 */
function answered(): readonly string[] {
  const lines = [
    `### ${TRACKER}`,
    "",
    QUESTION_LINE,
    "- **Answer**: Jira",
    STATUS_LINE,
  ];
  return [...lines, entryMarksLine(lines)];
}

/**
 * A document holding the answered question with one line changed.
 * @param line - The line's number in the document
 * @param change - What becomes of the line: other lines, or none
 * @returns The document
 */
function answeredWith(
  line: number,
  change: (text: string) => readonly string[]
): string {
  return document(
    answered().flatMap((text, index) =>
      index === line - AT.heading ? change(text) : [text]
    )
  );
}

/**
 * Read a document the way the report's own file is read.
 * @param text - The document
 * @returns What is wrong with it
 */
function problemsOf(text: string): readonly string[] {
  return parseQuestionBlock(text, FILE, { lisaRendered: true }).problems;
}

describe("the way out of a refusal, for a question whose answer is on record", () => {
  it.each([
    {
      name: "its question line was typed on",
      text: answeredWith(AT.question, line => [`${line} We do.`]),
      says: `${FILE} line ${AT.question} is not as Lisa wrote it`,
    },
    {
      name: "its status line was typed over",
      text: answeredWith(AT.status, () => ["- **Status**: yes, Jira"]),
      says: `${FILE} line ${AT.status} is not as Lisa wrote it`,
    },
    {
      name: "its status line is gone",
      text: answeredWith(AT.status, () => []),
      says: `The question "tracker", which starts on line ${AT.heading}, has lost a line Lisa wrote.`,
    },
    {
      name: "its heading was changed",
      text: answeredWith(AT.heading, () => ["### hosting-platform"]),
      says: `${FILE} line ${AT.heading} is not as Lisa wrote it`,
    },
  ])(
    "says which lines to put back, and never to delete it, when $name",
    ({ text, says }) => {
      const problems = problemsOf(text);

      expect(problems).toEqual([expect.stringContaining(says)]);
      expect(problems[0]).toContain(KEEP);
      expect(problems[0]).not.toContain(DELETE);
    }
  );

  it("is followed to a report that reads whole, with the answer still a person's", () => {
    const broken = answeredWith(AT.question, line => [`${line} We do.`]);
    const restored = broken.replace(`${QUESTION_LINE} We do.`, QUESTION_LINE);
    const block = parseQuestionBlock(restored, FILE, { lisaRendered: true });

    expect(problemsOf(broken)).toHaveLength(1);
    expect(block.problems).toEqual([]);
    expect(personAnswer(RECORD, { rendered: true, ...block }, TRACKER)).toEqual(
      RECORD.answers[0]
    );
  });

  it("says to remove a second comment line of marks, not the question", () => {
    const [problem] = problemsOf(answeredWith(AT.marks, line => [line, line]));

    expect(problem).toBe(
      `${FILE} line ${AT.marks + 1} is a second comment line of marks for the question "tracker". Remove it and keep the first, which is the one that is read.`
    );
  });

  it("gives the comment line to put back when that line is lost, and reads whole once it is back", () => {
    const [marks] = answered().slice(-1);
    const lost = answeredWith(AT.marks, () => []);
    const [problem] = problemsOf(lost);

    expect(problem).toBe(
      `${FILE}: The question "tracker", which starts on line ${AT.heading}, has lost the comment line that starts "<!-- lisa:audit-question-lines:". Lisa writes it under each question so that text typed on the wrong line is noticed. This question holds an answer, so do not delete it. Put this line back under its Status line instead: ${marks} It is made from the question's lines as they stand now. So first make sure that its "###" line spells the question's id exactly as .lisa/audit/report.json holds it, and that nothing was typed on any line but the answer line.`
    );
    expect(
      problemsOf(lost.replace(STATUS_LINE, `${STATUS_LINE}\n${marks}`))
    ).toEqual([]);
  });
});

describe("the way out of a refusal, for a question with an answer typed and not yet recorded", () => {
  it("says to keep the answer before starting the question over", () => {
    const text = document(
      entry(TRACKER, " Jira").map(line =>
        line.startsWith("- **Question**") ? `${line} We do.` : line
      )
    );

    expect(problemsOf(text)).toEqual([
      `${FILE} line ${LINE.question} is not as Lisa wrote it: it was typed on, or added. Only the answer line is read, so what is typed there would be lost. Type the answer on the line that starts "- **Answer**:", and leave every other line as it was. If the line cannot be put back, first keep a copy of the answer typed on line ${LINE.answer}. Then delete the whole question, from its "###" line to the comment line under its Status line, and run the audit again: Lisa writes the question again. Type the answer on its new answer line.`,
    ]);
  });

  it("gives the comment line to put back when that line is lost", () => {
    const lines = entry(TRACKER, " Jira");
    const [problem] = problemsOf(document(lines.slice(0, -1)));

    expect(problem).toContain(
      `Put this line back under its Status line instead: ${lines.at(-1)}`
    );
    expect(problem).not.toContain(DELETE);
  });
});

describe("the way out of a refusal, for a question that holds no answer", () => {
  it("is still to start the question over, because the record writes it again", () => {
    const text = document(
      entry(TRACKER).map(line =>
        line.startsWith("- **Question**") ? `${line} We do.` : line
      )
    );

    expect(problemsOf(text)).toEqual([
      expect.stringContaining(
        `If the line cannot be put back, ${DELETE}, from its "###" line to the comment line under its Status line, and run the audit again: Lisa writes the question again.`
      ),
    ]);
  });

  it("is not taken for answered because someone wrote that over its status", () => {
    const text = document(
      entry(TRACKER).map(line =>
        line.startsWith("- **Status**") ? STATUS_LINE : line
      )
    );

    expect(problemsOf(text)).toEqual([expect.stringContaining(DELETE)]);
  });
});

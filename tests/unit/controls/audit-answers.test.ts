/**
 * Looking up what a person answered, by the id of the question.
 *
 * A later step cites an answered question as the evidence for a decision, so
 * "question X was answered with Y" has to be resolvable from the record after
 * the question itself is gone from it (CodySwannGT/lisa#4980).
 *
 * The record is a file an agent writes, so an entry of `answers` is a
 * person's answer only while a file a person types in holds the same words
 * on that question's answer line. `personAnswer` is that one test, shared by
 * the report check and the attest step (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  personAnswer,
  recordedAnswer,
} from "../../../src/controls/audit-answers.js";
import {
  validateAuditReport,
  type InlineAnswers,
} from "../../../src/controls/audit-report.js";
import { requirementQuestionId } from "../../../src/controls/question-ids.js";
import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import {
  context,
  FIRST,
  RULE,
  typedAnswers,
  WHOLE,
} from "./audit-report-facts.js";

const TRACKER = {
  id: TRACKER_QUESTION_ID,
  question: "Which tracker does the team plan and follow its work in?",
  answer: "GitHub Issues",
} as const;
const OWNER = {
  id: requirementQuestionId(FIRST, WHOLE),
  question: "Who decides what happens when this goes wrong?",
  answer: "The head of engineering",
} as const;
const ANSWERS = [TRACKER, OWNER] as const;
const ANSWERED = { ...completeAuditReport(), questions: [], answers: ANSWERS };

describe("recordedAnswer", () => {
  const { report } = validateAuditReport(
    ANSWERED,
    context({ inlineAnswers: typedAnswers(ANSWERS) })
  );

  it("resolves a setup question by its fixed id after the question is gone", () => {
    expect(report?.questions).toEqual([]);
    expect(report && recordedAnswer(report, TRACKER_QUESTION_ID)).toEqual(
      TRACKER
    );
  });

  it("resolves a requirement's question by the id derived from its finding", () => {
    expect(
      report && recordedAnswer(report, requirementQuestionId(FIRST, WHOLE))
    ).toEqual(OWNER);
  });

  it("finds nothing for a question that is still open or was never asked", () => {
    const { report: open } = validateAuditReport(
      completeAuditReport(),
      context()
    );

    expect(open && recordedAnswer(open, TRACKER_QUESTION_ID)).toBeNull();
    expect(report && recordedAnswer(report, "hosting-platform")).toBeNull();
  });
});

describe("personAnswer", () => {
  const record = { answers: ANSWERS };
  const typed = typedAnswers(ANSWERS);

  /**
   * What the answer lines hold when one of them was changed.
   * @param id - The question whose line was changed
   * @param change - What its entry reads as now
   * @returns The answer lines
   */
  function withLine(
    id: string,
    change: Partial<InlineAnswers["entries"][number]>
  ): InlineAnswers {
    return {
      ...typed,
      entries: typed.entries.map(entry =>
        entry.id === id ? { ...entry, ...change } : entry
      ),
    };
  }

  it("is the answer on record when its question's answer line holds the same words", () => {
    expect(personAnswer(record, typed, TRACKER.id)).toEqual(TRACKER);
    expect(personAnswer(record, typed, OWNER.id)).toEqual(OWNER);
  });

  it.each([
    [
      "no file a person types in exists",
      { rendered: false, problems: [], entries: [] },
    ],
    ["the answer line is empty", withLine(TRACKER.id, { answer: null })],
    [
      "the answer line holds other words",
      withLine(TRACKER.id, { answer: "Jira" }),
    ],
    [
      "the words differ only in letter case",
      withLine(TRACKER.id, { answer: "github issues" }),
    ],
    [
      "the same words stand only on another question's line",
      typedAnswers([{ ...TRACKER, id: OWNER.id }]),
    ],
    [
      "the file cannot be read in the written form",
      { ...typed, problems: ["line 9 is not part of a question"] },
    ],
  ] as const)("is nothing when %s", (_name, lines) => {
    expect(personAnswer(record, lines, TRACKER.id)).toBeNull();
  });

  it("is nothing for a question with no answer on record, whatever is typed", () => {
    expect(personAnswer({ answers: [OWNER] }, typed, TRACKER.id)).toBeNull();
  });

  it.each(["TBD", "?", "n/a", "_(human fills in)_", "*(human fills in)*"])(
    "is nothing when the answer is only the placeholder %s, even typed",
    placeholder => {
      const held = [{ ...TRACKER, answer: placeholder }];

      expect(
        personAnswer({ answers: held }, typedAnswers(held), TRACKER.id)
      ).toBeNull();
    }
  );
});

describe("a report with answers on record", () => {
  it("passes its check exactly when every answer is a person's", () => {
    const every = [
      typedAnswers(ANSWERS),
      typedAnswers([TRACKER]),
      typedAnswers([{ ...TRACKER, answer: "Jira" }, OWNER]),
      { rendered: false, problems: [], entries: [] },
      { rendered: true, problems: [], entries: [] },
    ] as const;

    every.forEach(lines => {
      const { report, violations } = validateAuditReport(
        ANSWERED,
        context({ inlineAnswers: lines })
      );
      const allTyped = ANSWERS.every(
        answer => personAnswer({ answers: ANSWERS }, lines, answer.id) !== null
      );

      expect(report !== null).toBe(allTyped);
      expect(
        violations.every(violation => violation.rule === RULE.recordedAnswers)
      ).toBe(true);
    });
  });
});

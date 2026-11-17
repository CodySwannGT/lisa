/**
 * Looking up what a person answered, by the id of the question.
 *
 * A later step cites an answered question as the evidence for a decision, so
 * "question X was answered with Y" has to be resolvable from the record after
 * the question itself is gone from it (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import { recordedAnswer } from "../../../src/controls/audit-answers.js";
import { validateAuditReport } from "../../../src/controls/audit-report.js";
import { requirementQuestionId } from "../../../src/controls/question-ids.js";
import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { context, FIRST, WHOLE } from "./audit-report-facts.js";

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

describe("recordedAnswer", () => {
  const { report } = validateAuditReport(
    { ...completeAuditReport(), questions: [], answers: [TRACKER, OWNER] },
    context()
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

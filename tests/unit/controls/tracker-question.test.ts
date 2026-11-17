/**
 * Finding the audit's open question about which tracker the team uses.
 *
 * When no tracker is configured, a missing requirement cannot be ticketed, and
 * the operator is pointed at the question whose answer unblocks it. The
 * question is recognised by one fixed id, so the audit that writes it and the
 * step that points at it agree without either guessing
 * (CodySwannGT/lisa#4992).
 */
import { describe, expect, it } from "vitest";

import {
  TRACKER_QUESTION_ID,
  openTrackerQuestionId,
} from "../../../src/controls/tracker-question.js";

/**
 * A report document holding the given questions.
 * @param questions - The value of the report's `questions` key
 * @returns The document
 */
function reportWith(questions: unknown): unknown {
  return { schema_version: 1, scopes: ["."], findings: [], questions };
}

describe("openTrackerQuestionId", () => {
  it("uses the one fixed id the audit writes the question under", () => {
    expect(TRACKER_QUESTION_ID).toBe("tracker");
  });

  it("finds the question while it has no answer", () => {
    expect(
      openTrackerQuestionId(
        reportWith([
          { id: "administrator", text: "Who administers the repository?" },
          {
            id: TRACKER_QUESTION_ID,
            text: "Which tracker does the team use?",
            candidates: ["github"],
          },
        ])
      )
    ).toBe(TRACKER_QUESTION_ID);
  });

  it.each([null, "", "   "])(
    "treats the answer %j as no answer yet",
    answer => {
      expect(
        openTrackerQuestionId(
          reportWith([{ id: TRACKER_QUESTION_ID, text: "Which?", answer }])
        )
      ).toBe(TRACKER_QUESTION_ID);
    }
  );

  it("finds nothing once the question is answered", () => {
    expect(
      openTrackerQuestionId(
        reportWith([
          { id: TRACKER_QUESTION_ID, text: "Which?", answer: "GitHub Issues" },
        ])
      )
    ).toBeNull();
  });

  it("finds nothing when the audit asked other questions only", () => {
    expect(
      openTrackerQuestionId(reportWith([{ id: "administrator", text: "Who?" }]))
    ).toBeNull();
  });

  it.each([
    { name: "a report with no questions", document: reportWith(undefined) },
    { name: "a questions value that is not a list", document: reportWith({}) },
    {
      name: "a list of things that are not questions",
      document: reportWith(["tracker", 7, null]),
    },
    { name: "something that is not a report", document: "tracker" },
    { name: "nothing at all", document: null },
  ])("finds nothing in $name", ({ document }) => {
    expect(openTrackerQuestionId(document)).toBeNull();
  });
});

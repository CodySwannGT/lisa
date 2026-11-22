/**
 * The shape of the questions an audit asks and of the answers it has on
 * record.
 *
 * A question is read by someone who may not code: one plain sentence, the
 * answers the audit found evidence for with where each was found, or a
 * statement of where it looked and found none. An open question never carries
 * an answer of its own; a person types that in the rendered report
 * (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import {
  completeAuditReport,
  sampleTrackerQuestion,
  type SampleQuestion,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import { RULE, violationsOf } from "./audit-report-facts.js";

const GITHUB = "GitHub Issues";

const CANDIDATE = {
  answer: GITHUB,
  found_in: "The address of the remote named origin is on github.com.",
} as const;

const ANSWER = {
  id: "tracker",
  question: "Which tracker does the team plan and follow its work in?",
  answer: GITHUB,
} as const;

/**
 * The complete report with its tracker question changed.
 * @param change - Fields to set on the question
 * @returns The report
 */
function withTrackerQuestion(change: SampleQuestion): SampleReport {
  return {
    ...completeAuditReport(),
    questions: [{ ...sampleTrackerQuestion(), ...change }],
  };
}

/**
 * The complete report with the tracker question answered on record.
 * @param answer - The recorded answer, valid or not
 * @returns The report
 */
function withAnswer(answer: unknown): unknown {
  return { ...completeAuditReport(), questions: [], answers: [answer] };
}

/**
 * The shape problems of a report, as text.
 * @param report - Candidate report
 * @returns One message per shape violation
 */
function shapeProblems(report: unknown): readonly string[] {
  return violationsOf(report)
    .filter(violation => violation.rule === RULE.shape)
    .map(violation => violation.message);
}

describe("a question", () => {
  it("passes with no candidates when it says where the audit looked", () => {
    expect(violationsOf(completeAuditReport())).toEqual([]);
  });

  it("passes with candidates that each say where they were found", () => {
    expect(
      violationsOf(
        withTrackerQuestion({
          candidates: [CANDIDATE],
          no_candidates_reason: undefined,
        })
      )
    ).toEqual([]);
  });

  it("may say outright that it has no answer yet", () => {
    expect(violationsOf(withTrackerQuestion({ answer: null }))).toEqual([]);
  });

  it.each([
    {
      name: "is not an object",
      report: { ...completeAuditReport(), questions: ["tracker"] },
      says: /Question number 1 in the list is not an object/u,
    },
    {
      name: "has a field Lisa does not read",
      report: withTrackerQuestion({ priority: "high" }),
      says: /has a field named "priority" that Lisa does not read/u,
    },
    {
      name: "has no id",
      report: withTrackerQuestion({ id: " " }),
      says: /needs an "id"/u,
    },
    {
      name: "has no text",
      report: withTrackerQuestion({ text: "" }),
      says: /needs a "text": the question, as one plain sentence/u,
    },
    {
      name: "runs over more than one line",
      report: withTrackerQuestion({ text: "Which tracker?\nAnd which board?" }),
      says: /"text" must be one sentence on one line/u,
    },
    {
      name: "has candidates that are not a list",
      report: withTrackerQuestion({ candidates: GITHUB }),
      says: /"candidates" must be a list/u,
    },
    {
      name: "has a candidate that does not say where it was found",
      report: withTrackerQuestion({
        candidates: [{ answer: GITHUB }],
        no_candidates_reason: undefined,
      }),
      says: /candidate 1 needs a "found_in"/u,
    },
    {
      name: "has a candidate with no answer",
      report: withTrackerQuestion({
        candidates: [{ ...CANDIDATE, answer: "" }],
        no_candidates_reason: undefined,
      }),
      says: /candidate 1 needs an "answer"/u,
    },
    {
      name: "has a candidate with a field Lisa does not read",
      report: withTrackerQuestion({
        candidates: [{ ...CANDIDATE, confidence: 0.9 }],
        no_candidates_reason: undefined,
      }),
      says: /candidate 1 has a field named "confidence"/u,
    },
    {
      name: "found no candidates and does not say where it looked",
      report: withTrackerQuestion({ no_candidates_reason: undefined }),
      says: /found no candidate answers, so it needs a "no_candidates_reason"/u,
    },
    {
      name: "lists candidates and also says it found none",
      report: withTrackerQuestion({ candidates: [CANDIDATE] }),
      says: /lists candidate answers, so "no_candidates_reason" must be left out/u,
    },
    {
      name: "carries an answer of its own",
      report: withTrackerQuestion({ answer: GITHUB }),
      says: /Only a person answers a question.*Remove the "answer"/u,
    },
  ])("is refused when it $name", ({ report, says }) => {
    expect(shapeProblems(report).join("\n")).toMatch(says);
  });

  it("is refused when the questions are not a list", () => {
    expect(
      shapeProblems({ ...completeAuditReport(), questions: { tracker: {} } })
    ).toEqual([`The report's "questions" must be a list.`]);
  });

  it("names the question it is about by its id", () => {
    expect(shapeProblems(withTrackerQuestion({ text: "" }))[0]).toMatch(
      /^The question "tracker" /u
    );
  });
});

describe("an answer on record", () => {
  it("has a sound shape with the id, the question as asked and the answer", () => {
    expect(shapeProblems(withAnswer(ANSWER))).toEqual([]);
  });

  it("is still refused, sound shape and all, while nothing shows a person typed it", () => {
    expect(violationsOf(withAnswer(ANSWER)).map(found => found.rule)).toEqual([
      RULE.recordedAnswers,
    ]);
  });

  it.each(["TBD", "?", "n/a", "*(human fills in)*", "(human fills in)"])(
    "is refused when it is only the placeholder %s",
    placeholder => {
      expect(
        shapeProblems(withAnswer({ ...ANSWER, answer: placeholder })).join("\n")
      ).toMatch(/needs an "answer": what the person typed/u);
    }
  );

  it.each([
    {
      name: "is not an object",
      answer: GITHUB,
      says: /Answer number 1 in the list is not an object/u,
    },
    {
      name: "has a field Lisa does not read",
      answer: { ...ANSWER, answered_by: "someone" },
      says: /has a field named "answered_by" that Lisa does not read/u,
    },
    {
      name: "has no id",
      answer: { ...ANSWER, id: "" },
      says: /needs an "id"/u,
    },
    {
      name: "does not keep the question that was asked",
      answer: { ...ANSWER, question: "" },
      says: /needs a "question": the question as it was asked/u,
    },
    {
      name: "is empty",
      answer: { ...ANSWER, answer: "  " },
      says: /needs an "answer"/u,
    },
    {
      name: "runs over more than one line",
      answer: { ...ANSWER, answer: "GitHub Issues\nand a board" },
      says: /"answer" must be exactly what was typed on the answer line/u,
    },
    {
      name: "is padded with spaces",
      answer: { ...ANSWER, answer: " GitHub Issues " },
      says: /"answer" must be exactly what was typed on the answer line/u,
    },
    {
      name: "is the unfilled answer line",
      answer: { ...ANSWER, answer: "_(human fills in)_" },
      says: /needs an "answer"/u,
    },
  ])("is refused when it $name", ({ answer, says }) => {
    expect(shapeProblems(withAnswer(answer)).join("\n")).toMatch(says);
  });

  it("is refused when the answers are not a list", () => {
    expect(
      shapeProblems({ ...completeAuditReport(), answers: "none" })
    ).toEqual([`The report's "answers" must be a list.`]);
  });
});

describe("a report written before questions existed", () => {
  it("has a sound shape with neither section", () => {
    const { questions: _questions, ...report } = completeAuditReport();

    expect(shapeProblems(report)).toEqual([]);
  });
});

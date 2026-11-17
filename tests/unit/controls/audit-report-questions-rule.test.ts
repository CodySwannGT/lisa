/**
 * How the questions of an audit report are held to its findings.
 *
 * A finding that needs a person's answer and the question that asks for it are
 * two halves of one thing, so each must have the other, under an id derived
 * from the finding. A question that was answered is never asked again. And a
 * repository with no tracker configured is always asked which one the team
 * uses, because a later step has nowhere to file a ticket until it is known
 * (CodySwannGT/lisa#4980).
 */
import { describe, expect, it } from "vitest";

import { validateAuditReport } from "../../../src/controls/audit-report.js";
import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  sampleQuestion,
  sampleTrackerQuestion,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  AT_FIRST,
  context,
  FIRST,
  PART_FIRST,
  RULE,
  violationsOf,
  WHOLE,
} from "./audit-report-facts.js";

const FIRST_ID = `${FIRST}@${WHOLE}`;
const MIXED = [WHOLE, API, "web"];
const TRACKER_ANSWER = {
  id: TRACKER_QUESTION_ID,
  question: "Which tracker does the team plan and follow its work in?",
  answer: "GitHub Issues",
} as const;
const FIRST_ANSWER = {
  id: FIRST_ID,
  question: "Who decides what happens when this goes wrong?",
  answer: "The head of engineering",
} as const;

/**
 * The violations of one rule, as text.
 * @param report - Candidate report
 * @param rule - The rule's name
 * @returns One message per violation of that rule
 */
function problems(report: unknown, rule: string): readonly string[] {
  return violationsOf(report)
    .filter(violation => violation.rule === rule)
    .map(violation => violation.message);
}

/**
 * The complete report with one more question on its list.
 * @param question - The question to add
 * @returns The report
 */
function alsoAsking(question: Record<string, unknown>): SampleReport {
  const report = completeAuditReport();
  return { ...report, questions: [...(report.questions ?? []), question] };
}

describe("a finding that needs a person's answer", () => {
  it("passes when its question is asked under the id derived from it", () => {
    expect(violationsOf(askAbout(completeAuditReport(), AT_FIRST))).toEqual([]);
  });

  it("is refused without its question, and is told the id to use", () => {
    const violations = violationsOf(
      amendFinding(completeAuditReport(), AT_FIRST, { state: "question" })
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: RULE.questions,
      criterion: FIRST,
      scope: WHOLE,
    });
    expect(violations[0]?.message).toContain(`with the id "${FIRST_ID}"`);
  });

  it("is refused when its question was asked under a made-up id", () => {
    const report = askAbout(completeAuditReport(), AT_FIRST, {
      ...sampleQuestion(FIRST, WHOLE),
      id: "who-decides",
    });

    expect(problems(report, RULE.questions).join("\n")).toMatch(
      /"who-decides" is not an id Lisa can place/u
    );
    expect(problems(report, RULE.questions).join("\n")).toContain(
      `with the id "${FIRST_ID}"`
    );
  });

  it("has one question for each folder when it is answered per part", () => {
    const report = [API, "web"].reduce(
      (asked, scope) => askAbout(asked, { criterion: PART_FIRST, scope }),
      completeAuditReport(MIXED)
    );

    expect(violationsOf(report)).toEqual([]);
  });
});

describe("a question about a requirement", () => {
  it("is refused when its finding is not filed as needing an answer", () => {
    const violations = violationsOf(alsoAsking(sampleQuestion(FIRST, WHOLE)));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: RULE.questions,
      criterion: FIRST,
      scope: WHOLE,
    });
    expect(violations[0]?.message).toMatch(
      /is not filed as needing a person's answer/u
    );
  });

  it.each([
    { name: "a requirement the catalogue leaves out", id: "AC4.4@." },
    { name: "a folder the requirement is not answered in", id: `${FIRST}@api` },
    { name: "a folder the report does not list", id: `${PART_FIRST}@docs` },
  ])("is refused when it names $name", ({ id }) => {
    expect(
      problems(alsoAsking({ ...sampleQuestion(FIRST, WHOLE), id }), "questions")
    ).toEqual([
      expect.stringContaining("does not match a finding of this report"),
    ]);
  });

  it("is refused when it is asked twice", () => {
    const asked = askAbout(completeAuditReport(), AT_FIRST);
    const report = {
      ...asked,
      questions: [...(asked.questions ?? []), sampleQuestion(FIRST, WHOLE)],
    };

    expect(problems(report, RULE.questions)).toEqual([
      expect.stringContaining(`"${FIRST_ID}" is asked 2 times`),
    ]);
  });
});

describe("the words of a question", () => {
  it.each([
    {
      name: "is not put as a question",
      change: { text: "Name the tracker the team uses." },
      says: /must be one plain question, ending in a question mark/u,
    },
    {
      name: "names a requirement by its id",
      change: { text: `Which tracker satisfies ${FIRST}?` },
      says: /names a requirement by its id/u,
    },
    {
      name: "says where it looked by naming a requirement id",
      change: { no_candidates_reason: `Nothing found for ${FIRST}.` },
      says: /names a requirement by its id/u,
    },
    {
      name: "offers a candidate found under a requirement id",
      change: {
        candidates: [{ answer: "Jira", found_in: `Listed under ${FIRST}.` }],
        no_candidates_reason: undefined,
      },
      says: /names a requirement by its id/u,
    },
  ])("is refused when it $name", ({ change, says }) => {
    const report = {
      ...completeAuditReport(),
      questions: [{ ...sampleTrackerQuestion(), ...change }],
    };

    expect(problems(report, RULE.questions).join("\n")).toMatch(says);
  });
});

describe("a question that was answered", () => {
  it("passes once it is on record and no longer asked", () => {
    expect(
      violationsOf({ ...completeAuditReport(), answers: [FIRST_ANSWER] })
    ).toEqual([]);
  });

  it("is refused when it is asked again", () => {
    const report = {
      ...askAbout(completeAuditReport(), AT_FIRST),
      answers: [FIRST_ANSWER],
    };

    expect(problems(report, RULE.questions).join("\n")).toMatch(
      /was already answered.*Remove it from "questions"/u
    );
  });

  it("is refused while its finding still says it needs an answer, quoting the answer", () => {
    const report = {
      ...amendFinding(completeAuditReport(), AT_FIRST, { state: "question" }),
      answers: [FIRST_ANSWER],
    };
    const violations = violationsOf(report);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: RULE.questions,
      criterion: FIRST,
    });
    expect(violations[0]?.message).toContain(
      `was answered: "The head of engineering"`
    );
  });

  it.each([
    { name: "is recorded twice", answers: [FIRST_ANSWER, FIRST_ANSWER] },
    {
      name: "is recorded under an id that is not a question's",
      answers: [{ ...FIRST_ANSWER, id: "who-decides" }],
    },
  ])("is refused when it $name", ({ answers }) => {
    expect(
      problems({ ...completeAuditReport(), answers }, RULE.questions)
    ).toHaveLength(1);
  });

  it("stays on record for a folder the report no longer lists", () => {
    const answers = [{ ...FIRST_ANSWER, id: `${PART_FIRST}@retired` }];

    expect(violationsOf({ ...completeAuditReport(), answers })).toEqual([]);
  });
});

describe("the question about the tracker", () => {
  const unasked = { ...completeAuditReport(), questions: [] };

  it("must be asked while no tracker is configured", () => {
    expect(violationsOf(unasked)).toEqual([
      {
        rule: RULE.trackerQuestion,
        message: expect.stringContaining(
          `Add a question with the id "${TRACKER_QUESTION_ID}"`
        ),
      },
    ]);
  });

  it("need not be asked once a tracker is configured", () => {
    expect(
      validateAuditReport(unasked, context({ trackerConfigured: true }))
        .violations
    ).toEqual([]);
  });

  it("need not be asked once it has been answered", () => {
    expect(violationsOf({ ...unasked, answers: [TRACKER_ANSWER] })).toEqual([]);
  });
});

/**
 * A part that rests on an operator's answer, held to the audit report.
 *
 * A person answers an audit question in the rendered report, the audit
 * records the answer under the question's id, and a part may then name that
 * id as what supports it. The id is derived from the requirement and the
 * part of the repository the question was about, so the check can tell an
 * answer about this requirement, here, from any other answer on record
 * (CodySwannGT/lisa#4984).
 */
import { describe, expect, it } from "vitest";

import {
  validateAuditReport,
  type AuditAnswer,
  type AuditReport,
} from "../../../src/controls/audit-report.js";
import {
  declarationEvidenceProblems,
  evidencedEntries,
} from "../../../src/controls/declaration-evidence.js";
import { requirementQuestionId } from "../../../src/controls/question-ids.js";
import { TRACKER_QUESTION_ID } from "../../../src/controls/tracker-question.js";
import {
  foundAt,
  openQuestion,
  reportWith,
} from "../../helpers/control-audit-findings.js";
import type { SampleReport } from "../../helpers/control-audit-report.js";
import {
  COVERAGE_QUESTION,
  F_NONE_GATES,
  F_PAVED_GATES,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { CRITERIA, context, typedAnswers } from "./audit-report-facts.js";
import { registerOf } from "./support/register-build.js";

const STYLE = "SI7";
const COVERAGE = "SI2";
const ASKED = "Which share of the code must the tests cover?";
const PARTS = [".", "api", "web"];

/** A style checker found; nothing about coverage, and nothing asked. */
const FOUND = reportWith(["."], [foundAt(STYLE, ".", "ruff.toml")]);

/**
 * One answer on record.
 * @param id - The id of the question that was answered
 * @returns The answer as the report records it
 */
function answerTo(id: string): AuditAnswer {
  return { id, question: ASKED, answer: "Hold it at eighty percent." };
}

/**
 * A report as the check reads it: validated, with the given answers on
 * record, each typed by a person on its question's answer line.
 * @param sample - The report as plain JSON
 * @param answers - The answers people have given
 * @returns The validated report
 */
function validated(
  sample: SampleReport,
  answers: readonly AuditAnswer[] = []
): AuditReport {
  const { report, violations } = validateAuditReport(
    { ...sample, answers },
    context({ inlineAnswers: typedAnswers(answers) })
  );
  if (report === null || violations.length > 0) {
    throw new Error(violations.map(violation => violation.message).join("\n"));
  }
  return report;
}

/**
 * Hold a declaration to a report.
 * @param block - The `gates` block
 * @param report - The validated report
 * @returns One line per problem
 */
async function problemsOf(
  block: GatesBlock,
  report: AuditReport
): Promise<readonly string[]> {
  return declarationEvidenceProblems({
    register: await registerOf(block),
    report,
    criteria: CRITERIA,
  });
}

/**
 * A coverage gate whose one part rests on answered questions.
 * @param scope - The folder the part covers
 * @param questions - The ids of the questions it rests on
 * @returns The `gates` block
 */
function coverageRestingOn(
  scope: string,
  questions: readonly string[]
): GatesBlock {
  return {
    "coverage-adequacy": {
      "pull-request": "required",
      criteria: [COVERAGE],
      parts: [
        {
          scope,
          command: ["python", "-m", "pytest", "--cov"],
          evidence: { questions },
        },
      ],
    },
  };
}

describe("a part that rests on an answered question", () => {
  it("names the question by the id derived from its requirement and its part", () => {
    expect(COVERAGE_QUESTION).toBe(requirementQuestionId(COVERAGE, "."));
  });

  it("is supported once the report holds the answer", async () => {
    expect(
      await problemsOf(
        F_NONE_GATES,
        validated(FOUND, [answerTo(COVERAGE_QUESTION)])
      )
    ).toEqual([]);
  });

  it("is supported in any folder by an answer about the whole repository", async () => {
    expect(
      await problemsOf(
        coverageRestingOn("api", [COVERAGE_QUESTION]),
        validated(reportWith(PARTS, []), [answerTo(COVERAGE_QUESTION)])
      )
    ).toEqual([]);
  });

  it("is refused while no answer to that question is on record", async () => {
    expect(await problemsOf(F_NONE_GATES, validated(FOUND))).toEqual([
      'The gate "coverage-adequacy" in .lisa.config.json has a part for the whole repository that rests on the audit question "SI2@.", but .lisa/audit/report.json holds no answer to a question with that id. A rule is recorded only once its question is answered. Copy the id from an answer the report records, or remove the part.',
    ]);
  });

  it("is refused while the question is still waiting for its answer", async () => {
    const problems = await problemsOf(
      F_NONE_GATES,
      validated(
        reportWith(
          ["."],
          [foundAt(STYLE, ".", "ruff.toml"), openQuestion(COVERAGE, ".")]
        )
      )
    );

    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe(
      'The gate "coverage-adequacy" in .lisa.config.json has a part for the whole repository that rests on the audit question "SI2@.", but that question is still waiting for its answer in .lisa/audit/report.md. A rule is recorded only once its question is answered. Have it answered and run the audit again, or remove the part.'
    );
    expect(problems[1]).toContain("the audit still has an open question");
  });

  it.each([
    ["an id the audit never forms", "coverage-floor"],
    ["a question about a part the report does not hold", "SI2@docs"],
  ])("is refused when it names %s", async (_what, id) => {
    const problems = await problemsOf(
      coverageRestingOn(".", [id]),
      validated(FOUND, [answerTo(COVERAGE_QUESTION)])
    );

    expect(problems).toEqual([
      expect.stringContaining(
        `rests on the audit question "${id}", but .lisa/audit/report.json holds no answer to a question with that id.`
      ),
    ]);
  });
});

describe("an answer that is on record but about something else", () => {
  it("does not support a part when it is about how the repository is set up", async () => {
    const problems = await problemsOf(
      coverageRestingOn(".", [TRACKER_QUESTION_ID]),
      validated({ ...FOUND, questions: [] }, [answerTo(TRACKER_QUESTION_ID)])
    );

    expect(problems).toEqual([
      'The gate "coverage-adequacy" in .lisa.config.json has a part for the whole repository that rests on the audit question "tracker", but that question is about how the repository is set up, not about a requirement. A part rests on the answer to a question about a requirement its gate serves. Name that question, or remove the part.',
    ]);
  });

  it.each([
    [
      "another requirement",
      coverageRestingOn(".", [requirementQuestionId(STYLE, ".")]),
      requirementQuestionId(STYLE, "."),
      ["."],
    ],
    [
      "another part of the repository",
      coverageRestingOn("api", [requirementQuestionId(COVERAGE, "web")]),
      requirementQuestionId(COVERAGE, "web"),
      PARTS,
    ],
  ])(
    "does not support a part when it is about %s",
    async (_what, block, id, scopes) => {
      const problems = await problemsOf(
        block,
        validated(reportWith(scopes, []), [answerTo(id)])
      );

      expect(problems).toEqual([
        expect.stringContaining(
          `rests on the audit question "${id}", but that question is about another requirement or another part of the repository than this part.`
        ),
      ]);
    }
  );

  it("is refused once for each question a part names that does not support it", async () => {
    const problems = await problemsOf(
      coverageRestingOn(".", [
        COVERAGE_QUESTION,
        TRACKER_QUESTION_ID,
        "SI2@docs",
      ]),
      validated(FOUND, [answerTo(COVERAGE_QUESTION)])
    );

    expect(problems).toHaveLength(2);
  });
});

describe("which entries are held to the report", () => {
  it("are the ones generated from a part", async () => {
    expect(
      evidencedEntries(await registerOf(F_NONE_GATES)).map(entry => entry.id)
    ).toEqual(["code-style@.", "coverage-adequacy@."]);
  });

  it("are none on the paved road, whatever the report says", async () => {
    const register = await registerOf(F_PAVED_GATES, {});

    expect(evidencedEntries(register)).toEqual([]);
    expect(
      declarationEvidenceProblems({
        register,
        report: validated(FOUND),
        criteria: CRITERIA,
      })
    ).toEqual([]);
  });
});

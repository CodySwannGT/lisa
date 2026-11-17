/**
 * A part that rests on an operator's answer, held to the audit report.
 *
 * The audit report does not record questions yet, so the report check refuses
 * one that carries them and this form cannot be run through the command. The
 * check itself is built against the shape agreed for them, a `questions` list
 * whose items have an `id` and an `answer`, and is exercised here directly
 * (CodySwannGT/lisa#4984).
 */
import { describe, expect, it } from "vitest";

import type { AuditReport } from "../../../src/controls/audit-report.js";
import {
  answeredQuestionIds,
  declarationEvidenceProblems,
  evidencedEntries,
} from "../../../src/controls/declaration-evidence.js";
import { foundAt, reportWith } from "../../helpers/control-audit-findings.js";
import {
  COVERAGE_QUESTION,
  F_NONE_GATES,
  F_PAVED_GATES,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { CRITERIA } from "./audit-report-facts.js";
import { registerOf } from "./support/register-build.js";

/** The audit of F-none: a style checker found, nothing about coverage. */
const REPORT = reportWith(["."], [foundAt("SI7", ".", "ruff.toml")]);

/**
 * Hold a declaration to the F-none report with the given questions section.
 * @param block - The `gates` block
 * @param questions - The report's `questions` value; left off when undefined
 * @returns One line per problem
 */
async function problemsWith(
  block: GatesBlock,
  questions?: unknown
): Promise<readonly string[]> {
  return declarationEvidenceProblems({
    register: await registerOf(block),
    report: REPORT as unknown as AuditReport,
    criteria: CRITERIA,
    document: questions === undefined ? REPORT : { ...REPORT, questions },
  });
}

const UNANSWERED =
  'The gate "coverage-adequacy" in .lisa.config.json has a part for the whole repository that rests on the audit question "coverage-floor", but .lisa/audit/report.json holds no answer to a question with that id. A rule is recorded only once its question is answered. Have the question answered and run the audit again, or remove the part.';

describe("the answered questions of a report", () => {
  it("are the ones that carry a non-blank answer", () => {
    expect(
      answeredQuestionIds({
        questions: [
          { id: "a", answer: "Eighty percent." },
          { id: "b", answer: "" },
          { id: "c", answer: "   " },
          { id: "d", answer: null },
          { id: "e" },
          { id: 7, answer: "yes" },
          "f",
          { id: "g", answer: "The platform team." },
        ],
      })
    ).toEqual(["a", "g"]);
  });

  it.each([
    ["a report with no questions list", {}],
    ["a questions value that is not a list", { questions: { a: "yes" } }],
    ["something that is not a report", "report"],
    ["nothing", null],
  ])("are none for %s", (_what, document) => {
    expect(answeredQuestionIds(document)).toEqual([]);
  });
});

describe("a part that rests on an answered question", () => {
  it("is supported once the report holds the answer", async () => {
    expect(
      await problemsWith(F_NONE_GATES, [
        { id: COVERAGE_QUESTION, answer: "Hold it at eighty percent." },
      ])
    ).toEqual([]);
  });

  it.each([
    ["the report records no questions", undefined],
    ["the question is not in the report", [{ id: "tracker", answer: "x" }]],
    ["the question has no answer yet", [{ id: COVERAGE_QUESTION }]],
    ["the answer is blank", [{ id: COVERAGE_QUESTION, answer: " " }]],
    ["the answer is null", [{ id: COVERAGE_QUESTION, answer: null }]],
  ])("is refused when %s", async (_what, questions) => {
    expect(await problemsWith(F_NONE_GATES, questions)).toEqual([UNANSWERED]);
  });

  it("is refused once for each question it names that has no answer", async () => {
    const block: GatesBlock = {
      "x-docs": {
        push: "optional",
        parts: [
          {
            scope: ".",
            command: ["vale", "."],
            evidence: { questions: ["tone", "owner", "reviewed"] },
          },
        ],
      },
    };

    const problems = await problemsWith(block, [
      { id: "owner", answer: "The docs team." },
    ]);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('rests on the audit question "tone"');
    expect(problems[1]).toContain('rests on the audit question "reviewed"');
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
        report: REPORT as unknown as AuditReport,
        criteria: CRITERIA,
        document: REPORT,
      })
    ).toEqual([]);
  });
});

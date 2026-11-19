/**
 * `lisa controls declaration-check` for a part that rests on an operator's
 * answer, run the whole way through.
 *
 * Nothing here writes an answer into the record by hand. The audit asks, the
 * report check renders the question, a person types on its answer line, the
 * absorb command records what was typed, and the audit decides the finding
 * from it. Only then does a part that names the question pass
 * (CodySwannGT/lisa#4984).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { requirementQuestionId } from "../../../src/controls/question-ids.js";
import {
  foundAt,
  openQuestion,
  reportWith,
} from "../../helpers/control-audit-findings.js";
import {
  amendFinding,
  sampleFinding,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { configFile, type GatesBlock } from "../../helpers/control-register.js";
import { declarationCheck } from "./support/declaration-check-run.js";
import {
  absorb,
  answerInline,
  audited,
  recordOf,
} from "./support/report-answers-run.js";
import { check, removeFixtures } from "./support/report-check-run.js";

const STYLE = "SI7";
const COVERAGE = "SI2";
const AT_COVERAGE = { criterion: COVERAGE, scope: "." } as const;
const QUESTION = requirementQuestionId(COVERAGE, ".");
const ANSWER = "Hold it at 41 percent, with pytest.";

/** The audit of F-none: a style checker found, and coverage asked about. */
const ASKED = reportWith(
  ["."],
  [foundAt(STYLE, ".", "ruff.toml"), openQuestion(COVERAGE, ".")]
);

/** A coverage check that rests on the answer to the audit's question. */
const RESTING_ON_THE_ANSWER: GatesBlock = {
  "coverage-adequacy": {
    "pull-request": "required",
    criteria: [COVERAGE],
    parts: [
      {
        scope: ".",
        command: ["python", "-m", "pytest", "--cov"],
        parameters: { "minimum-coverage": { value: 41, direction: "floor" } },
        evidence: { questions: [QUESTION] },
      },
    ],
  },
};

/**
 * An audited F-none whose declaration rests a part on the audit's question.
 * @returns The repository root
 */
async function declaredOnTheQuestion(): Promise<string> {
  const repoPath = await audited(ASKED);
  writeFileSync(
    path.join(repoPath, ".lisa.config.json"),
    configFile(RESTING_ON_THE_ANSWER)
  );
  return repoPath;
}

/**
 * Do what the audit does once a question has an answer: decide the finding
 * from it, so it no longer waits for a person.
 * @param repoPath - The repository root
 */
function decideFromTheAnswer(repoPath: string): void {
  writeAuditReport(
    repoPath,
    amendFinding(recordOf(repoPath), AT_COVERAGE, sampleFinding(COVERAGE, "."))
  );
}

afterEach(removeFixtures);

describe("a part that rests on a question the audit asked", () => {
  it("is refused while nobody has answered", async () => {
    const run = await declarationCheck(await declaredOnTheQuestion());

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain(
      `rests on the audit question "${QUESTION}", but that question is still waiting for its answer in .lisa/audit/report.md.`
    );
  });

  it("passes once a person has answered inline and the audit has absorbed it", async () => {
    const repoPath = await declaredOnTheQuestion();

    answerInline(repoPath, QUESTION, ANSWER);
    const absorbed = await absorb(repoPath);
    decideFromTheAnswer(repoPath);
    const checked = await check(repoPath);
    const run = await declarationCheck(repoPath);

    expect(absorbed.code).toBe(0);
    expect(checked.stderr).toEqual([]);
    expect(recordOf(repoPath).answers).toEqual([
      expect.objectContaining({
        id: QUESTION,
        answer: ANSWER,
      }),
    ]);
    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([
      "declaration-check: PASS. .lisa/audit/report.json supports the 1 part declared in .lisa.config.json",
    ]);
  });

  it("is refused again when the person takes the answer back", async () => {
    const repoPath = await declaredOnTheQuestion();
    answerInline(repoPath, QUESTION, ANSWER);
    await absorb(repoPath);
    decideFromTheAnswer(repoPath);
    await check(repoPath);

    answerInline(repoPath, QUESTION, "");
    await absorb(repoPath);
    const run = await declarationCheck(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain(
      `rests on the audit question "${QUESTION}", but .lisa/audit/report.json holds no answer to a question with that id.`
    );
  });
});

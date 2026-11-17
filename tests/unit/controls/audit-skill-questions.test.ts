/**
 * What the `lisa-audit` skill has to tell the agent about questions, checked
 * against the code that judges them.
 *
 * The skill's wording is not pinned. What is checked is that the agent is
 * given every name the code holds it to (the setup question ids, the fields
 * of a question and of an answer, the answer line an operator types on), that
 * absorbing comes before anything that could render the report again, and
 * that the one extra path the audit may write is named as such
 * (CodySwannGT/lisa#4980).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANSWER_PLACEHOLDER,
  QUESTIONS_END,
  QUESTIONS_START,
  WIKI_GAPS_PATH,
  answerLineStart,
} from "../../../src/controls/audit-questions-format.js";
import {
  SETUP_QUESTION_IDS,
  requirementQuestionId,
} from "../../../src/controls/question-ids.js";
import {
  AUDIT_SKILL_SOURCE,
  auditSkillExampleReports,
  auditSkillShellBlocks,
} from "../../helpers/audit-skill.js";
import type { SampleReport } from "../../helpers/control-audit-report.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AGENT_READY_SKILL = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-agent-ready",
  "SKILL.md"
);
const ABSORB = "lisa controls report-check --absorb";

/**
 * Read a skill as it is authored.
 * @param relative - Repository-relative path of the skill
 * @returns The document
 */
function skill(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * The names of a list the skill never puts in code style.
 * @param names - Names the agent has to write exactly
 * @returns Those the skill does not show
 */
function unnamed(names: readonly string[]): readonly string[] {
  const audit = skill(AUDIT_SKILL_SOURCE);
  return names.filter(name => !audit.includes(`\`${name}\``));
}

describe("the lisa-audit skill on questions", () => {
  it("names every setup question id the code accepts, and no agent has to invent one", () => {
    expect(unnamed(SETUP_QUESTION_IDS)).toEqual([]);
  });

  it("shows how the id of a requirement's question is formed", () => {
    expect(unnamed([requirementQuestionId("AC1.7", ".")])).toEqual([]);
    expect(unnamed([requirementQuestionId("SI7", "api")])).toEqual([]);
  });

  it("names every field of a question and of an answer on record", () => {
    expect(
      unnamed([
        "questions",
        "answers",
        "id",
        "text",
        "candidates",
        "found_in",
        "no_candidates_reason",
        "question",
        "answer",
      ])
    ).toEqual([]);
  });

  it("absorbs once, before it asks for the requirements", () => {
    const blocks = auditSkillShellBlocks().map(block => block.trim());

    expect(blocks.filter(block => block === ABSORB)).toHaveLength(1);
    expect(blocks.indexOf(ABSORB)).toBeLessThan(
      blocks.indexOf("lisa controls catalogue")
    );
    expect(blocks.indexOf(ABSORB)).toBeGreaterThan(
      blocks.indexOf("lisa --help")
    );
  });

  it("tells the operator which line to type on, as the report renders it", () => {
    const audit = skill(AUDIT_SKILL_SOURCE);

    expect(audit).toContain(`\`${answerLineStart()}\``);
    expect(audit).toContain(`\`${ANSWER_PLACEHOLDER}\``);
  });

  it("names the wiki file as the one extra path, in the ground rule and in the unchanged check", () => {
    const audit = skill(AUDIT_SKILL_SOURCE);
    const groundRules = audit.slice(
      audit.indexOf("## Ground rules"),
      audit.indexOf("## How to run the Lisa commands")
    );
    const unchanged = audit.slice(
      audit.indexOf("### Step 7:"),
      audit.indexOf("### Step 8:")
    );

    expect(groundRules).toContain(`\`${WIKI_GAPS_PATH}\``);
    expect(unchanged).toContain(`\`${WIKI_GAPS_PATH}\``);
  });

  it("shows an example record that asks the tracker question and one about a finding", () => {
    const [example] = auditSkillExampleReports().filter(
      (report): report is SampleReport =>
        typeof report === "object" &&
        report !== null &&
        Array.isArray((report as SampleReport).questions)
    );
    const asking = (example?.findings ?? [])
      .filter(finding => finding.state === "question")
      .map(finding =>
        requirementQuestionId(String(finding.criterion), String(finding.scope))
      );

    expect(asking.length).toBeGreaterThan(0);
    expect((example?.questions ?? []).map(question => question.id)).toEqual([
      SETUP_QUESTION_IDS[0],
      ...asking,
    ]);
    expect(example?.answers).toEqual([]);
  });
});

describe("the lisa-agent-ready skill", () => {
  it("is told to leave the audit's block of wiki/gaps.md alone, by its exact markers", () => {
    const agentReady = skill(AGENT_READY_SKILL);

    expect(agentReady).toContain(`\`${QUESTIONS_START}\``);
    expect(agentReady).toContain(`\`${QUESTIONS_END}\``);
  });
});

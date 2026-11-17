/**
 * The audit asks what it cannot establish, and never asks twice.
 *
 * These run the audit skill's own shell commands, exactly as the skill writes
 * them and in its order, with the built CLI, on fixture repositories. A
 * stand-in does the agent's one write. An operator's part is played by typing
 * on an answer line of the rendered report, and then the same commands are
 * run again, as a second audit would run them (CodySwannGT/lisa#4980).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fileOf, typeAnswer, writeFileOf } from "../helpers/audit-answers.js";
import {
  buildFMixed,
  buildFNone,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  writeAuditReport,
  type SampleReport,
} from "../helpers/control-audit-report.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  CATALOGUE_BLOCK,
  REPORT_CHECK_BLOCK,
  changedLines,
  installLisaCommand,
  runAuditSkillCommands,
  stepRunning,
  type SkillStep,
} from "./support/audit-skill-run.js";
import {
  answersOnRecord,
  REPORT_JSON,
  REPORT_MD,
  standInReport,
  TRACKER_QUESTION,
} from "./support/audit-stand-in.js";

useIoLatencyBudget();

const ABSORB = "lisa controls report-check --absorb";
const GAPS = "wiki/gaps.md";
const EVERY_FILE = [
  "status",
  "--porcelain",
  "--ignored",
  "--untracked-files=all",
];
const ANSWER = "GitHub Issues, in this repository";
const ANSWERED_LINE = `- **Answer**: ${ANSWER}`;
const TRACKER_HEADING = "### tracker";
const TRACKER_BLOCK = [
  TRACKER_HEADING,
  "",
  "- **Question**: Which tracker does the team plan and follow its work in?",
  "- **Candidates**:",
  "  - GitHub Issues. Found: Two commit messages end with a number sign and an issue number.",
  "- **Answer**: _(human fills in)_",
  "- **Status**: open",
];

const fixtures: ControlAuditFixture[] = [];
const lisa = { folder: "", remove: (): void => undefined };

/**
 * Keep a fixture so it is removed after the case.
 * @param built - The fixture
 * @returns Its repository root
 */
function repositoryOf(built: ControlAuditFixture): string {
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Run the skill's commands with a stand-in that follows the skill: it asks
 * the tracker question unless an answer to it is on record, and it copies the
 * answers on record over.
 * @param repoPath - The repository being audited
 * @param scopes - The parts the stand-in reports on
 * @returns The steps that ran
 */
function audit(
  repoPath: string,
  scopes: readonly string[] = ["."]
): readonly SkillStep[] {
  return runAuditSkillCommands(repoPath, lisa.folder, criteria => {
    const answers = answersOnRecord(repoPath);
    writeAuditReport(
      repoPath,
      standInReport(criteria, scopes, {
        answers,
        questions: answers.some(answer => answer.id === TRACKER_QUESTION.id)
          ? []
          : [TRACKER_QUESTION],
      })
    );
  });
}

/**
 * Read the record an audit left.
 * @param repoPath - Repository root
 * @returns The parsed record
 */
function recordOf(repoPath: string): SampleReport {
  return JSON.parse(fileOf(repoPath, REPORT_JSON)) as SampleReport;
}

/**
 * The lines of a file that are a question's heading.
 * @param text - The file's content
 * @returns Each third-level heading that is a question id
 */
function questionHeadings(text: string): readonly string[] {
  return text
    .split("\n")
    .filter(line => line === TRACKER_HEADING || /^### \S+@/u.test(line));
}

beforeEach(() => {
  Object.assign(lisa, installLisaCommand());
});

afterEach(() => {
  lisa.remove();
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("the audit of a repository with no tracker configured", () => {
  it("absorbs nothing, and does not fail, on a first run", () => {
    const steps = audit(repositoryOf(buildFNone()));

    expect(stepRunning(steps, ABSORB)).toMatchObject({
      status: 0,
      stdout: "report-check --absorb: PASS. No answers to absorb\n",
      stderr: "",
    });
    expect(steps.findIndex(step => step.block.trim() === ABSORB)).toBeLessThan(
      steps.findIndex(step => step.block.trim() === CATALOGUE_BLOCK)
    );
  });

  it("leaves one tracker question with the candidates it found, ready to answer", () => {
    const repoPath = repositoryOf(buildFNone());

    const steps = audit(repoPath);
    const readable = fileOf(repoPath, REPORT_MD);

    expect(stepRunning(steps, REPORT_CHECK_BLOCK).status).toBe(0);
    expect(recordOf(repoPath).questions).toEqual([TRACKER_QUESTION]);
    expect(readable).toContain(TRACKER_BLOCK.join("\n"));
    expect(questionHeadings(readable)).toEqual([TRACKER_HEADING]);
    expect(existsSync(path.join(repoPath, "wiki"))).toBe(false);
  });

  it("is refused by the check when the report does not ask", () => {
    const repoPath = repositoryOf(buildFNone());

    const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
      writeAuditReport(
        repoPath,
        standInReport(criteria, ["."], { questions: [] })
      );
    });
    const check = stepRunning(steps, REPORT_CHECK_BLOCK);

    expect(check.status).toBe(1);
    expect(check.stderr).toMatch(
      /^No tracker is configured for this repository, and the report does not ask which one the team uses\./u
    );
  });
});

describe("a second audit, after the operator answered inline", () => {
  it("records the answer as a fact and does not ask the question again", () => {
    const repoPath = repositoryOf(buildFNone());
    audit(repoPath);
    typeAnswer(repoPath, REPORT_MD, "tracker", ANSWER);

    const steps = audit(repoPath);
    const record = recordOf(repoPath);
    const readable = fileOf(repoPath, REPORT_MD);

    expect(stepRunning(steps, ABSORB).stdout).toBe(
      [
        `Recorded the answer to "${String(TRACKER_QUESTION.text)}": ${ANSWER}`,
        `report-check --absorb: PASS. 1 recorded, 0 replaced, 0 withdrawn in ${REPORT_JSON}`,
        "",
      ].join("\n")
    );
    expect(stepRunning(steps, REPORT_CHECK_BLOCK).status).toBe(0);
    expect(record.questions).toEqual([]);
    expect(record.answers).toEqual([
      { id: "tracker", question: TRACKER_QUESTION.text, answer: ANSWER },
    ]);
    expect(readable).not.toContain("## Open questions");
    expect(readable).toContain(
      [
        TRACKER_HEADING,
        "",
        "- **Question**: Which tracker does the team plan and follow its work in?",
        ANSWERED_LINE,
        "- **Status**: absorbed",
      ].join("\n")
    );
  });

  it("stays settled on a third audit, with nothing left to absorb", () => {
    const repoPath = repositoryOf(buildFNone());
    audit(repoPath);
    typeAnswer(repoPath, REPORT_MD, "tracker", ANSWER);
    audit(repoPath);
    const settled = fileOf(repoPath, REPORT_MD);

    const steps = audit(repoPath);

    expect(stepRunning(steps, ABSORB).stdout).toContain(
      "already holds every answer"
    );
    expect(stepRunning(steps, REPORT_CHECK_BLOCK).status).toBe(0);
    expect(fileOf(repoPath, REPORT_MD)).toBe(settled);
  });

  it("keeps the typed answer when the agent writes a record without it", () => {
    const repoPath = repositoryOf(buildFNone());
    audit(repoPath);
    typeAnswer(repoPath, REPORT_MD, "tracker", ANSWER);
    const typed = fileOf(repoPath, REPORT_MD);

    const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
      writeAuditReport(repoPath, standInReport(criteria, ["."]));
    });
    const check = stepRunning(steps, REPORT_CHECK_BLOCK);

    expect(check.status).toBe(1);
    expect(check.stderr).toMatch(
      /^\.lisa\/audit\/report\.md line \d+ holds an answer to .* that the record does not carry\. Run `lisa controls report-check --absorb`/u
    );
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });

  it("stops at the absorb step, changing nothing, when the answer is not on its line", () => {
    const repoPath = repositoryOf(buildFNone());
    audit(repoPath);
    writeFileOf(
      repoPath,
      REPORT_MD,
      fileOf(repoPath, REPORT_MD).replace(
        "- **Status**: open",
        `${ANSWER}\n- **Status**: open`
      )
    );
    const typed = fileOf(repoPath, REPORT_MD);
    const record = fileOf(repoPath, REPORT_JSON);

    const absorb = stepRunning(audit(repoPath), ABSORB);

    expect(absorb.status).toBe(1);
    expect(absorb.stderr).toMatch(
      /^\.lisa\/audit\/report\.md line \d+ is not part of a question\. Type the answer on the line that starts "- \*\*Answer\*\*:"/u
    );
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
    expect(fileOf(repoPath, REPORT_JSON)).toBe(record);
  });
});

describe("the audit of a repository that keeps a wiki", () => {
  const withWiki = (): ControlAuditFixture =>
    buildFMixed({ extraFiles: { "wiki/index.md": "# Wiki\n" } });

  it("has each open question once in the report and once in wiki/gaps.md", () => {
    const repoPath = repositoryOf(withWiki());

    const steps = audit(repoPath, [".", "api", "web"]);

    expect(stepRunning(steps, REPORT_CHECK_BLOCK).stdout).toMatch(
      /; wrote \.lisa\/audit\/report\.md and 1 open question to wiki\/gaps\.md\n$/u
    );
    expect(questionHeadings(fileOf(repoPath, REPORT_MD))).toEqual([
      TRACKER_HEADING,
    ]);
    expect(questionHeadings(fileOf(repoPath, GAPS))).toEqual([TRACKER_HEADING]);
    expect(fileOf(repoPath, GAPS)).toContain(TRACKER_BLOCK.join("\n"));
  });

  it("has its own comparison show the report, the wiki file and nothing else", () => {
    const repoPath = repositoryOf(withWiki());

    const steps = audit(repoPath, [".", "api", "web"]);

    expect(changedLines(stepRunning(steps, "diff ").stdout)).toEqual([
      "> ?? .lisa/",
      `> ?? ${GAPS}`,
      `> ?? ${REPORT_JSON}`,
      `> ?? ${REPORT_MD}`,
    ]);
    expect(runControlAuditGit(repoPath, EVERY_FILE).split("\n")).toEqual([
      `?? ${REPORT_JSON}`,
      `?? ${REPORT_MD}`,
      `?? ${GAPS}`,
    ]);
  });

  it("takes an answer typed in the wiki file, and stops listing the question there", () => {
    const repoPath = repositoryOf(withWiki());
    audit(repoPath, [".", "api", "web"]);
    typeAnswer(repoPath, GAPS, "tracker", ANSWER);

    const steps = audit(repoPath, [".", "api", "web"]);

    expect(stepRunning(steps, REPORT_CHECK_BLOCK).status).toBe(0);
    expect(recordOf(repoPath).answers).toEqual([
      { id: "tracker", question: TRACKER_QUESTION.text, answer: ANSWER },
    ]);
    expect(questionHeadings(fileOf(repoPath, GAPS))).toEqual([]);
    expect(fileOf(repoPath, REPORT_MD)).toContain(ANSWERED_LINE);
  });
});

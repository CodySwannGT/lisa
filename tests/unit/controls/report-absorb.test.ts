/**
 * `lisa controls report-check --absorb`: moving what a person typed on an
 * answer line into the record, as a fact, and dropping the question.
 *
 * The command is the only thing that writes an answer into the record. It
 * never decides one: what it records is what stands on the answer line, and
 * a file it cannot read in the written form is refused whole, with nothing
 * changed (CodySwannGT/lisa#4980).
 */
import { rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AUDIT_REPORT_JSON_PATH } from "../../../src/controls/audit-report.js";
import {
  buildFNone,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  askAbout,
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { AT_FIRST, FIRST, WHOLE } from "./audit-report-facts.js";
import {
  absorb,
  answerInline,
  audited,
  fileOf,
  recordOf,
  REPORT_MD,
  writeFileOf,
} from "./support/report-answers-run.js";
import { check, keep, removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const FIRST_ID = `${FIRST}@${WHOLE}`;
const TRACKER_TEXT = "Which tracker does the team plan and follow its work in?";
const PASS = "report-check --absorb: PASS.";
const GITHUB = "GitHub Issues";

describe("with nothing to absorb", () => {
  it("passes on a first run, where no report exists, and writes nothing", async () => {
    const { repoPath } = keep(buildFNone());

    const run = await absorb(repoPath);

    expect(run).toEqual({
      code: 0,
      stdout: [`${PASS} No answers to absorb`],
      stderr: [],
    });
    expect(runControlAuditGit(repoPath, ["status", "--porcelain"])).toBe("");
  });

  it("leaves the record as it is when no answer line was typed on", async () => {
    const repoPath = await audited(completeAuditReport());
    const before = fileOf(repoPath, AUDIT_REPORT_JSON_PATH);

    const run = await absorb(repoPath);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([`${PASS} No answers to absorb`]);
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(before);
  });

  it.each([
    "TBD",
    "?",
    "n/a",
    "*(human fills in)*",
    String.raw`\_(human fills in)\_`,
  ])(
    "records nothing for an answer line that holds only %s, and the question stays open",
    async placeholder => {
      const repoPath = await audited(completeAuditReport());
      answerInline(repoPath, "tracker", placeholder);
      const before = fileOf(repoPath, AUDIT_REPORT_JSON_PATH);

      const run = await absorb(repoPath);
      const checked = await check(repoPath);

      expect(run.stdout).toEqual([`${PASS} No answers to absorb`]);
      expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(before);
      expect(checked.stderr).toEqual([]);
      expect(fileOf(repoPath, REPORT_MD)).toContain(
        ["- **Answer**: _(human fills in)_", "- **Status**: open"].join("\n")
      );
    }
  );
});

describe("an answer typed on an answer line", () => {
  it("is recorded as a fact under the question's id, and the question is dropped", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);

    const run = await absorb(repoPath);
    const record = recordOf(repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(record.questions).toEqual([]);
    expect(record.answers).toEqual([
      { id: "tracker", question: TRACKER_TEXT, answer: GITHUB },
    ]);
    expect(run.stdout).toEqual([
      `Recorded the answer to "${TRACKER_TEXT}": GitHub Issues`,
      `${PASS} 1 recorded, 0 replaced, 0 withdrawn in ${AUDIT_REPORT_JSON_PATH}`,
    ]);
  });

  it("leaves the readable report exactly as the person left it", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    const typed = fileOf(repoPath, REPORT_MD);

    await absorb(repoPath);

    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });

  it("leaves the finding it was about for the audit to decide again", async () => {
    const repoPath = await audited(askAbout(completeAuditReport(), AT_FIRST));
    answerInline(repoPath, FIRST_ID, "The head of engineering");

    await absorb(repoPath);
    const record = recordOf(repoPath);

    expect(record.questions?.map(question => question.id)).toEqual(["tracker"]);
    expect(record.answers?.map(answer => answer.id)).toEqual([FIRST_ID]);
    expect(
      record.findings.find(finding => finding.criterion === FIRST)?.state
    ).toBe("question");
  });

  it("changes nothing when it is absorbed a second time", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    const once = fileOf(repoPath, AUDIT_REPORT_JSON_PATH);

    const run = await absorb(repoPath);

    expect(run.stdout).toEqual([
      `${PASS} The record already holds every answer written in the report`,
    ]);
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(once);
  });

  it("replaces the answer on record when the person changes it", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    answerInline(repoPath, "tracker", "Jira");

    const run = await absorb(repoPath);

    expect(recordOf(repoPath).answers).toEqual([
      { id: "tracker", question: TRACKER_TEXT, answer: "Jira" },
    ]);
    expect(run.stdout.at(-1)).toBe(
      `${PASS} 0 recorded, 1 replaced, 0 withdrawn in ${AUDIT_REPORT_JSON_PATH}`
    );
  });

  it("withdraws the answer on record when the person empties its line under the answered questions", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    await check(repoPath);
    answerInline(repoPath, "tracker", "");

    const run = await absorb(repoPath);

    expect(recordOf(repoPath).answers).toEqual([]);
    expect(run.stdout).toEqual([
      `Withdrew the answer to "${TRACKER_TEXT}": its answer line is empty`,
      `${PASS} 0 recorded, 0 replaced, 1 withdrawn in ${AUDIT_REPORT_JSON_PATH}`,
    ]);
  });

  it("withdraws nothing when the line of a question still shown as open is emptied", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    answerInline(repoPath, "tracker", "");

    const run = await absorb(repoPath);

    expect(run.stdout).toEqual([`${PASS} No answers to absorb`]);
    expect(recordOf(repoPath).answers).toHaveLength(1);
  });

  it("is recorded even when a new record no longer asks the question", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    writeAuditReport(repoPath, { ...completeAuditReport(), questions: [] });

    await absorb(repoPath);

    expect(recordOf(repoPath).answers).toEqual([
      { id: "tracker", question: TRACKER_TEXT, answer: GITHUB },
    ]);
  });

  it("waits, without failing, while there is no record to put it in", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    const typed = fileOf(repoPath, REPORT_MD);
    rmSync(path.join(repoPath, AUDIT_REPORT_JSON_PATH));

    const run = await absorb(repoPath);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      `${PASS} 1 answer is written in the report, but there is no ${AUDIT_REPORT_JSON_PATH} to record it in yet. Run this again once the audit has written one`,
    ]);
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });
});

describe("a refusal changes nothing", () => {
  it.each([
    {
      name: "text typed under the answer line instead of on it",
      spoil: (text: string) =>
        text.replace("- **Status**: open", "GitHub Issues\n- **Status**: open"),
      says: /^\.lisa\/audit\/report\.md line \d+ is not part of a question/u,
    },
    {
      name: "text typed on the question instead of on the answer line",
      spoil: (text: string) =>
        text.replace(
          `- **Question**: ${TRACKER_TEXT}`,
          `- **Question**: ${TRACKER_TEXT} GitHub Issues`
        ),
      says: /^\.lisa\/audit\/report\.md line \d+ is not as Lisa wrote it: it was typed on, or added\. Only the answer line is read/u,
    },
    {
      name: "text typed on the line that says where the audit looked",
      spoil: (text: string) =>
        text.replace(
          "- **Candidates**: none found",
          "- **Candidates**: none found, but it is GitHub Issues"
        ),
      says: /^\.lisa\/audit\/report\.md line \d+ is not as Lisa wrote it/u,
    },
    {
      name: "a closing marker that was deleted",
      spoil: (text: string) =>
        text.replace("<!-- lisa:audit-questions:end -->\n", ""),
      says: /^\.lisa\/audit\/report\.md line \d+ opens the questions block, but nothing closes it/u,
    },
  ])("for $name, and names the line", async ({ spoil, says }) => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    writeFileOf(repoPath, REPORT_MD, spoil(fileOf(repoPath, REPORT_MD)));
    const record = fileOf(repoPath, AUDIT_REPORT_JSON_PATH);
    const typed = fileOf(repoPath, REPORT_MD);

    const run = await absorb(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toMatch(says);
    expect(run.stderr.at(-1)).toBe(
      "report-check --absorb: FAIL. 1 problem; nothing was changed"
    );
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(record);
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });

  it.each([
    { name: "is not valid JSON", record: "{ not json" },
    { name: "is not an object", record: "[]" },
    { name: "holds questions that are not a list", record: '{"questions":{}}' },
    { name: "holds answers that are not a list", record: '{"answers":"x"}' },
  ])("when the record $name", async ({ record }) => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    writeFileOf(repoPath, AUDIT_REPORT_JSON_PATH, record);

    const run = await absorb(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr.at(-1)).toMatch(/nothing was changed$/u);
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(record);
    expect(fileOf(repoPath, REPORT_MD)).toContain(
      "- **Answer**: GitHub Issues"
    );
  });

  it("when the path named is not a folder", async () => {
    const run = await absorb(path.join(keep(buildFNone()).repoPath, "absent"));

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(/is not a folder/u);
  });
});

describe("a readable report that is a link", () => {
  it("is not read, so nothing outside the repository becomes an answer", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    const elsewhere = path.join(keep(buildFNone()).repoPath, "typed.md");
    writeFileOf(
      path.dirname(elsewhere),
      "typed.md",
      fileOf(repoPath, REPORT_MD)
    );
    rmSync(path.join(repoPath, REPORT_MD));
    symlinkSync(elsewhere, path.join(repoPath, REPORT_MD));

    const run = await absorb(repoPath);

    expect(run.stdout).toEqual([`${PASS} No answers to absorb`]);
    expect(recordOf(repoPath).answers).toBeUndefined();
  });
});

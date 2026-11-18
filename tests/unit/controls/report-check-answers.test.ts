/**
 * An answer a person typed in the readable report survives every path.
 *
 * A passing check renders `.lisa/audit/report.md` again from the record, so
 * an answer that is on an answer line but not in the record would be
 * overwritten with an empty line. These cases walk each way a run can go
 * (the check alone, absorb and then a pass, absorb and then a failure, an
 * agent that rewrites the record without the answers) and show the answer is
 * still there at the end of every one (CodySwannGT/lisa#4980).
 *
 * The other direction is held as strictly: an answer in the record counts
 * only while a file a person types in still holds the same words on that
 * question's answer line. A record that holds answers with no readable
 * report beside it used to pass, which let an agent write the answers
 * itself, and let a deleted report be rendered again as if a person had just
 * typed in it (CodySwannGT/lisa#4978).
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AUDIT_REPORT_JSON_PATH } from "../../../src/controls/audit-report.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { AT_FIRST, FIRST, WHOLE } from "./audit-report-facts.js";
import { gaps } from "./support/gaps-run.js";
import {
  absorb,
  answerInline,
  audited,
  fileOf,
  recordOf,
  REPORT_MD,
  writeFileOf,
} from "./support/report-answers-run.js";
import { check, removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const FIRST_ID = `${FIRST}@${WHOLE}`;
const GITHUB = "GitHub Issues";
const HEAD = "The head of engineering";
const TYPED = `- **Answer**: ${GITHUB}`;
const ABSORB = "`lisa controls report-check --absorb`";
const ASKED = "Which tracker is used?";

/**
 * The lines of the readable report from one heading to the next.
 * @param repoPath - Repository root
 * @param heading - The start of the heading that opens the section
 * @returns The section's lines
 */
function sectionOf(repoPath: string, heading: string): readonly string[] {
  const lines = fileOf(repoPath, REPORT_MD).split("\n");
  const start = lines.findIndex(line => line.startsWith(heading));
  const end = lines.findIndex(
    (line, index) =>
      index > start && (line.startsWith("## ") || line.startsWith("<!--"))
  );
  return start === -1 ? [] : lines.slice(start, end);
}

describe("the check alone, with an answer nobody absorbed", () => {
  it("refuses, names the line, and leaves the answer where it was typed", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    const typed = fileOf(repoPath, REPORT_MD);
    const line = typed.split("\n").indexOf(TYPED) + 1;

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(
      `${REPORT_MD} line ${line} holds an answer to "Which tracker does the team plan and follow its work in?" that the record does not carry. Run ${ABSORB} to record it, then run this check again.`
    );
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });

  it("refuses a report that cannot be read in the written form, and leaves it alone", async () => {
    const repoPath = await audited(completeAuditReport());
    writeFileOf(
      repoPath,
      REPORT_MD,
      fileOf(repoPath, REPORT_MD).replace(
        "- **Status**: open",
        "GitHub Issues\n- **Status**: open"
      )
    );
    const typed = fileOf(repoPath, REPORT_MD);

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(
      /report\.md line \d+ is not part of a question/u
    );
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
  });

  it("stops every command that reads the report, not only the check", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);

    const run = await gaps(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain("holds an answer to");
  });
});

describe("absorb, then a check that passes", () => {
  it("shows the answer as answered and stops asking the question", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);

    const absorbed = await absorb(repoPath);
    const run = await check(repoPath);

    expect(absorbed.code).toBe(0);
    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(sectionOf(repoPath, "## Open questions")).toEqual([]);
    expect(sectionOf(repoPath, "## Answered questions")).toContain(TYPED);
    expect(recordOf(repoPath).answers).toEqual([
      expect.objectContaining({ id: "tracker", answer: GITHUB }),
    ]);
  });

  it("keeps passing, with the answer still there, on every later check", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    await check(repoPath);
    const rendered = fileOf(repoPath, REPORT_MD);

    const again = await absorb(repoPath);
    const run = await check(repoPath);

    expect(again.stdout[0]).toContain("already holds every answer");
    expect(run.code).toBe(0);
    expect(fileOf(repoPath, REPORT_MD)).toBe(rendered);
  });
});

describe("absorb, then a check that fails", () => {
  it("keeps the answer in the record and on the line it was typed on", async () => {
    const repoPath = await audited(askAbout(completeAuditReport(), AT_FIRST));
    answerInline(repoPath, FIRST_ID, HEAD);
    const typed = fileOf(repoPath, REPORT_MD);

    await absorb(repoPath);
    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(`its question was answered: "${HEAD}"`);
    expect(fileOf(repoPath, REPORT_MD)).toBe(typed);
    expect(recordOf(repoPath).answers).toEqual([
      expect.objectContaining({
        id: FIRST_ID,
        answer: HEAD,
      }),
    ]);
  });

  it("passes once the audit has decided the finding from the answer", async () => {
    const repoPath = await audited(askAbout(completeAuditReport(), AT_FIRST));
    answerInline(repoPath, FIRST_ID, HEAD);
    await absorb(repoPath);
    writeAuditReport(
      repoPath,
      amendFinding(recordOf(repoPath), AT_FIRST, { state: "missing" })
    );

    const run = await check(repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(fileOf(repoPath, REPORT_MD)).toContain(
      "- **Your answer on record:** The head of engineering"
    );
  });
});

describe("an audit that writes its record again without the answers", () => {
  it("is refused, and absorbing again puts the answer back", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    const typed = fileOf(repoPath, REPORT_MD);
    writeAuditReport(repoPath, completeAuditReport());

    const refused = await check(repoPath);
    const kept = fileOf(repoPath, REPORT_MD);
    await absorb(repoPath);
    const run = await check(repoPath);

    expect(refused.code).toBe(1);
    expect(refused.stderr[0]).toContain("that the record does not carry");
    expect(kept).toBe(typed);
    expect(run.code).toBe(0);
    expect(sectionOf(repoPath, "## Answered questions")).toContain(TYPED);
  });

  it("is refused when it changes the words of an answer", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    const record = recordOf(repoPath);
    writeAuditReport(repoPath, {
      ...record,
      answers: [{ ...record.answers?.[0], answer: "GitHub" }],
    });

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(
      "a different answer from the one on record"
    );
    expect(fileOf(repoPath, REPORT_MD)).toContain(TYPED);
  });
});

describe("an answer the person took back", () => {
  it("is refused by the check until absorbing withdraws it", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, "tracker", GITHUB);
    await absorb(repoPath);
    await check(repoPath);
    answerInline(repoPath, "tracker", "");

    const refused = await check(repoPath);
    const withdrawn = await absorb(repoPath);

    expect(refused.code).toBe(1);
    expect(refused.stderr[0]).toMatch(
      /^The answer line at \.lisa\/audit\/report\.md line \d+ is empty, but the record still holds an answer to .*\. Run `lisa controls report-check --absorb` to withdraw the answer/u
    );
    expect(withdrawn.stdout[0]).toMatch(/^Withdrew the answer to /u);
    expect(recordOf(repoPath).answers).toEqual([]);
  });
});

describe("an answer nobody typed", () => {
  it("is refused when the record answers a question the report still shows as open", async () => {
    const repoPath = await audited(completeAuditReport());
    writeAuditReport(repoPath, {
      ...completeAuditReport(),
      questions: [],
      answers: [{ id: "tracker", question: ASKED, answer: "Jira" }],
    });

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(
      `The record holds an answer to "${ASKED}" that is not written in ${REPORT_MD}. Only an answer a person typed in the report is recorded: remove it from "answers".`
    );
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toContain(`"Jira"`);
  });

  it("is refused when the report has no entry for it at all", async () => {
    const repoPath = await audited(completeAuditReport());
    writeAuditReport(repoPath, {
      ...completeAuditReport(),
      answers: [{ id: FIRST_ID, question: "Who decides?", answer: "Someone" }],
    });

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(
      `The record holds an answer to "Who decides?" that is not written in ${REPORT_MD}. Only an answer a person typed in the report is recorded: remove it from "answers".`
    );
  });

  it("is refused from a record that has no readable report beside it, because nothing shows a person typed it", async () => {
    const repoPath = await audited(completeAuditReport());
    rmSync(path.join(repoPath, REPORT_MD));
    writeAuditReport(repoPath, {
      ...completeAuditReport(),
      questions: [],
      answers: [{ id: "tracker", question: ASKED, answer: "Jira" }],
    });

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(
      `The record holds an answer to "${ASKED}", but ${REPORT_MD} is not there, so nothing shows that a person typed it. Put the file back as it was, or remove the answer from "answers" so that the audit asks the question again.`
    );
    expect(existsSync(path.join(repoPath, REPORT_MD))).toBe(false);
  });
});

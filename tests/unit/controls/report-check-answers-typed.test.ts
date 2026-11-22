/**
 * An answer in the record counts only while a person's typing backs it.
 *
 * The record is a file an agent writes. An entry of its `answers` is a
 * person's answer only while a file a person types in, the readable report or
 * the wiki's gaps file, still holds the same words on that question's answer
 * line. A record with answers and no readable report beside it used to pass:
 * on a first audit that let an agent write the answers itself, and after a
 * report was deleted it let the next check render them again as if a person
 * had just typed them. These cases pin that the check now stops, says what to
 * do, and passes again by either way out (CodySwannGT/lisa#4978).
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  writeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  absorb,
  answerInline,
  audited,
  fileOf,
  GAPS,
  recordOf,
  REPORT_MD,
  writeFileOf,
} from "./support/report-answers-run.js";
import {
  check,
  checkOnFNone,
  removeFixtures,
} from "./support/report-check-run.js";

afterEach(removeFixtures);

const TRACKER = "tracker";
const GITHUB = "GitHub Issues";
const ASKED = "Which tracker does the team plan and follow its work in?";

/** What the check says about an answer when the readable report is gone. */
const NOT_THERE = `The record holds an answer to "${ASKED}", but ${REPORT_MD} is not there, so nothing shows that a person typed it. Put the file back as it was, or remove the answer from "answers" so that the audit asks the question again.`;

/**
 * A record that answers the tracker question without asking it.
 * @param answer - The answer it holds
 * @returns The report
 */
function answering(answer: string): SampleReport {
  return {
    ...completeAuditReport(),
    questions: [],
    answers: [{ id: TRACKER, question: ASKED, answer }],
  };
}

/**
 * A repository in which a person answered the tracker question in the
 * readable report, and every command has run since.
 * @returns The repository root
 */
async function answered(): Promise<string> {
  const repoPath = await audited(completeAuditReport());
  answerInline(repoPath, TRACKER, GITHUB);
  await absorb(repoPath);
  await check(repoPath);
  return repoPath;
}

describe("a record that holds an answer on a first audit", () => {
  it("is refused, because no readable report was ever there for a person to type in", async () => {
    const run = await checkOnFNone(answering("Jira"));

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(NOT_THERE);
    expect(existsSync(path.join(run.repoPath, REPORT_MD))).toBe(false);
  });

  it("is refused for its shape when the answer only stands in for one", async () => {
    const run = await checkOnFNone(answering("TBD"));

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(`needs an "answer": what the person typed`);
  });
});

describe("a readable report that is deleted after a person answered in it", () => {
  it("stops the check, so the answer is not rendered again as if someone had just typed it", async () => {
    const repoPath = await answered();
    rmSync(path.join(repoPath, REPORT_MD));

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(NOT_THERE);
    expect(existsSync(path.join(repoPath, REPORT_MD))).toBe(false);
    expect(recordOf(repoPath).answers).toEqual([
      expect.objectContaining({ id: TRACKER, answer: GITHUB }),
    ]);
  });

  it("passes again once the file is put back as it was", async () => {
    const repoPath = await answered();
    const rendered = fileOf(repoPath, REPORT_MD);
    rmSync(path.join(repoPath, REPORT_MD));
    const refused = await check(repoPath);
    writeFileOf(repoPath, REPORT_MD, rendered);

    const run = await check(repoPath);

    expect(refused.code).toBe(1);
    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
  });

  it("passes once the answer is removed from the record, and asks the question again", async () => {
    const repoPath = await answered();
    rmSync(path.join(repoPath, REPORT_MD));
    writeAuditReport(repoPath, completeAuditReport());

    const run = await check(repoPath);

    expect(run.code).toBe(0);
    expect(fileOf(repoPath, REPORT_MD)).toContain(
      ["- **Answer**: _(human fills in)_", "- **Status**: open"].join("\n")
    );
  });
});

describe("an answer typed in the wiki's gaps file", () => {
  it("counts while the report is gone, because the line a person typed on is still there", async () => {
    const repoPath = await audited(completeAuditReport(), () =>
      buildFNone({ extraFiles: { "wiki/index.md": "# Wiki\n" } })
    );
    answerInline(repoPath, TRACKER, GITHUB, GAPS);
    await absorb(repoPath);
    rmSync(path.join(repoPath, REPORT_MD));

    const run = await check(repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(fileOf(repoPath, REPORT_MD)).toContain(
      [`- **Answer**: ${GITHUB}`, "- **Status**: absorbed"].join("\n")
    );
  });
});

/**
 * `lisa controls report-check --absorb` does not copy a secret's value into
 * the record.
 *
 * An answer is the one piece of text in the audit report a person types, so
 * it is where a token gets pasted by mistake. The command that moves answers
 * into the committed record refuses one shaped like a credential before it
 * writes anything, and says which line to correct without repeating it.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { afterEach, describe, expect, it } from "vitest";

import { AUDIT_REPORT_JSON_PATH } from "../../../src/controls/audit-report.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import {
  absorb,
  answerInline,
  audited,
  fileOf,
  REPORT_MD,
  writeFileOf,
} from "./support/report-answers-run.js";
import { check, removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const TOKEN = fakeGithubToken();
const TRACKER = "tracker";
const STATUS_OPEN_LINE = "- **Status**: open";

describe("an answer that holds something shaped like a credential", () => {
  it("is not recorded, and the line to correct is named without the value", async () => {
    const repoPath = await audited(completeAuditReport());
    const before = fileOf(repoPath, AUDIT_REPORT_JSON_PATH);
    answerInline(repoPath, TRACKER, `GitHub Issues, signed in with ${TOKEN}`);

    const run = await absorb(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toMatch(
      new RegExp(
        `^The answer typed on line \\d+ of ${REPORT_MD.replaceAll(".", "\\.")} holds something shaped like a credential: a GitHub token\\. An answer is copied into ${AUDIT_REPORT_JSON_PATH.replaceAll(".", "\\.")}, which is shared, so it was not recorded\\. Take the value off the answer line and write the name it goes by instead\\. The value is not repeated here\\.$`,
        "u"
      )
    );
    expect(run.stderr.at(-1)).toBe(
      "report-check --absorb: FAIL. 1 problem; nothing was changed"
    );
    expect(said).not.toContain(TOKEN);
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toBe(before);
  });

  it("is recorded once the value is replaced by the name it goes by", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, TRACKER, `GitHub Issues, signed in with ${TOKEN}`);
    await absorb(repoPath);
    answerInline(
      repoPath,
      TRACKER,
      "GitHub Issues, signed in with the token named TRACKER_TOKEN"
    );

    const run = await absorb(repoPath);

    expect(run.code).toBe(0);
    expect(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)).toContain("TRACKER_TOKEN");
  });

  it("prints no value when a heading was overwritten with one", async () => {
    const repoPath = await audited(completeAuditReport());
    writeFileOf(
      repoPath,
      REPORT_MD,
      fileOf(repoPath, REPORT_MD).replace(`### ${TRACKER}`, `### ${TOKEN}`)
    );

    const run = await absorb(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    // The question's id is read from the comment line under it, so the
    // refusal names the heading's line and repeats nothing typed on it.
    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(/ line \d+ is not as Lisa wrote it/u);
    expect(said).not.toContain(TOKEN);
  });

  it("takes the value out of a refusal that quotes what was typed", async () => {
    const repoPath = await audited(completeAuditReport());
    writeFileOf(
      repoPath,
      REPORT_MD,
      fileOf(repoPath, REPORT_MD).replace(
        STATUS_OPEN_LINE,
        `${STATUS_OPEN_LINE}\n- **${TOKEN}**: yes`
      )
    );

    const run = await absorb(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(said).toContain('has the label "[REDACTED:GITHUB_TOKEN]"');
    expect(said).not.toContain(TOKEN);
  });

  it("takes the value out of the comment line a refusal gives back", async () => {
    // A question that holds an answer and has lost its comment line is given
    // the line to put back, and that line carries the id from the heading.
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, TRACKER, "GitHub Issues");
    writeFileOf(
      repoPath,
      REPORT_MD,
      fileOf(repoPath, REPORT_MD)
        .replace(`### ${TRACKER}`, `### AC1.1@${TOKEN}`)
        .replace(/^<!-- lisa:audit-question-lines:.*\n/mu, "")
    );

    const run = await absorb(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(said).toContain("Put this line back under its Status line instead");
    expect(said).toContain("id=AC1.1@[REDACTED:GITHUB_TOKEN]");
    expect(said).not.toContain(TOKEN);
  });

  it("keeps the check from repeating the value while the answer waits to be absorbed", async () => {
    const repoPath = await audited(completeAuditReport());
    answerInline(repoPath, TRACKER, `Signed in with ${TOKEN}`);

    const run = await check(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(said).not.toContain(TOKEN);
  });
});

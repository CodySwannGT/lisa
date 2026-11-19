/**
 * The audit report refers to a secret by its name and never holds its value.
 *
 * The report is committed and shared. Whatever the audit wrote or a person
 * typed into it, a value shaped like a credential makes the check refuse the
 * report, name the place, and render nothing, without ever repeating the
 * value.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SECRET_VALUES_RULE } from "../../../src/controls/audit-report-rules/secret-values.js";
import {
  AUDIT_REPORT_MARKDOWN_PATH,
  formatAuditReportViolation,
} from "../../../src/controls/audit-report.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  sampleQuestion,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { AT_FIRST, FIRST, WHOLE, violationsOf } from "./audit-report-facts.js";
import { checkOnFNone, removeFixtures } from "./support/report-check-run.js";

const TOKEN = fakeGithubToken();
const RANDOM = fakeCredential();
const REPORT = ".lisa/audit/report.json";
const GITHUB = "a GitHub token";

/**
 * What the rule says about a report.
 * @param report - The report
 * @returns The rule's messages
 */
function found(report: SampleReport): readonly string[] {
  return violationsOf(report)
    .filter(violation => violation.rule === SECRET_VALUES_RULE)
    .map(violation => violation.message);
}

/**
 * The one message the rule is expected to give.
 * @param place - Where in the report the value is
 * @param shape - What the value is shaped like
 * @returns The message
 */
function refusal(place: string, shape: string = GITHUB): string {
  return `${REPORT} holds something shaped like a credential at ${place}: ${shape}. Take the value out and write the name it goes by instead. The value is not repeated here.`;
}

/**
 * The complete report with its first finding changed.
 * @param change - Fields to set on it
 * @returns The report
 */
function withFirst(change: Readonly<Record<string, unknown>>): SampleReport {
  return amendFinding(completeAuditReport(), AT_FIRST, change);
}

/** A mechanism the audit found, with one field replaced. */
const MECHANISM = {
  tool: "ruff",
  command: "ruff check .",
  moment: "commit",
  locators: [{ path: "ruff.toml", line: 4 }],
};

afterEach(removeFixtures);

describe("a report that names things without showing them", () => {
  it.each([
    ["one part", [WHOLE]],
    ["two folders", [WHOLE, "api", "web"]],
  ])("passes for %s", (_name, scopes) => {
    expect(found(completeAuditReport(scopes))).toEqual([]);
  });

  it("passes when a finding names the secret a check reads", () => {
    const report = withFirst({
      what: "The deploy step reads the token named DEPLOY_TOKEN from the pipeline's secrets.",
    });

    expect(found(report)).toEqual([]);
  });
});

describe("a finding that holds something shaped like a credential", () => {
  it.each([["what"], ["why"], ["next"]])(
    "is refused in its %s, naming the place",
    field => {
      expect(
        found(withFirst({ [field]: `It is set to ${TOKEN} today.` }))
      ).toEqual([refusal(`findings[0].${field}`)]);
    }
  );

  it.each([
    ["tool", { ...MECHANISM, tool: TOKEN }, "findings[0].mechanisms[0].tool"],
    [
      "command",
      { ...MECHANISM, command: `curl -H "X-Token: ${TOKEN}" x` },
      "findings[0].mechanisms[0].command",
    ],
    [
      "locator path",
      { ...MECHANISM, locators: [{ path: `keys/${TOKEN}.pem`, line: 1 }] },
      "findings[0].mechanisms[0].locators[0].path",
    ],
  ])("is refused in a mechanism's %s", (_name, mechanism, place) => {
    const report = withFirst({
      state: "exists-not-enforced",
      mechanisms: [mechanism],
    });

    expect(found(report)).toEqual([refusal(place)]);
  });

  it("is refused for a random-looking value beside a name that says it is a secret", () => {
    const report = withFirst({
      state: "exists-not-enforced",
      mechanisms: [{ ...MECHANISM, command: `deploy --token ${RANDOM}` }],
    });

    expect(found(report)).toEqual([
      refusal(
        "findings[0].mechanisms[0].command",
        "a long random-looking value beside a name such as token, secret or password"
      ),
    ]);
  });
});

describe("a question or an answer that holds something shaped like a credential", () => {
  const ASKED = sampleQuestion(FIRST, WHOLE);

  it.each([
    [
      "its text",
      { ...ASKED, text: `Is ${TOKEN} still in use?` },
      "questions[1].text",
    ],
    [
      "a candidate answer",
      {
        ...ASKED,
        candidates: [{ answer: TOKEN, found_in: "The settings file." }],
      },
      "questions[1].candidates[0].answer",
    ],
    [
      "where a candidate was found",
      {
        ...ASKED,
        candidates: [{ answer: "The team lead", found_in: `In ${TOKEN}.` }],
      },
      "questions[1].candidates[0].found_in",
    ],
  ])("is refused for a question in %s", (_name, question, place) => {
    const report = askAbout(completeAuditReport(), AT_FIRST, question);

    expect(found(report)).toEqual([refusal(place)]);
  });

  it("is refused for a recorded answer", () => {
    const report = {
      ...completeAuditReport(),
      answers: [
        { id: ASKED.id, question: String(ASKED.text), answer: `Use ${TOKEN}.` },
      ],
    };

    expect(found(report)).toEqual([refusal("answers[0].answer")]);
  });
});

describe("the check of a report that holds something shaped like a credential", () => {
  it("fails, names the place, renders nothing and never repeats the value", async () => {
    const run = await checkOnFNone(
      withFirst({ what: `The pipeline signs in with ${TOKEN}.` })
    );
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(refusal("findings[0].what"));
    expect(said).not.toContain(TOKEN);
    expect(said).not.toContain(TOKEN.slice(4, 16));
    expect(
      existsSync(path.join(run.repoPath, AUDIT_REPORT_MARKDOWN_PATH))
    ).toBe(false);
  });

  it("never repeats a value another rule quotes", async () => {
    const run = await checkOnFNone({
      ...completeAuditReport(),
      scopes: [WHOLE, TOKEN],
    });
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(said).not.toContain(TOKEN);
  });

  it("takes a value out of any line it prints about a violation", () => {
    const line = formatAuditReportViolation({
      rule: "scopes",
      message: `The folder "${TOKEN}" is not in the repository.`,
      scope: TOKEN,
    });

    expect(line).not.toContain(TOKEN);
    expect(line).toContain("[REDACTED:GITHUB_TOKEN]");
  });
});

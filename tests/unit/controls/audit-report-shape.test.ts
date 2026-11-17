/**
 * The shape of an audit report, and how its problems read.
 *
 * Shape is checked before any rule: a report with a section, a field or a word
 * the code does not know is refused rather than half-read. Whatever is wrong,
 * the line that reports it is one plain sentence, with the criterion id and
 * the folder after it as the place to look (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_SECTIONS,
  formatAuditReportViolation,
  parseAuditReport,
} from "../../../src/controls/audit-report.js";
import { criterionIdsIn } from "../../../src/controls/catalogue.js";
import {
  amendFinding,
  completeAuditReport,
  dropFinding,
  sampleFinding,
} from "../../helpers/control-audit-report.js";
import {
  API,
  AT_FIRST,
  EXISTS_NOT_ENFORCED,
  FIRST,
  LINTER,
  PROVED,
  RULE,
  SECOND,
  STALE,
  WHOLE,
  violationsOf,
  withFirst,
} from "./audit-report-facts.js";

const SHAPE = expect.objectContaining({ rule: RULE.shape });

describe("the report's shape", () => {
  it.each([
    { name: "a list", report: [] },
    { name: "text", report: "report" },
    { name: "nothing", report: null },
  ])("refuses $name", ({ report }) => {
    expect(violationsOf(report)).toEqual([SHAPE]);
  });

  it.each([
    { name: "a version it does not know", change: { schema_version: 2 } },
    { name: "a section it does not know", change: { verdict: "pass" } },
    { name: "parts that are not a list", change: { scopes: "." } },
    { name: "a part that is not text", change: { scopes: [WHOLE, 7] } },
    { name: "findings that are not a list", change: { findings: {} } },
  ])("refuses $name", ({ change }) => {
    expect(violationsOf({ ...completeAuditReport(), ...change })).toEqual([
      SHAPE,
    ]);
  });

  it.each([
    { name: "a state outside the six", change: { state: "passing" } },
    { name: "a field it does not know", change: { verdict: "pass" } },
    { name: "a plain-language field that is not text", change: { why: 3 } },
    { name: "mechanisms that are not a list", change: { mechanisms: null } },
    { name: "an empty evidence record id", change: { evidence_id: "" } },
    {
      name: "a mechanism with no tool",
      change: { mechanisms: [{ ...LINTER, tool: "" }] },
    },
    {
      name: "a mechanism at a moment that does not exist",
      change: { mechanisms: [{ ...LINTER, moment: "whenever" }] },
    },
    {
      name: "a mechanism that runs at a moment but names no command",
      change: { mechanisms: [{ ...LINTER, moment: "commit" }] },
    },
    {
      name: "a mechanism with a field it does not know",
      change: { mechanisms: [{ ...LINTER, owner: "team" }] },
    },
    {
      name: "a pointer whose line is not a whole number from 1",
      change: {
        mechanisms: [{ ...LINTER, locators: [{ path: "ruff.toml", line: 0 }] }],
      },
    },
    {
      name: "a pointer with no path",
      change: { mechanisms: [{ ...LINTER, locators: [{ line: 1 }] }] },
    },
  ])("refuses a finding with $name, naming the finding", ({ change }) => {
    const [violation, ...rest] = violationsOf(withFirst(change));

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.shape,
      criterion: FIRST,
      scope: WHOLE,
    });
  });

  it("locates a finding with no criterion by its place in the list", () => {
    const report = completeAuditReport();
    const [first, ...others] = report.findings;
    const nameless = {
      ...report,
      findings: [{ ...first, criterion: 7 }, ...others],
    };

    const [violation, ...rest] = violationsOf(nameless);

    expect(rest).toEqual([]);
    expect(violation?.criterion).toBeUndefined();
    expect(violation?.message).toContain("Finding number 1 in the list");
  });

  it("reports every shape problem at once", () => {
    expect(
      violationsOf(
        withFirst({ state: "passing", why: 3, mechanisms: null })
      ).map(violation => violation.field)
    ).toEqual(["why", "state", "mechanisms"]);
  });

  it.each(["pre-deploy:production", "continuous", "pull-request", "pre-tool"])(
    "accepts a mechanism that runs at %s",
    moment => {
      expect(
        violationsOf(
          withFirst({
            state: EXISTS_NOT_ENFORCED,
            mechanisms: [{ ...LINTER, command: "ruff check .", moment }],
          })
        )
      ).toEqual([]);
    }
  );

  it("accepts a tool that is configured with a command nothing runs", () => {
    expect(
      violationsOf(
        withFirst({
          state: EXISTS_NOT_ENFORCED,
          mechanisms: [{ ...LINTER, command: "ruff check ." }],
        })
      )
    ).toEqual([]);
  });
});

describe("the report's sections", () => {
  it("are schema_version, scopes and findings", () => {
    expect(AUDIT_REPORT_SECTIONS.map(section => section.key)).toEqual([
      "schema_version",
      "scopes",
      "findings",
    ]);
  });

  it("take a new section as one more entry", () => {
    const withNotes = { ...completeAuditReport(), notes: ["checked by hand"] };
    const sections = [
      ...AUDIT_REPORT_SECTIONS,
      {
        key: "notes",
        parse: (value: unknown) => ({ value: value ?? [], violations: [] }),
      },
    ];

    expect(parseAuditReport(withNotes).violations).toEqual([SHAPE]);
    expect(parseAuditReport(withNotes, sections)).toMatchObject({
      report: { notes: ["checked by hand"] },
      violations: [],
    });
    expect(parseAuditReport(completeAuditReport(), sections)).toMatchObject({
      report: { notes: [] },
    });
  });
});

describe("how a violation reads", () => {
  const broken = [
    withFirst({ why: "" }),
    withFirst({ next: "Read AC5.1." }),
    withFirst({ state: PROVED, mechanisms: [LINTER] }),
    withFirst({ state: PROVED, evidence_id: STALE.id, mechanisms: [LINTER] }),
    withFirst({ state: EXISTS_NOT_ENFORCED }),
    withFirst({ state: "passing" }),
    dropFinding(completeAuditReport(), AT_FIRST),
    completeAuditReport([API]),
    { ...completeAuditReport(), findings: [sampleFinding("AC99.9", WHOLE)] },
  ];

  it("is one line", () => {
    broken
      .flatMap(report => violationsOf(report))
      .forEach(violation => {
        expect(formatAuditReportViolation(violation)).not.toContain("\n");
      });
  });

  it("stays one line when the report's own text has line breaks in it", () => {
    const [violation] = violationsOf(
      completeAuditReport([WHOLE, "missing\nfolder"])
    );

    expect(violation && formatAuditReportViolation(violation)).toMatch(
      /\(folder missing folder\)$/u
    );
  });

  it("keeps criterion ids out of the sentence and in the locator", () => {
    const violations = broken.flatMap(report => violationsOf(report));

    expect(violations.length).toBeGreaterThanOrEqual(broken.length);
    violations.forEach(violation => {
      expect(criterionIdsIn(violation.message)).toEqual([]);
    });
  });

  it("ends with where to look: the requirement and the folder", () => {
    const [violation] = violationsOf(
      amendFinding(
        completeAuditReport([WHOLE, API]),
        { criterion: SECOND, scope: API },
        { why: "" }
      )
    );

    expect(violation && formatAuditReportViolation(violation)).toMatch(
      new RegExp(String.raw`\(requirement ${SECOND}, folder api\)$`, "u")
    );
  });

  it("calls the scope '.' the whole repository", () => {
    const [violation] = violationsOf(withFirst({ why: "" }));

    expect(violation && formatAuditReportViolation(violation)).toMatch(
      new RegExp(String.raw`\(requirement ${FIRST}, whole repository\)$`, "u")
    );
  });
});

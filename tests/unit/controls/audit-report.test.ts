/**
 * What a valid audit report is.
 *
 * The audit is written by an agent, so code has to check it before anyone
 * relies on it. These cases pin the report's fixed names, what a complete
 * report looks like, the rule that every requirement is placed exactly once in
 * every part, and how the rule list is extended. The rules about a single
 * finding and the report's shape have suites of their own
 * (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_FINDING_STATES,
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  AUDIT_REPORT_RULES,
  PLAIN_LANGUAGE_FIELDS,
  validateAuditReport,
  type AuditReportRule,
} from "../../../src/controls/audit-report.js";
import { loadCriterionCatalogue } from "../../../src/controls/catalogue.js";
import {
  completeAuditReport,
  dropFinding,
  sampleFinding,
} from "../../helpers/control-audit-report.js";
import {
  API,
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FIRST,
  FRESH,
  LINTER,
  PROVED,
  RULE,
  SECOND,
  WHOLE,
  context,
  violationsOf,
  withFirst,
} from "./audit-report-facts.js";

describe("the audit report's fixed names", () => {
  it("uses the shared report paths", () => {
    expect(AUDIT_REPORT_JSON_PATH).toBe(".lisa/audit/report.json");
    expect(AUDIT_REPORT_MARKDOWN_PATH).toBe(".lisa/audit/report.md");
  });

  it("knows exactly the six states a criterion can be in", () => {
    expect([...AUDIT_FINDING_STATES]).toEqual([
      PROVED,
      EXISTS_NOT_ENFORCED,
      "missing",
      "not-applicable",
      "unknown",
      "question",
    ]);
  });

  it("names the three plain-language fields", () => {
    expect([...PLAIN_LANGUAGE_FIELDS]).toEqual(["what", "why", "next"]);
  });
});

describe("a complete report", () => {
  it("passes with one finding per in-scope criterion", () => {
    const { report, violations } = validateAuditReport(
      completeAuditReport(),
      context()
    );

    expect(violations).toEqual([]);
    expect(report?.findings).toHaveLength(CRITERIA.length);
  });

  it("passes with one finding per in-scope criterion for each part", () => {
    const { report, violations } = validateAuditReport(
      completeAuditReport([WHOLE, API, "web"]),
      context()
    );

    expect(violations).toEqual([]);
    expect(report?.findings).toHaveLength(CRITERIA.length * 3);
  });

  it.each(
    AUDIT_FINDING_STATES.filter(
      state => state !== PROVED && state !== EXISTS_NOT_ENFORCED
    )
  )("accepts the state %s with no mechanism", state => {
    expect(violationsOf(withFirst({ state }))).toEqual([]);
  });

  it("accepts a control that exists but is not enforced, with a pointer", () => {
    expect(
      violationsOf(
        withFirst({ state: EXISTS_NOT_ENFORCED, mechanisms: [LINTER] })
      )
    ).toEqual([]);
  });

  it("accepts proved when fresh evidence for that criterion backs it", () => {
    expect(
      violationsOf(
        withFirst({
          state: PROVED,
          evidence_id: FRESH.id,
          mechanisms: [
            { ...LINTER, command: "ruff check .", moment: "commit" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("returns no report when the candidate is refused", () => {
    expect(
      validateAuditReport(withFirst({ why: "" }), context()).report
    ).toBeNull();
  });
});

describe("every in-scope criterion exactly once per part", () => {
  it("names a criterion with no finding", () => {
    const [violation, ...rest] = violationsOf(
      dropFinding(completeAuditReport([WHOLE, API]), {
        criterion: SECOND,
        scope: API,
      })
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.coverage,
      criterion: SECOND,
      scope: API,
    });
  });

  it("names a criterion placed in two states", () => {
    const report = completeAuditReport();
    const twice = {
      ...report,
      findings: [
        ...report.findings,
        { ...sampleFinding(FIRST, WHOLE), state: "unknown" },
      ],
    };

    expect(violationsOf(twice)).toEqual([
      expect.objectContaining({ rule: RULE.coverage, criterion: FIRST }),
    ]);
  });

  it.each([
    { name: "an id the catalogue does not hold", criterion: "AC99.9" },
    {
      name: "a criterion the catalogue leaves out of Level 1",
      criterion:
        loadCriterionCatalogue().criteria.find(entry => !entry.in_scope)?.id ??
        "",
    },
  ])("refuses a finding for $name", ({ criterion }) => {
    const report = completeAuditReport();
    const extra = {
      ...report,
      findings: [...report.findings, sampleFinding(criterion, WHOLE)],
    };

    expect(criterion).not.toBe("");
    expect(violationsOf(extra)).toEqual([
      expect.objectContaining({
        rule: RULE.coverage,
        criterion,
        scope: WHOLE,
      }),
    ]);
  });

  it("refuses a finding filed under a part the report does not list", () => {
    const report = completeAuditReport();
    const stray = {
      ...report,
      findings: [...report.findings, sampleFinding(FIRST, API)],
    };

    expect(violationsOf(stray)).toEqual([
      expect.objectContaining({
        rule: RULE.coverage,
        criterion: FIRST,
        scope: API,
      }),
    ]);
  });

  it("says once that a listed part has no findings at all", () => {
    const report = { ...completeAuditReport(), scopes: [WHOLE, API] };

    expect(violationsOf(report)).toEqual([
      expect.objectContaining({ rule: RULE.coverage, scope: API }),
    ]);
    expect(violationsOf(report)[0]?.criterion).toBeUndefined();
  });
});

describe("the parts a report covers", () => {
  it("requires the whole repository to be one of them", () => {
    expect(violationsOf(completeAuditReport([API]))).toEqual([
      expect.objectContaining({ rule: RULE.scopes }),
    ]);
  });

  it("refuses a part listed twice", () => {
    const report = { ...completeAuditReport(), scopes: [WHOLE, WHOLE] };

    expect(violationsOf(report)).toEqual([
      expect.objectContaining({ rule: RULE.scopes, scope: WHOLE }),
    ]);
  });

  it.each(["missing-folder", "../outside", "/tmp", "api/", "./api", ""])(
    "refuses the part %j: it is not a folder path inside the repository",
    scope => {
      expect(violationsOf(completeAuditReport([WHOLE, scope]))).toEqual([
        expect.objectContaining({ rule: RULE.scopes, scope }),
      ]);
    }
  );
});

describe("the rule list", () => {
  it("is a list of independent functions", () => {
    expect(AUDIT_REPORT_RULES.length).toBeGreaterThanOrEqual(5);
    AUDIT_REPORT_RULES.forEach(rule => {
      expect(typeof rule).toBe("function");
    });
  });

  it("runs every rule, so one report can break several at once", () => {
    const rules = violationsOf(
      withFirst({ state: PROVED, why: "", mechanisms: [] })
    ).map(violation => violation.rule);

    expect(new Set(rules)).toEqual(
      new Set([RULE.plainLanguage, RULE.provedEvidence, RULE.locators])
    );
  });

  it("takes a new rule as one more entry", () => {
    const always: AuditReportRule = report => [
      { rule: "example", message: `Saw ${report.findings.length} findings.` },
    ];

    expect(
      validateAuditReport(completeAuditReport(), context(), [
        ...AUDIT_REPORT_RULES,
        always,
      ]).violations
    ).toEqual([
      { rule: "example", message: `Saw ${CRITERIA.length} findings.` },
    ]);
  });
});

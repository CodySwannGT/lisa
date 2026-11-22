/**
 * What a valid audit report is.
 *
 * The audit is written by an agent, so code has to check it before anyone
 * relies on it. These cases pin the report's fixed names, what a complete
 * report looks like, the findings that belong to no count, and how the rule
 * list is extended. Where each requirement must be answered has a suite of its
 * own (`audit-report-coverage.test.ts`), as have the rules about a single
 * finding and the report's shape (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_FINDING_STATES,
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  AUDIT_REPORT_RULES,
  NOT_APPLICABLE_STATE,
  PLAIN_LANGUAGE_FIELDS,
  validateAuditReport,
  type AuditReportRule,
} from "../../../src/controls/audit-report.js";
import {
  NEVER_NOT_APPLICABLE,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import {
  amendFinding,
  completeAuditReport,
  sampleFinding,
} from "../../helpers/control-audit-report.js";
import {
  API,
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FRESH,
  LINTER,
  PART_FIRST,
  PER_PART,
  PROVED,
  REPOSITORY_WIDE,
  RULE,
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

  it("passes with each requirement filed where the catalogue says it is answered", () => {
    const { report, violations } = validateAuditReport(
      completeAuditReport([WHOLE, API, "web"]),
      context()
    );

    expect(violations).toEqual([]);
    expect(report?.findings).toHaveLength(
      REPOSITORY_WIDE.length + PER_PART.length * 2
    );
  });

  it.each(
    AUDIT_FINDING_STATES.filter(
      state =>
        state !== PROVED &&
        state !== EXISTS_NOT_ENFORCED &&
        state !== NOT_APPLICABLE_STATE
    )
  )("accepts the state %s with no mechanism", state => {
    expect(violationsOf(withFirst({ state }))).toEqual([]);
  });

  it("accepts the state not-applicable with no mechanism, for a requirement that may not apply", () => {
    const conditional = REPOSITORY_WIDE.find(
      criterion => criterion.not_applicable_when !== NEVER_NOT_APPLICABLE
    );

    expect(conditional).toBeDefined();
    expect(
      violationsOf(
        amendFinding(
          completeAuditReport(),
          { criterion: conditional?.id ?? "", scope: WHOLE },
          { state: NOT_APPLICABLE_STATE }
        )
      )
    ).toEqual([]);
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

describe("a finding that belongs to no count", () => {
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
      findings: [...report.findings, sampleFinding(PART_FIRST, API)],
    };

    expect(violationsOf(stray)).toEqual([
      expect.objectContaining({
        rule: RULE.coverage,
        criterion: PART_FIRST,
        scope: API,
        message: expect.stringContaining(
          `has a finding under the folder api, which the report's "scopes" list does not include`
        ),
      }),
    ]);
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

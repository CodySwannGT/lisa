/**
 * A finding may say a requirement does not apply only where the catalogue
 * allows that it might not.
 *
 * The catalogue gives every in-scope requirement the one condition under
 * which it does not apply, and for about half of them that condition is
 * `never`. A report that files such a requirement as not applicable is
 * refused, so a report cannot reach "nothing applies here" by saying so. For
 * the rest the judgement stays the audit's, and the check says how many
 * findings were filed that way so a reader sees it (CodySwannGT/lisa#4978).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_MARKDOWN_PATH,
  formatAuditReportViolation,
} from "../../../src/controls/audit-report.js";
import { NEVER_NOT_APPLICABLE } from "../../../src/controls/catalogue.js";
import {
  amendFinding,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import { CRITERIA, WHOLE, violationsOf } from "./audit-report-facts.js";
import { checkOnFNone, removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const RULE = "not-applicable";
const NOT_APPLICABLE = "not-applicable";
const FACT = "This repository builds a library and has no screen.";

/** The requirements that always apply, and the ones that may not. */
const ALWAYS = CRITERIA.filter(
  criterion => criterion.not_applicable_when === NEVER_NOT_APPLICABLE
);
const CONDITIONAL = CRITERIA.filter(
  criterion => criterion.not_applicable_when !== NEVER_NOT_APPLICABLE
);

/**
 * The complete report with the named requirements filed as not applicable.
 * @param ids - The requirements to file that way
 * @returns The report
 */
function notApplicable(ids: readonly string[]): SampleReport {
  return ids.reduce<SampleReport>(
    (report, criterion) =>
      amendFinding(
        report,
        { criterion, scope: WHOLE },
        { state: NOT_APPLICABLE, what: FACT }
      ),
    completeAuditReport()
  );
}

describe("a requirement that always applies", () => {
  it("has some in the shipped catalogue, and some that may not apply", () => {
    expect(ALWAYS.length).toBeGreaterThan(0);
    expect(CONDITIONAL.length).toBeGreaterThan(0);
  });

  it("cannot be filed as not applicable", () => {
    const [always] = ALWAYS;
    const [violation, ...rest] = violationsOf(
      notApplicable([always?.id ?? ""])
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE,
      criterion: always?.id,
      scope: WHOLE,
      field: "state",
    });
    expect(violation && formatAuditReportViolation(violation)).toBe(
      `This finding says the requirement does not apply here, but this requirement always applies: nothing about a repository makes it not apply. Say what was found instead: "missing" when nothing does it, "exists-not-enforced" when something does, "unknown" or "question" when that cannot be told. (requirement ${always?.id ?? ""}, whole repository)`
    );
  });

  it("is refused once for every such requirement in a report that says nothing applies", () => {
    const violations = violationsOf(
      notApplicable(CRITERIA.map(criterion => criterion.id))
    );

    expect(violations.map(violation => violation.rule)).toEqual(
      ALWAYS.map(() => RULE)
    );
    expect(violations.map(violation => violation.criterion)).toEqual(
      ALWAYS.map(criterion => criterion.id)
    );
  });
});

describe("a requirement that may not apply", () => {
  it("can be filed as not applicable, with the fact that makes it so", () => {
    expect(
      violationsOf(notApplicable(CONDITIONAL.map(criterion => criterion.id)))
    ).toEqual([]);
  });
});

describe("what the check prints", () => {
  it("refuses a report that says nothing applies, and writes no readable report", async () => {
    const run = await checkOnFNone(
      notApplicable(CRITERIA.map(criterion => criterion.id))
    );

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toContain(
      `report-check: FAIL. ${ALWAYS.length} problems`
    );
  });

  it("counts the findings filed as not applicable on the line that says it passed", async () => {
    const filed = CONDITIONAL.slice(0, 3).map(criterion => criterion.id);

    const run = await checkOnFNone(notApplicable(filed));

    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([
      `report-check: PASS. ${CRITERIA.length} findings across 1 part, 3 filed as not applicable; wrote ${AUDIT_REPORT_MARKDOWN_PATH}`,
    ]);
  });

  it("says so when no finding was filed as not applicable", async () => {
    const run = await checkOnFNone(completeAuditReport());

    expect(run.stdout).toEqual([
      `report-check: PASS. ${CRITERIA.length} findings across 1 part, 0 filed as not applicable; wrote ${AUDIT_REPORT_MARKDOWN_PATH}`,
    ]);
  });
});

/**
 * Where a report must answer each requirement, and how often.
 *
 * The catalogue says whether a requirement has one answer for the whole
 * repository or one for each part. The report check holds a report to that:
 * a repository-wide requirement appears once, under the whole repository, and
 * a per-part requirement appears once under every folder the report lists.
 * Before the catalogue said which was which, a report had to carry every
 * requirement in every part, most of them as filler pointing somewhere else,
 * and two audits of one repository split the requirements differently
 * (CodySwannGT/lisa#5007).
 *
 * A refusal is read by an operator who may not code, so each case also pins
 * what the line names: the requirement by its plain question, the part in
 * words, and which of the two placements was broken.
 */
import { describe, expect, it } from "vitest";

import {
  formatAuditReportViolation,
  validateAuditReport,
} from "../../../src/controls/audit-report.js";
import { criterionIdsIn } from "../../../src/controls/catalogue.js";
import {
  completeAuditReport,
  dropFinding,
  sampleFinding,
  type SampleFinding,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  CRITERIA,
  FIRST,
  PART_FIRST,
  PER_PART,
  REPOSITORY_WIDE,
  RULE,
  WHOLE,
  context,
  violationsOf,
} from "./audit-report-facts.js";

const WEB = "web";
const TWO_PARTS = [WHOLE, API, WEB];

/** The plain question of a criterion, as the catalogue asks it. */
const QUESTION = Object.fromEntries(
  CRITERIA.map(criterion => [criterion.id, criterion.question])
);

/**
 * A report with findings added to it.
 * @param report - The report to start from
 * @param extra - The findings to add
 * @returns A new report
 */
function withFindings(
  report: SampleReport,
  ...extra: readonly SampleFinding[]
): SampleReport {
  return { ...report, findings: [...report.findings, ...extra] };
}

/**
 * The lines the report check would print for a report.
 * @param report - Candidate report
 * @returns One line per violation
 */
function linesOf(report: unknown): readonly string[] {
  return violationsOf(report).map(violation =>
    formatAuditReportViolation(violation)
  );
}

describe("the requirements under test", () => {
  it("include some answered once and some answered per part", () => {
    expect(REPOSITORY_WIDE.length).toBeGreaterThan(0);
    expect(PER_PART.length).toBeGreaterThan(0);
    expect(REPOSITORY_WIDE.length + PER_PART.length).toBe(CRITERIA.length);
    expect(REPOSITORY_WIDE.map(criterion => criterion.id)).toContain(FIRST);
  });
});

describe("a report whose only part is the whole repository", () => {
  it("passes with exactly one finding for every in-scope requirement", () => {
    const { report, violations } = validateAuditReport(
      completeAuditReport(),
      context()
    );

    expect(violations).toEqual([]);
    expect(report?.findings).toHaveLength(CRITERIA.length);
    expect(new Set(report?.findings.map(finding => finding.scope))).toEqual(
      new Set([WHOLE])
    );
  });

  it("names a per-part requirement that has no finding, and says where it goes", () => {
    const lines = linesOf(
      dropFinding(completeAuditReport(), {
        criterion: PART_FIRST,
        scope: WHOLE,
      })
    );

    expect(lines).toEqual([
      `No finding answers "${QUESTION[PART_FIRST]}". The report lists no folders, so this requirement is answered once, for the whole repository: add one finding for it with the scope ".". (requirement ${PART_FIRST}, whole repository)`,
    ]);
  });

  it("names a requirement placed in two states", () => {
    const twice = withFindings(completeAuditReport(), {
      ...sampleFinding(FIRST, WHOLE),
      state: "unknown",
    });

    expect(linesOf(twice)).toEqual([
      `2 findings answer "${QUESTION[FIRST]}" for the whole repository, so it is in more than one state. Keep exactly one. (requirement ${FIRST}, whole repository)`,
    ]);
  });
});

describe("a report for a repository with the parts api and web", () => {
  it("passes with the repository-wide requirements once and the per-part ones once per folder", () => {
    const sample = completeAuditReport(TWO_PARTS);
    const { report, violations } = validateAuditReport(sample, context());

    expect(violations).toEqual([]);
    expect(report?.findings).toHaveLength(
      REPOSITORY_WIDE.length + PER_PART.length * 2
    );
    expect(sample.findings).toHaveLength(
      REPOSITORY_WIDE.length + PER_PART.length * 2
    );
  });

  it("carries no filler: nothing repository-wide in a folder, nothing per-part under the whole repository", () => {
    const { findings } = completeAuditReport(TWO_PARTS);
    const inScope = (scope: string): readonly string[] =>
      findings
        .filter(finding => finding.scope === scope)
        .map(finding => String(finding.criterion));

    expect(inScope(WHOLE)).toEqual(REPOSITORY_WIDE.map(({ id }) => id));
    expect(inScope(API)).toEqual(PER_PART.map(({ id }) => id));
    expect(inScope(WEB)).toEqual(PER_PART.map(({ id }) => id));
  });

  it("refuses a repository-wide requirement that also has a finding in the api part", () => {
    const [violation, ...rest] = violationsOf(
      withFindings(completeAuditReport(TWO_PARTS), sampleFinding(FIRST, API))
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.coverage,
      criterion: FIRST,
      scope: API,
      field: "scope",
    });
    expect(violation && formatAuditReportViolation(violation)).toBe(
      `"${QUESTION[FIRST]}" is answered once, for the whole repository, but this finding files it under the folder api. Move what it says into the finding for the whole repository (scope "."), and remove this one. (requirement ${FIRST}, folder api)`
    );
  });

  it("refuses a repository-wide requirement answered only in the api part, and asks for it once for the repository", () => {
    const moved = withFindings(
      dropFinding(completeAuditReport(TWO_PARTS), {
        criterion: FIRST,
        scope: WHOLE,
      }),
      sampleFinding(FIRST, API)
    );

    expect(violationsOf(moved)).toEqual([
      expect.objectContaining({ criterion: FIRST, scope: API }),
      expect.objectContaining({ criterion: FIRST, scope: WHOLE }),
    ]);
    expect(linesOf(moved)[1]).toBe(
      `No finding answers "${QUESTION[FIRST]}" for the whole repository. This requirement is answered once, for the whole repository, so add one finding for it with the scope ".". (requirement ${FIRST}, whole repository)`
    );
  });

  it("tells a repository-wide finding under an unlisted folder to move, not to list the folder", () => {
    const stray = withFindings(
      completeAuditReport(),
      sampleFinding(FIRST, API)
    );

    expect(linesOf(stray)).toEqual([
      expect.stringContaining(
        `is answered once, for the whole repository, but this finding files it under the folder api.`
      ),
    ]);
  });

  it("refuses a per-part requirement that has a finding for api and none for web", () => {
    const [violation, ...rest] = violationsOf(
      dropFinding(completeAuditReport(TWO_PARTS), {
        criterion: PART_FIRST,
        scope: WEB,
      })
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.coverage,
      criterion: PART_FIRST,
      scope: WEB,
    });
    expect(violation && formatAuditReportViolation(violation)).toBe(
      `No finding answers "${QUESTION[PART_FIRST]}" for the folder web. This requirement is answered once for each folder the report lists, so add one finding for it with the scope "web". (requirement ${PART_FIRST}, folder web)`
    );
  });

  it("refuses a per-part requirement filed under the whole repository", () => {
    const [violation, ...rest] = violationsOf(
      withFindings(
        completeAuditReport(TWO_PARTS),
        sampleFinding(PART_FIRST, WHOLE)
      )
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.coverage,
      criterion: PART_FIRST,
      scope: WHOLE,
      field: "scope",
    });
    expect(violation && formatAuditReportViolation(violation)).toBe(
      `"${QUESTION[PART_FIRST]}" is answered once for each folder the report lists, but this finding files it under the whole repository. Give each folder its own finding for it, and remove this one. (requirement ${PART_FIRST}, whole repository)`
    );
  });

  it("names a per-part requirement placed in two states in one folder", () => {
    const twice = withFindings(completeAuditReport(TWO_PARTS), {
      ...sampleFinding(PART_FIRST, API),
      state: "unknown",
    });

    expect(linesOf(twice)).toEqual([
      `2 findings answer "${QUESTION[PART_FIRST]}" for the folder api, so it is in more than one state. Keep exactly one. (requirement ${PART_FIRST}, folder api)`,
    ]);
  });

  it("says once that a listed folder has no findings at all", () => {
    const complete = completeAuditReport(TWO_PARTS);
    const report = {
      ...complete,
      findings: complete.findings.filter(finding => finding.scope !== WEB),
    };

    expect(linesOf(report)).toEqual([
      `The report lists the folder web but has no findings for it. Add one finding for every requirement that is answered folder by folder, or take the folder off the "scopes" list. (folder web)`,
    ]);
    expect(violationsOf(report)[0]?.criterion).toBeUndefined();
  });

  it("says once that the whole repository has no findings at all", () => {
    const complete = completeAuditReport(TWO_PARTS);
    const report = {
      ...complete,
      findings: complete.findings.filter(finding => finding.scope !== WHOLE),
    };

    expect(linesOf(report)).toEqual([
      `The report has no findings for the whole repository. Add one finding, with the scope ".", for every requirement that is answered once for the repository. (whole repository)`,
    ]);
  });
});

describe("how a coverage refusal reads", () => {
  const broken = [
    withFindings(completeAuditReport(TWO_PARTS), sampleFinding(FIRST, API)),
    withFindings(
      completeAuditReport(TWO_PARTS),
      sampleFinding(PART_FIRST, WHOLE)
    ),
    dropFinding(completeAuditReport(TWO_PARTS), {
      criterion: PART_FIRST,
      scope: WEB,
    }),
    dropFinding(completeAuditReport(TWO_PARTS), {
      criterion: FIRST,
      scope: WHOLE,
    }),
  ];

  it("keeps the requirement's id out of the sentence and names it by its question", () => {
    const violations = broken.flatMap(report => violationsOf(report));

    expect(violations).toHaveLength(broken.length);
    violations.forEach(violation => {
      expect(criterionIdsIn(violation.message)).toEqual([]);
      expect(violation.message).toContain(
        `"${QUESTION[violation.criterion ?? ""]}"`
      );
    });
  });

  it("names the part in words and never as a bare path", () => {
    broken
      .flatMap(report => violationsOf(report))
      .forEach(violation => {
        expect(violation.message).toMatch(
          /the whole repository|the folder (?:api|web)/u
        );
      });
  });
});

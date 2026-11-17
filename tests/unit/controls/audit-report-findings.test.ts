/**
 * The rules about a single finding of an audit report.
 *
 * Three things are checked on each finding: its three plain-language fields
 * are filled in and free of criterion ids; it says `proved` only when fresh
 * evidence for its own criterion backs it; and every file-and-line pointer it
 * gives leads to a line that exists (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  PLAIN_LANGUAGE_FIELDS,
  formatAuditReportViolation,
  validateAuditReport,
} from "../../../src/controls/audit-report.js";
import type { SampleReport } from "../../helpers/control-audit-report.js";
import {
  EXISTS_NOT_ENFORCED,
  FIRST,
  FRESH,
  LINTER,
  OTHER,
  PROVED,
  RULE,
  STALE,
  WHOLE,
  context,
  violationsOf,
  withFirst,
} from "./audit-report-facts.js";

const RUFF_TOML = "ruff.toml";

/**
 * The first finding, claiming a control exists and pointing at one place.
 * @param path - The file it points at
 * @param line - The line it points at
 * @returns The report
 */
function pointingAt(path: string, line: number): SampleReport {
  return withFirst({
    state: EXISTS_NOT_ENFORCED,
    mechanisms: [{ ...LINTER, locators: [{ path, line }] }],
  });
}

describe("the three plain-language fields", () => {
  it.each(
    PLAIN_LANGUAGE_FIELDS.flatMap(field =>
      ["", "   \n"].map(text => ({ field, text }))
    )
  )("refuses an empty $field field ($text)", ({ field, text }) => {
    const [violation, ...rest] = violationsOf(withFirst({ [field]: text }));

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.plainLanguage,
      criterion: FIRST,
      scope: WHOLE,
      field,
    });
    expect(violation && formatAuditReportViolation(violation)).toContain(
      `"${field}"`
    );
  });

  it.each(
    PLAIN_LANGUAGE_FIELDS.flatMap(field =>
      ["AC5.1", "SI2", "DP1", "UX4"].map(id => ({ field, id }))
    )
  )("refuses the criterion id $id inside $field", ({ field, id }) => {
    const [violation, ...rest] = violationsOf(
      withFirst({ [field]: `This is what ${id} asks for.` })
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.plainLanguage,
      criterion: FIRST,
      field,
    });
  });

  it("reports each broken field of one finding on its own line", () => {
    expect(
      violationsOf(withFirst({ what: "", why: "See AC1.1.", next: " " })).map(
        violation => violation.field
      )
    ).toEqual([...PLAIN_LANGUAGE_FIELDS]);
  });
});

describe("proved is never accepted on presence alone", () => {
  const located = { state: PROVED, mechanisms: [LINTER] };

  it.each([
    { name: "no evidence record id", change: {} },
    { name: "an id no record has", change: { evidence_id: "ev-absent" } },
    {
      name: "a record for another criterion",
      change: { evidence_id: OTHER.id },
    },
    { name: "a record past its lifetime", change: { evidence_id: STALE.id } },
  ])("refuses proved with $name", ({ change }) => {
    const [violation, ...rest] = violationsOf(
      withFirst({ ...located, ...change })
    );

    expect(rest).toEqual([]);
    expect(violation).toMatchObject({
      rule: RULE.provedEvidence,
      criterion: FIRST,
      scope: WHOLE,
    });
    expect(violation && formatAuditReportViolation(violation)).toContain(FIRST);
  });

  it("refuses proved when there is no evidence file at all", () => {
    const { violations } = validateAuditReport(
      withFirst({ ...located, evidence_id: FRESH.id }),
      context({ evidence: [] })
    );

    expect(violations).toEqual([
      expect.objectContaining({
        rule: RULE.provedEvidence,
        criterion: FIRST,
      }),
    ]);
  });

  it("uses the time it is given, so staleness can be tested", () => {
    const report = withFirst({ ...located, evidence_id: FRESH.id });
    const later = new Date("2026-11-19T12:00:00.000Z");

    expect(validateAuditReport(report, context()).violations).toEqual([]);
    expect(
      validateAuditReport(report, context({ now: later })).violations
    ).toEqual([expect.objectContaining({ rule: RULE.provedEvidence })]);
  });

  it("refuses a record dated after the current time", () => {
    const report = withFirst({ ...located, evidence_id: FRESH.id });
    const earlier = new Date("2026-11-17T10:00:00.000Z");

    expect(
      validateAuditReport(report, context({ now: earlier })).violations
    ).toEqual([expect.objectContaining({ rule: RULE.provedEvidence })]);
  });
});

describe("a claim that a control exists points at a real line", () => {
  it.each([PROVED, EXISTS_NOT_ENFORCED])(
    "refuses %s with nothing to point at",
    state => {
      expect(
        violationsOf(
          withFirst({ state, evidence_id: FRESH.id, mechanisms: [] })
        )
      ).toEqual([
        expect.objectContaining({
          rule: RULE.locators,
          criterion: FIRST,
          scope: WHOLE,
        }),
      ]);
    }
  );

  it("refuses a mechanism that lists no pointer", () => {
    expect(
      violationsOf(
        withFirst({
          state: EXISTS_NOT_ENFORCED,
          mechanisms: [{ ...LINTER, locators: [] }],
        })
      )
    ).toEqual([expect.objectContaining({ rule: RULE.locators })]);
  });

  it.each([
    { name: "a file that does not exist", path: "nope.toml", line: 1 },
    { name: "a line past the end of the file", path: RUFF_TOML, line: 6 },
    { name: "a path outside the repository", path: "../ruff.toml", line: 1 },
  ])("refuses a pointer to $name", ({ path, line }) => {
    expect(violationsOf(pointingAt(path, line))).toEqual([
      expect.objectContaining({ rule: RULE.locators, criterion: FIRST }),
    ]);
  });

  it("checks pointers on a finding in any state", () => {
    expect(
      violationsOf(
        withFirst({
          state: "unknown",
          mechanisms: [
            { ...LINTER, locators: [{ path: "nope.toml", line: 1 }] },
          ],
        })
      )
    ).toEqual([expect.objectContaining({ rule: RULE.locators })]);
  });

  it("accepts the last line of a file", () => {
    expect(violationsOf(pointingAt(RUFF_TOML, 5))).toEqual([]);
  });
});

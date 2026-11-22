/**
 * What the readable report says about the outside systems the audit could not
 * read.
 *
 * An operator who is told a requirement "could not be checked" needs to know
 * which system would not answer, what it said, and what access to arrange.
 * The report says that once, in one short section, in plain words
 * (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import {
  UNREACHED_HEADING,
  unreachedSection,
} from "../../../src/controls/audit-probes-markdown.js";
import { renderAuditReportMarkdown } from "../../../src/controls/audit-report-markdown.js";
import {
  validateAuditReport,
  type AuditReport,
} from "../../../src/controls/audit-report.js";
import { criterionIdsIn } from "../../../src/controls/catalogue.js";
import {
  AUTHORITY,
  PLATFORM,
  PLATFORM_ACCESS,
  PLATFORM_REQUEST,
  PLATFORM_SYSTEM,
  SIGNED_OUT_ERROR,
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
} from "../../helpers/audit-probes.js";
import {
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  CRITERIA,
  PART_FIRST,
  WHOLE,
  context,
} from "./audit-report-facts.js";

const MIXED = [WHOLE, API, "web"];
const AUTHORITY_QUESTION =
  CRITERIA.find(criterion => criterion.id === AUTHORITY.criterion)?.question ??
  "";
const PART_QUESTION =
  CRITERIA.find(criterion => criterion.id === PART_FIRST)?.question ?? "";

/**
 * Validate a sample so the renderer is given what the command gives it.
 * @param sample - Candidate report
 * @returns The validated report
 */
function validated(sample: SampleReport): AuditReport {
  const { report, violations } = validateAuditReport(sample, context());
  if (report === null) {
    throw new Error(`sample report is invalid: ${JSON.stringify(violations)}`);
  }
  return report;
}

/**
 * Render the section for a sample report.
 * @param sample - Candidate report
 * @returns The section's lines
 */
function section(sample: SampleReport): readonly string[] {
  return unreachedSection(validated(sample), CRITERIA);
}

const UNREACHED = withProbes(waitingOn(completeAuditReport()), [
  unreachableProbe(),
]);

describe("the section on what could not be reached", () => {
  it("is absent when nothing was probed, and when everything answered", () => {
    expect(section(completeAuditReport())).toEqual([]);
    expect(
      section(withProbes(completeAuditReport(), [reachableProbe()]))
    ).toEqual([]);
  });

  it("says which system did not answer, what it said, what was tried and what access is needed", () => {
    expect(section(UNREACHED)).toEqual([
      UNREACHED_HEADING,
      "",
      `Before answering, Lisa tries one harmless read of each outside system a requirement depends on. The ones below did not answer, so every requirement that depends on one is marked "Could not be checked".`,
      "",
      `### ${PLATFORM_SYSTEM}`,
      "",
      `- **What happened:** Lisa could not reach ${PLATFORM_SYSTEM}: ${SIGNED_OUT_ERROR.replaceAll(/\s+/gu, " ")}`,
      `- **What was tried:** \`${PLATFORM_REQUEST}\``,
      `- **What is needed:** To check what depends on it, an agent needs ${PLATFORM_ACCESS}.`,
      `- **Could not be checked because of it:** ${AUTHORITY_QUESTION} (whole repository)`,
      `- **Detail:** probe \`${PLATFORM}\``,
    ]);
  });

  it("says why a read was never tried", () => {
    const lines = section(
      withProbes(waitingOn(completeAuditReport()), [notAttemptedProbe()])
    );

    expect(lines).toContain(
      `- **What happened:** Lisa did not try to reach ${PLATFORM_SYSTEM}: No command on this machine can read that platform's merge settings.`
    );
    expect(
      lines.filter(line => line.startsWith("- **What was tried:**"))
    ).toEqual([]);
  });

  it("puts an error of several lines on one line", () => {
    const lines = section(
      withProbes(waitingOn(completeAuditReport()), [
        unreachableProbe({ observed_error: "gh: Not Found\n\n(HTTP 404)" }),
      ])
    );

    expect(lines).toContain(
      `- **What happened:** Lisa could not reach ${PLATFORM_SYSTEM}: gh: Not Found (HTTP 404)`
    );
  });

  it("names each waiting requirement by its question and its folder", () => {
    const dependent = { criterion: PART_FIRST, scope: API };
    const report = withProbes(
      waitingOn(waitingOn(completeAuditReport(MIXED)), dependent),
      [unreachableProbe({ needed_by: [dependent, AUTHORITY] })]
    );

    expect(section(report)).toContain(
      `- **Could not be checked because of it:** ${AUTHORITY_QUESTION} (whole repository); ${PART_QUESTION} (folder ${API})`
    );
  });

  it("says so when nothing in the report depends on the system", () => {
    const tracker = unreachableProbe({
      id: "tracker",
      system: "Linear, where the pipeline files say work is tracked",
      needed_by: [],
    });

    expect(section(withProbes(completeAuditReport(), [tracker]))).toContain(
      "- **Could not be checked because of it:** nothing in this report"
    );
  });

  it("leaves systems that answered out, and lists the rest in the report's order", () => {
    const report = withProbes(waitingOn(completeAuditReport()), [
      reachableProbe({ id: "tracker", needed_by: [], system: "Linear" }),
      unreachableProbe({
        id: "sonarcloud",
        needed_by: [],
        system: "SonarCloud",
      }),
      unreachableProbe(),
    ]);

    expect(section(report).filter(line => line.startsWith("### "))).toEqual([
      "### SonarCloud",
      `### ${PLATFORM_SYSTEM}`,
    ]);
  });

  it("uses no requirement id outside the detail line of a finding", () => {
    const lines = section(UNREACHED);

    expect(lines.flatMap(line => criterionIdsIn(line))).toEqual([]);
  });
});

describe("the readable report", () => {
  it("puts the section after the questions and before the first part", () => {
    const headings = renderAuditReportMarkdown(validated(UNREACHED), CRITERIA)
      .split("\n")
      .filter(line => line.startsWith("## "));

    expect(headings).toEqual([
      "## Summary",
      "## Open questions (type each answer on its Answer line, then run the audit again)",
      UNREACHED_HEADING,
      "## Whole repository",
    ]);
    expect(UNREACHED_HEADING).toBe("## What could not be reached");
  });
});

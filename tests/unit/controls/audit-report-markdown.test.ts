/**
 * The audit report as an operator reads it.
 *
 * `report.md` is rendered from the validated JSON, never written by hand, so it
 * cannot say something the checked record does not. It leads with the plain
 * question and the three plain-language fields, and keeps the criterion id as
 * detail (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_MARKDOWN_SECTIONS,
  renderAuditReportMarkdown,
  type AuditReportMarkdownSection,
} from "../../../src/controls/audit-report-markdown.js";
import {
  validateAuditReport,
  type AuditReport,
} from "../../../src/controls/audit-report.js";
import {
  criterionIdsIn,
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import {
  amendFinding,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";

const CRITERIA = inScopeCriteria(loadCriterionCatalogue());

/** The requirements answered once for the repository, and those answered per part. */
const REPOSITORY_WIDE = CRITERIA.filter(
  ({ answered }) => answered === "repository"
);
const PER_PART = CRITERIA.filter(({ answered }) => answered === "part");

/** A requirement that has a finding in every folder: the first answered per part. */
const FIRST = PER_PART[0];
const WHAT = "A linter is configured, but nothing runs it.";
const WHY = "A change that breaks the style rules can still be merged.";
const NEXT = "Run the configure step to wire the linter into commits.";

/**
 * Validate a sample so the renderer is given what the command gives it.
 * @param sample - Candidate report
 * @returns The validated report
 */
function validated(sample: SampleReport): AuditReport {
  const { report, violations } = validateAuditReport(sample, {
    criteria: CRITERIA,
    evidence: [],
    now: new Date("2026-11-17T12:00:00.000Z"),
    repository: {
      lineCount: () => 5,
      isFolder: () => true,
    },
    trackerConfigured: false,
    inlineAnswers: { rendered: false, problems: [], entries: [] },
  });
  if (report === null) {
    throw new Error(`sample report is invalid: ${JSON.stringify(violations)}`);
  }
  return report;
}

/**
 * Render a sample report.
 * @param sample - Candidate report
 * @returns The Markdown
 */
function render(sample: SampleReport): string {
  return renderAuditReportMarkdown(validated(sample), CRITERIA);
}

const WITH_LINTER = amendFinding(
  completeAuditReport([".", "api"]),
  { criterion: FIRST?.id ?? "", scope: "api" },
  {
    state: "exists-not-enforced",
    what: WHAT,
    why: WHY,
    next: NEXT,
    mechanisms: [
      {
        tool: "ruff",
        command: "ruff check .",
        moment: "commit",
        locators: [{ path: "api/ruff.toml", line: 4 }],
      },
    ],
  }
);

describe("renderAuditReportMarkdown", () => {
  it("explains the evidence still needed for an unmapped gate", () => {
    const markdown = render(completeAuditReport());

    expect(markdown).toContain(
      "No registered gate tests that the agent being judged cannot bypass or switch off a required check. The minimum evidence rung is observed."
    );
    expect(markdown).toContain(
      "No registered gate compares the local copies of the checks with the required ones."
    );
    expect(markdown).toContain("The minimum evidence rung is exercised.");
  });

  it("has one section for the whole repository and one per folder", () => {
    const headings = render(completeAuditReport([".", "api", "web"]))
      .split("\n")
      .filter(line => line.startsWith("## "));

    expect(headings).toEqual([
      "## Summary",
      "## Open questions (type each answer on its Answer line, then run the audit again)",
      "## Whole repository",
      "## Folder `api`",
      "## Folder `web`",
    ]);
  });

  it("counts the findings of each part by state", () => {
    const markdown = render(WITH_LINTER);

    expect(markdown).toContain(
      `| Whole repository | 0 | 0 | ${REPOSITORY_WIDE.length} | 0 | 0 | 0 |`
    );
    expect(markdown).toContain(
      `| Folder \`api\` | 0 | 1 | ${PER_PART.length - 1} | 0 | 0 | 0 |`
    );
  });

  it("leads each finding with the plain question", () => {
    const headings = render(completeAuditReport())
      .split("\n")
      .filter(line => line.startsWith("### "));

    expect(headings).toEqual([
      "### tracker",
      ...CRITERIA.map(criterion => `### ${criterion.question}`),
    ]);
  });

  it("shows each requirement only where it is answered: once for the repository, or under every folder", () => {
    const [, , repository, api, web] = render(
      completeAuditReport([".", "api", "web"])
    )
      .split(/^## /mu)
      .slice(1)
      .map(section =>
        section.split("\n").filter(line => line.startsWith("### "))
      );
    const questions = (criteria: typeof CRITERIA): readonly string[] =>
      criteria.map(criterion => `### ${criterion.question}`);

    expect(repository).toEqual(questions(REPOSITORY_WIDE));
    expect(api).toEqual(questions(PER_PART));
    expect(web).toEqual(questions(PER_PART));
  });

  it("shows the three plain-language fields and where the control was found", () => {
    const markdown = render(WITH_LINTER);

    expect(markdown).toContain(`- **What was found:** ${WHAT}`);
    expect(markdown).toContain(`- **Why it matters:** ${WHY}`);
    expect(markdown).toContain(`- **What to do next:** ${NEXT}`);
    expect(markdown).toContain(
      "- **Where:** `ruff`, run as `ruff check .` at commit: `api/ruff.toml` line 4"
    );
    expect(markdown).toContain("**In place, but nothing enforces it**");
  });

  it("keeps criterion ids on the detail line only", () => {
    const lines = render(WITH_LINTER).split("\n");
    const withIds = lines.filter(line => criterionIdsIn(line).length > 0);

    expect(withIds.length).toBe(REPOSITORY_WIDE.length + PER_PART.length);
    withIds.forEach(line => {
      expect(line.startsWith("- **Detail:** requirement ")).toBe(true);
    });
    expect(lines).toContain(
      `- **Detail:** requirement ${FIRST?.id} (${FIRST?.title})`
    );
  });

  it("names the evidence record behind a proved finding", () => {
    const checked = validated(WITH_LINTER);
    const report: AuditReport = {
      ...checked,
      findings: checked.findings.map(finding =>
        finding.state === "exists-not-enforced"
          ? { ...finding, state: "proved", evidence_id: "ev-0001" }
          : finding
      ),
    };

    expect(renderAuditReportMarkdown(report, CRITERIA)).toContain(
      "- **Evidence record:** `ev-0001`"
    );
  });

  it("renders the same report to the same bytes, ending in a newline", () => {
    const first = render(WITH_LINTER);

    expect(render(WITH_LINTER)).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
  });

  it("takes a new section as one more entry", () => {
    const closing: AuditReportMarkdownSection = report => [
      "## Closing",
      "",
      `${report.findings.length} findings.`,
    ];
    const markdown = renderAuditReportMarkdown(
      validated(completeAuditReport()),
      CRITERIA,
      [...AUDIT_REPORT_MARKDOWN_SECTIONS, closing]
    );

    expect(
      markdown.endsWith(`## Closing\n\n${CRITERIA.length} findings.\n`)
    ).toBe(true);
  });
});

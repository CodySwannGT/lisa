/**
 * The audit report as an operator reads it.
 *
 * `.lisa/audit/report.md` is rendered from the validated record and never
 * written by hand, so it cannot say something the checked JSON does not. Each
 * requirement is shown as its plain question with the three plain-language
 * fields under it; the criterion id comes last, as detail for a reader who
 * knows the specification.
 *
 * ## Adding a section
 *
 * The document is a list of sections, each a function from the report to its
 * lines. To add one, write the function and add it to
 * {@link AUDIT_REPORT_MARKDOWN_SECTIONS}. A section with nothing to say returns
 * no lines and leaves no gap.
 * @module controls/audit-report-markdown
 */
import {
  AUDIT_FINDING_STATES,
  AUDIT_REPORT_JSON_PATH,
  NO_MOMENT,
  REPOSITORY_SCOPE,
  type AuditFinding,
  type AuditFindingState,
  type AuditMechanism,
  type AuditReport,
} from "./audit-report-types.js";
import type { InScopeCriterion } from "./catalogue.js";

/** One part of the rendered document. */
export type AuditReportMarkdownSection = (
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
) => readonly string[];

/** Each state, said the way an operator would say it. */
const STATE_LABEL: Readonly<Record<AuditFindingState, string>> = {
  proved: "Proved",
  "exists-not-enforced": "In place, but nothing enforces it",
  missing: "Missing",
  "not-applicable": "Does not apply here",
  unknown: "Could not be checked",
  question: "Needs your answer",
};

/** Each state as a column heading of the summary. */
const STATE_COLUMN: Readonly<Record<AuditFindingState, string>> = {
  proved: "Proved",
  "exists-not-enforced": "In place, not enforced",
  missing: "Missing",
  "not-applicable": "Does not apply",
  unknown: "Could not be checked",
  question: "Needs your answer",
};

/**
 * Put free text on one line.
 * @param text - Text from the report
 * @returns The text with every run of white space as one space
 */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Name a part of the repository as a heading.
 * @param scope - A report scope
 * @returns `Whole repository`, or the folder in code style
 */
function partName(scope: string): string {
  return scope === REPOSITORY_SCOPE
    ? "Whole repository"
    : `Folder \`${scope}\``;
}

/**
 * Say where a mechanism was found and when it runs.
 * @param mechanism - The mechanism
 * @returns One bullet
 */
function whereLine(mechanism: AuditMechanism): string {
  const pointers = mechanism.locators
    .map(locator => `\`${locator.path}\` line ${locator.line}`)
    .join("; ");
  const quoted =
    mechanism.command === null ? "" : `\`${oneLine(mechanism.command)}\``;
  const idle =
    quoted === ""
      ? "not run by anything"
      : `not run by anything (its command is ${quoted})`;
  const runs =
    mechanism.moment === NO_MOMENT
      ? idle
      : `run as ${quoted} at ${mechanism.moment}`;
  return `- **Where:** \`${oneLine(mechanism.tool)}\`, ${runs}: ${pointers}`;
}

/**
 * Render one finding.
 * @param finding - The finding
 * @param criterion - The catalogue entry it is about
 * @returns The finding's lines
 */
function findingLines(
  finding: AuditFinding,
  criterion: InScopeCriterion
): readonly string[] {
  return [
    `### ${criterion.question}`,
    "",
    `**${STATE_LABEL[finding.state]}**`,
    "",
    `- **What was found:** ${oneLine(finding.what)}`,
    `- **Why it matters:** ${oneLine(finding.why)}`,
    `- **What to do next:** ${oneLine(finding.next)}`,
    ...finding.mechanisms.map(mechanism => whereLine(mechanism)),
    ...(finding.evidence_id === undefined
      ? []
      : [`- **Evidence record:** \`${finding.evidence_id}\``]),
    `- **Detail:** requirement ${criterion.id} (${criterion.title})`,
  ];
}

/**
 * The title and a line saying where the document comes from.
 * @returns The section's lines
 */
const titleSection: AuditReportMarkdownSection = () => [
  "# Audit report",
  "",
  `Rendered by \`lisa controls report-check\` from \`${AUDIT_REPORT_JSON_PATH}\`, the checked record. Each requirement is shown as a plain question. One that has a single answer for the whole repository is under "Whole repository"; one whose answer can differ from folder to folder is under each folder.`,
];

/**
 * How many findings of each part are in each state.
 * @param report - The report
 * @returns The section's lines
 */
const summarySection: AuditReportMarkdownSection = report => [
  "## Summary",
  "",
  `| Part | ${AUDIT_FINDING_STATES.map(state => STATE_COLUMN[state]).join(" | ")} |`,
  `| --- | ${AUDIT_FINDING_STATES.map(() => "---:").join(" | ")} |`,
  ...report.scopes.map(scope => {
    const counts = AUDIT_FINDING_STATES.map(
      state =>
        report.findings.filter(
          finding => finding.scope === scope && finding.state === state
        ).length
    );
    return `| ${partName(scope)} | ${counts.join(" | ")} |`;
  }),
];

/**
 * One section per part, with its findings in catalogue order.
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The section's lines
 */
const partSections: AuditReportMarkdownSection = (report, criteria) =>
  report.scopes
    .flatMap(scope => [
      [`## ${partName(scope)}`],
      ...criteria.flatMap(criterion =>
        report.findings
          .filter(
            finding =>
              finding.scope === scope && finding.criterion === criterion.id
          )
          .map(finding => findingLines(finding, criterion))
      ),
    ])
    .flatMap((block, index) => (index === 0 ? block : ["", ...block]));

/** The sections of the document, in the order they appear. */
export const AUDIT_REPORT_MARKDOWN_SECTIONS: readonly AuditReportMarkdownSection[] =
  [titleSection, summarySection, partSections];

/**
 * Render a validated report as Markdown.
 * @param report - A report that passed validation
 * @param criteria - The in-scope criteria, in catalogue order
 * @param sections - The sections to render
 * @returns The document, ending in one newline
 */
export function renderAuditReportMarkdown(
  report: AuditReport,
  criteria: readonly InScopeCriterion[],
  sections: readonly AuditReportMarkdownSection[] = AUDIT_REPORT_MARKDOWN_SECTIONS
): string {
  const blocks = sections
    .map(section => section(report, criteria).join("\n"))
    .filter(block => block !== "");
  return `${blocks.join("\n\n")}\n`;
}

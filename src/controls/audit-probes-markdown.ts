/**
 * The part of the readable report that says which outside systems the audit
 * could not read.
 *
 * A finding marked "Could not be checked" tells an operator that something is
 * unknown. This section tells them why, once, in the words they need to act
 * on it: which system did not answer, what it said, what was tried, what
 * access to arrange, and which requirements are waiting on it. A system that
 * answered is not listed, and with nothing to list the section is absent.
 *
 * Text from the record is put on one line and nothing else is done to it. The
 * check refuses a probe that holds a credential before this is ever rendered
 * (`./audit-report-rules/probe-secrets.ts`).
 * @module controls/audit-probes-markdown
 */
import type { AuditProbe } from "./audit-probe-types.js";
import { isNeededBy, isReached } from "./audit-probes.js";
import type { AuditReport } from "./audit-report-types.js";
import { describeScope } from "./audit-report-wording.js";
import type { InScopeCriterion } from "./catalogue.js";

/** The section's heading. */
export const UNREACHED_HEADING = "## What could not be reached";

/** What the section is, said once under the heading. */
const INTRODUCTION = `Before answering, Lisa tries one harmless read of each outside system a requirement depends on. The ones below did not answer, so every requirement that depends on one is marked "Could not be checked".`;

/**
 * Put free text on one line.
 * @param text - Text from the report
 * @returns The text with every run of white space as one space
 */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Say what happened to one probe, as one sentence.
 * @param probe - A probe that got no answer
 * @returns The sentence
 */
function whatHappened(probe: AuditProbe): string {
  const system = oneLine(probe.system);
  return probe.result === "not-attempted"
    ? `Lisa did not try to reach ${system}: ${oneLine(probe.reason ?? "")}`
    : `Lisa could not reach ${system}: ${oneLine(probe.observed_error ?? "")}`;
}

/**
 * Name the requirements that wait on one probe, each by its plain question
 * and the part it is answered in, in the order the report shows them.
 * @param probe - The probe
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The questions, or a statement that there are none
 */
function waiting(
  probe: AuditProbe,
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): string {
  const questions = criteria.flatMap(criterion =>
    report.scopes
      .filter(scope => isNeededBy(probe, { criterion: criterion.id, scope }))
      .map(scope => `${criterion.question} (${describeScope(scope)})`)
  );
  return questions.length === 0
    ? "nothing in this report"
    : questions.join("; ");
}

/**
 * Render one probe that got no answer.
 * @param probe - The probe
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The probe's lines
 */
function probeLines(
  probe: AuditProbe,
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  return [
    `### ${oneLine(probe.system)}`,
    "",
    `- **What happened:** ${whatHappened(probe)}`,
    ...(probe.request === undefined
      ? []
      : [`- **What was tried:** \`${oneLine(probe.request)}\``]),
    `- **What is needed:** To check what depends on it, an agent needs ${oneLine(probe.access_needed ?? "")}.`,
    `- **Could not be checked because of it:** ${waiting(probe, report, criteria)}`,
    `- **Detail:** probe \`${probe.id}\``,
  ];
}

/**
 * The outside systems the audit could not read, in the report's order.
 * @param report - The report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The section's lines; none when every probe got an answer
 */
export function unreachedSection(
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  const unreached = report.probes.filter(probe => !isReached(probe));
  if (unreached.length === 0) return [];
  return [
    UNREACHED_HEADING,
    "",
    INTRODUCTION,
    ...unreached.flatMap(probe => ["", ...probeLines(probe, report, criteria)]),
  ];
}

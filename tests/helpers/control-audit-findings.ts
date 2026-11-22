/**
 * Sample findings for the suites that act on what an audit found.
 *
 * The plain sample report says every requirement is missing. The configure
 * step acts on the other findings: a check the audit found at a place, and a
 * question nobody has answered. These build each one so that it passes every
 * rule the report is held to, and put them into a complete report
 * (CodySwannGT/lisa#4984).
 * @module tests/helpers/control-audit-findings
 */
import {
  amendFinding,
  completeAuditReport,
  sampleQuestion,
  type SampleFinding,
  type SampleReport,
} from "./control-audit-report.js";

/**
 * A finding that says a check exists, found at one place.
 * @param criterion - Criterion id
 * @param scope - The part the finding is about
 * @param file - The file the check was found in, which must exist there
 * @param line - The line in that file
 * @returns The finding
 */
export function foundAt(
  criterion: string,
  scope: string,
  file: string,
  line = 1
): SampleFinding {
  return {
    criterion,
    scope,
    state: "exists-not-enforced",
    what: "A checker is set up here, but nothing runs it when code is committed, pushed or proposed for merging.",
    why: "A change that breaks the rule can reach the main branch without anyone being told.",
    next: "Run the configure step and choose when this check should run.",
    mechanisms: [
      {
        tool: "checker",
        command: null,
        moment: "none",
        locators: [{ path: file, line }],
      },
    ],
  };
}

/**
 * A finding only a person can settle, which nobody has answered.
 * @param criterion - Criterion id
 * @param scope - The part the finding is about
 * @returns The finding
 */
export function openQuestion(criterion: string, scope: string): SampleFinding {
  return {
    criterion,
    scope,
    state: "question",
    what: "Two settings were found that disagree, and nothing shows which one the team means.",
    why: "Until someone says which one is meant, a check could hold changes to the wrong rule.",
    next: "Ask whoever looks after this part of the repository which setting is the intended one.",
    mechanisms: [],
  };
}

/**
 * A complete report in which the given findings replace the plain ones. A
 * finding that needs a person's answer brings the question that asks for it,
 * since a report with one and not the other is refused.
 * @param scopes - The parts the report covers
 * @param findings - The findings to put in
 * @returns The report
 */
export function reportWith(
  scopes: readonly string[],
  findings: readonly SampleFinding[]
): SampleReport {
  return findings.reduce<SampleReport>((report, finding) => {
    const criterion = String(finding.criterion);
    const scope = String(finding.scope);
    const placed = amendFinding(report, { criterion, scope }, finding);
    return finding.state === "question"
      ? {
          ...placed,
          questions: [
            ...(placed.questions ?? []),
            sampleQuestion(criterion, scope),
          ],
        }
      : placed;
  }, completeAuditReport(scopes));
}

/**
 * Rule: every in-scope criterion is placed exactly once in each place it is
 * answered, and nowhere else.
 *
 * The catalogue says, for every requirement, whether it has one answer for the
 * repository (`answered: "repository"`) or one for each part
 * (`answered: "part"`). A report is held to that:
 *
 * - a requirement answered once for the repository has exactly one finding,
 *   with the scope `.`. A finding for it under a folder is refused;
 * - a requirement answered per part has exactly one finding under every folder
 *   the report lists, and a finding for it with the scope `.` is refused. When
 *   the report lists no folder, the repository is its own single part and the
 *   requirement has exactly one finding, with the scope `.`.
 *
 * A report that skips a requirement, or places it in two states, cannot be
 * counted. One that files a requirement where it is not answered carries
 * filler an operator cannot tell from a real gap. A finding for an id the
 * catalogue does not hold at this level, or for a part the report does not
 * list, belongs to no count at all and is refused too.
 *
 * Every message names the requirement by its plain question and the part in
 * words, and says which of the two placements was broken: the line is read by
 * an operator, and the criterion id follows it only as the place to look.
 * @module controls/audit-report-rules/coverage
 */
import {
  REPOSITORY_SCOPE,
  type AuditFinding,
  type AuditReportRule,
  type AuditReportViolation,
} from "../audit-report-types.js";
import { describeScope, findingViolation } from "../audit-report-wording.js";
import type { InScopeCriterion } from "../catalogue.js";

/** The name this rule's violations carry. */
const COVERAGE_RULE = "coverage";

/**
 * The folders a report lists: its parts other than the whole repository.
 * @param scopes - The report's scopes
 * @returns Each folder once, in listed order
 */
function listedFolders(scopes: readonly string[]): readonly string[] {
  return [...new Set(scopes)].filter(scope => scope !== REPOSITORY_SCOPE);
}

/**
 * The scopes a report must answer a requirement in.
 * @param criterion - The requirement
 * @param scopes - The report's scopes
 * @returns Every listed folder for a requirement answered per part, when the
 *   report lists any; otherwise the whole repository alone
 */
function answeringScopes(
  criterion: InScopeCriterion,
  scopes: readonly string[]
): readonly string[] {
  const folders = listedFolders(scopes);
  return criterion.answered === "part" && folders.length > 0
    ? folders
    : [REPOSITORY_SCOPE];
}

/**
 * Name a part inside a sentence.
 * @param scope - A report scope
 * @returns `the whole repository`, or `the folder <path>`
 */
function thePart(scope: string): string {
  return `the ${describeScope(scope)}`;
}

/**
 * Say what is wrong with a finding filed where its requirement is not
 * answered.
 * @param criterion - The requirement
 * @param scope - Where the finding was filed
 * @returns What is wrong and what to do
 */
function misplacedMessage(criterion: InScopeCriterion, scope: string): string {
  return criterion.answered === "repository"
    ? `"${criterion.question}" is answered once, for the whole repository, but this finding files it under ${thePart(scope)}. Move what it says into the finding for the whole repository (scope "${REPOSITORY_SCOPE}"), and remove this one.`
    : `"${criterion.question}" is answered once for each folder the report lists, but this finding files it under ${thePart(scope)}. Give each folder its own finding for it, and remove this one.`;
}

/**
 * Say that a requirement has no finding where it is answered.
 * @param criterion - The requirement
 * @param scope - Where a finding is owed
 * @param folders - The folders the report lists
 * @returns What is wrong and what to do
 */
function absentMessage(
  criterion: InScopeCriterion,
  scope: string,
  folders: readonly string[]
): string {
  if (criterion.answered === "repository") {
    return `No finding answers "${criterion.question}" for the whole repository. This requirement is answered once, for the whole repository, so add one finding for it with the scope "${scope}".`;
  }
  return folders.length === 0
    ? `No finding answers "${criterion.question}". The report lists no folders, so this requirement is answered once, for the whole repository: add one finding for it with the scope "${scope}".`
    : `No finding answers "${criterion.question}" for ${thePart(scope)}. This requirement is answered once for each folder the report lists, so add one finding for it with the scope "${scope}".`;
}

/**
 * Say that a part the report covers has no findings at all, once, instead of
 * once for every requirement owed there.
 * @param scope - The part
 * @param folders - The folders the report lists
 * @returns What is wrong and what to do
 */
function emptyMessage(scope: string, folders: readonly string[]): string {
  if (scope !== REPOSITORY_SCOPE) {
    return `The report lists ${thePart(scope)} but has no findings for it. Add one finding for every requirement that is answered folder by folder, or take the folder off the "scopes" list.`;
  }
  return folders.length === 0
    ? `The report has no findings. Add one finding, with the scope "${scope}", for every requirement.`
    : `The report has no findings for the whole repository. Add one finding, with the scope "${scope}", for every requirement that is answered once for the repository.`;
}

/**
 * Report what is wrong with how one part's findings cover the requirements
 * answered there.
 * @param scope - The part
 * @param owed - The requirements answered in it, in catalogue order
 * @param report - The report's scopes and findings
 * @param report.scopes - The report's scopes
 * @param report.findings - The report's findings
 * @returns One violation for a part with no findings at all, otherwise one per
 *   requirement that is absent or placed more than once
 */
function partViolations(
  scope: string,
  owed: readonly InScopeCriterion[],
  report: {
    readonly scopes: readonly string[];
    readonly findings: readonly AuditFinding[];
  }
): readonly AuditReportViolation[] {
  const folders = listedFolders(report.scopes);
  const filed = report.findings.filter(finding => finding.scope === scope);
  if (owed.length === 0) return [];
  if (filed.length === 0) {
    return [
      { rule: COVERAGE_RULE, scope, message: emptyMessage(scope, folders) },
    ];
  }
  return owed.flatMap(criterion => {
    const placed = filed.filter(
      finding => finding.criterion === criterion.id
    ).length;
    if (placed === 1) return [];
    return [
      {
        rule: COVERAGE_RULE,
        criterion: criterion.id,
        scope,
        message:
          placed === 0
            ? absentMessage(criterion, scope, folders)
            : `${placed} findings answer "${criterion.question}" for ${thePart(scope)}, so it is in more than one state. Keep exactly one.`,
      },
    ];
  });
}

/**
 * Every in-scope criterion appears exactly once in each scope it is answered
 * in, and nothing else appears at all.
 *
 * The whole repository is always a place a finding may be filed, whether or
 * not the report lists `.`: a list without it is the scopes rule's to refuse,
 * once, and is not repeated here for every repository-wide finding.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found: findings for an unknown id, then findings
 *   filed where their requirement is not answered, then findings under a part
 *   the report does not list, then what each part is missing or holds twice
 */
export const everyCriterionOncePerScope: AuditReportRule = (
  report,
  context
) => {
  const byId = new Map(
    context.criteria.map(criterion => [criterion.id, criterion])
  );
  const places = [REPOSITORY_SCOPE, ...listedFolders(report.scopes)];
  const known = report.findings.flatMap(finding => {
    const criterion = byId.get(finding.criterion);
    return criterion === undefined ? [] : [{ finding, criterion }];
  });
  const misplaced = known.filter(({ finding, criterion }) =>
    criterion.answered === "repository"
      ? finding.scope !== REPOSITORY_SCOPE
      : finding.scope === REPOSITORY_SCOPE && places.length > 1
  );
  const unlisted = known.filter(
    placed =>
      !misplaced.includes(placed) && !places.includes(placed.finding.scope)
  );
  return [
    ...report.findings
      .filter(finding => !byId.has(finding.criterion))
      .map(finding =>
        findingViolation(
          COVERAGE_RULE,
          finding,
          "This finding is filed under an id that is not a Level 1 requirement in the catalogue. Correct the id, or remove the finding.",
          "criterion"
        )
      ),
    ...misplaced.map(({ finding, criterion }) =>
      findingViolation(
        COVERAGE_RULE,
        finding,
        misplacedMessage(criterion, finding.scope),
        "scope"
      )
    ),
    ...unlisted.map(({ finding, criterion }) =>
      findingViolation(
        COVERAGE_RULE,
        finding,
        `"${criterion.question}" has a finding under ${thePart(finding.scope)}, which the report's "scopes" list does not include. Add the folder to the list, with a finding for every requirement that is answered folder by folder, or remove this finding.`,
        "scope"
      )
    ),
    ...places.flatMap(scope =>
      partViolations(
        scope,
        context.criteria.filter(criterion =>
          answeringScopes(criterion, report.scopes).includes(scope)
        ),
        report
      )
    ),
  ];
};

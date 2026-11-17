/**
 * Rule: the parts a report covers are real folders, each listed once, and the
 * repository as a whole is one of them.
 *
 * Findings are reported per part, and a part is identified by its folder path.
 * A part that is not a folder of the repository identifies nothing, and a
 * report with no repository-wide section has nowhere to place the requirements
 * that are about the repository rather than about one folder of it.
 * @module controls/audit-report-rules/scopes
 */
import {
  REPOSITORY_SCOPE,
  type AuditReportRule,
} from "../audit-report-types.js";

/** The name this rule's violations carry. */
export const SCOPES_RULE = "scopes";

/**
 * Tell whether a scope is written the one way a folder path may be written:
 * `.`, or `/`-separated folder names from the repository root with nothing to
 * normalise away.
 * @param scope - A report scope
 * @returns Whether the path is in that form
 */
function isFolderPath(scope: string): boolean {
  return (
    scope === REPOSITORY_SCOPE ||
    (!scope.includes("\\") &&
      scope
        .split("/")
        .every(
          segment => segment !== "" && segment !== "." && segment !== ".."
        ))
  );
}

/**
 * The scopes are distinct folders of the repository and include the root.
 * @param report - The report
 * @param context - The facts it is checked against
 * @returns The violations found
 */
export const scopesAreRepositoryFolders: AuditReportRule = (
  report,
  context
) => {
  const distinct = [...new Set(report.scopes)];
  const repeated = distinct.filter(
    scope => report.scopes.filter(listed => listed === scope).length > 1
  );
  return [
    ...(distinct.includes(REPOSITORY_SCOPE)
      ? []
      : [
          {
            rule: SCOPES_RULE,
            message: `The report's "scopes" list must include "." so the repository as a whole is covered. Add it, with one finding for every requirement.`,
          },
        ]),
    ...repeated.map(scope => ({
      rule: SCOPES_RULE,
      scope,
      message: `This part is on the report's "scopes" list more than once. List it once.`,
    })),
    ...distinct
      .filter(
        scope => !isFolderPath(scope) || !context.repository.isFolder(scope)
      )
      .map(scope => ({
        rule: SCOPES_RULE,
        scope,
        message: `This part is not a folder of the repository. Give the folder's path from the repository root, such as "api", or "." for the whole repository.`,
      })),
  ];
};

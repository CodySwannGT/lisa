/**
 * Permission-scope arithmetic for Lisa's reusable workflows.
 *
 * A called workflow may only DOWNGRADE its caller's grant. Declaring a scope the
 * caller never held is a `startup_failure` for the caller's ENTIRE run, decided
 * before any job executes — so no `if:`, no unset input and no dormant job can
 * contain it. Lisa has shipped that defect twice (#2046, #2566).
 *
 * @module tests/integration/support/reusable-workflow-scopes
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";

/** GitHub's scope levels, ordered so two grants can be compared. */
const RANK: Readonly<Record<string, number>> = {
  none: 0,
  read: 1,
  write: 2,
};

/** A permissions map as it appears in a workflow file. */
export type ScopeMap = Readonly<Record<string, string>>;

/** The subset of a workflow file this module reads. */
export interface WorkflowDoc {
  on?: unknown;
  permissions?: ScopeMap;
  jobs?: Record<string, { permissions?: ScopeMap } | null | undefined>;
}

/**
 * Every scope a workflow file DECLARES, taking the highest level seen.
 *
 * Job-level blocks count exactly as much as the workflow-level one: either is a
 * declaration, and either can exceed the caller's grant. #2566 was a job-level
 * block sitting under a workflow-level `contents: read`, so a reader of only
 * the top-level block would have called that file clean.
 *
 * @param doc The parsed workflow.
 * @returns The declared scopes, keyed by scope name.
 */
export const declaredScopes = (doc: WorkflowDoc): ScopeMap =>
  [
    doc.permissions,
    ...Object.values(doc.jobs ?? {}).map(job => job?.permissions),
  ]
    .filter((perms): perms is ScopeMap => Boolean(perms))
    .flatMap(perms => Object.entries(perms))
    .filter(([, level]) => RANK[level] !== undefined)
    .reduce<Record<string, string>>(
      (acc, [scope, level]) =>
        RANK[level] > RANK[acc[scope] ?? "none"]
          ? { ...acc, [scope]: level }
          : acc,
      {}
    );

/**
 * The scopes a callee declares that a given grant does not cover.
 *
 * @param granted What the caller's explicit `permissions:` block grants.
 * @param declared What the callee declares.
 * @returns The uncovered scopes as `name:level`, empty when satisfied.
 */
export const missingScopes = (
  granted: ScopeMap,
  declared: ScopeMap
): string[] =>
  Object.entries(declared)
    .filter(([scope, level]) => RANK[level] > RANK[granted[scope] ?? "none"])
    .map(([scope, level]) => `${scope}:${level}`);

/**
 * Reads the declared scopes of every reusable workflow in a directory.
 *
 * "Reusable" means it has an `on.workflow_call` trigger — those are the only
 * ones a consumer repo can call, and therefore the only ones that can
 * startup-fail somebody else's run.
 *
 * @param workflowsDir Absolute path to `.github/workflows`.
 * @returns Declared scopes keyed by filename.
 */
export const liveDeclaredScopes = (
  workflowsDir: string
): Record<string, ScopeMap> =>
  fs
    .readdirSync(workflowsDir)
    .filter(name => name.endsWith(".yml"))
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, ScopeMap>>((acc, name) => {
      const parsed = ((): WorkflowDoc | undefined => {
        try {
          return yaml.load(
            fs.readFileSync(path.join(workflowsDir, name), "utf-8")
          ) as WorkflowDoc;
        } catch {
          return undefined;
        }
      })();
      const on = parsed?.on;
      const isReusable =
        Boolean(on) &&
        typeof on === "object" &&
        "workflow_call" in (on as Record<string, unknown>);
      return isReusable && parsed
        ? { ...acc, [name]: declaredScopes(parsed) }
        : acc;
    }, {});

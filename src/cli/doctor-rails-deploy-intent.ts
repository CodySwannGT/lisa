/**
 * `lisa doctor` check: does this Rails project SAY why it does not deploy
 * production?
 *
 * The seed was fixed so a new adoption inherits a deploy workflow that
 * explains the withheld `main` trigger. That fix reaches new adoptions only:
 * `rails/create-only/.github/workflows/deploy.yml` is written once and never
 * refreshed, and the file is host-owned from that moment — the header says so,
 * and the template invites customisation — so a migration that rewrote it
 * would break the promise `create-only` makes. Nothing else in Lisa ever looks
 * at the file again, which left every project seeded before the fix carrying a
 * bare `# - main` that nobody can tell apart from an oversight, in a
 * population whose size nobody knows (CodySwannGT/lisa#3743,
 * CodySwannGT/lisa#3779).
 *
 * This check REPORTS and names the remedy. It edits nothing, exactly as the
 * apply path refuses to.
 *
 * The point is that an affected project can find ITSELF, so a probe that
 * cannot look must never render as a project with nothing to report. Every
 * filesystem answer is three-valued — present, absent, or undeterminable —
 * and the last one fails rather than passing quietly. Three statuses for three
 * different facts: `ok` is nothing to state, `warn` is intent left unstated
 * (a human decides, on a file Lisa will not touch), and `fail` is this check
 * being unable to answer at all.
 * @module cli/doctor-rails-deploy-intent
 */
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { classifyProductionDeployIntent } from "../core/rails-deploy-production-intent.js";
import type { DoctorCheck } from "./doctor.js";

/** Name of the deploy-intent check as doctor reports it. */
export const RAILS_DEPLOY_INTENT_CHECK_NAME =
  "Rails production deploy intent stated?";

/** Repo-relative deploy workflow this template seeds. */
const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";

/**
 * Markers that identify a Rails checkout, matching the Rails project-type
 * detector: `bin/rails` first, `config/application.rb` second. Both are
 * definitive; other Ruby frameworks ship neither.
 */
const RAILS_MARKERS = ["bin/rails", "config/application.rb"] as const;

/**
 * Errno codes that ANSWER the question rather than refusing it: the path is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look, which is a different answer
 * and must not be spelled the same way.
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/**
 * The errno code of a rejected filesystem call, when it carries one.
 * @param error - Value thrown by a filesystem call
 * @returns The errno code, or undefined when the value carries none
 */
function errnoCode(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Re-throw a filesystem rejection unless it is a definitive absence.
 *
 * `fs-extra`'s `pathExists` resolves false for every failure, including a
 * permission denial, so a directory this process cannot read would report the
 * same "not a Rails project" as a Node repo.
 * @param error - Value thrown by a filesystem call
 * @param relativePath - Repo-relative path being probed
 * @throws {Error} When the filesystem declined to answer
 */
function rethrowUnlessAbsent(error: unknown, relativePath: string): void {
  const code = errnoCode(error);
  if (code !== undefined && ABSENT_CODES.has(code)) return;
  throw new Error(`could not read ${relativePath}: ${code ?? String(error)}`, {
    cause: error,
  });
}

/**
 * Is this a Rails checkout, REJECTING when the filesystem declines to say?
 * @param projectRoot - Absolute project root
 * @returns True when a Rails marker is present
 * @throws {Error} When a marker can be neither confirmed nor ruled out
 */
async function isRailsProject(projectRoot: string): Promise<boolean> {
  for (const marker of RAILS_MARKERS) {
    try {
      await stat(path.join(projectRoot, marker));
      return true;
    } catch (error) {
      rethrowUnlessAbsent(error, marker);
    }
  }
  return false;
}

/**
 * Read the deploy workflow, REJECTING when the filesystem declines to say.
 * @param projectRoot - Absolute project root
 * @returns Workflow source, or null when the file is provably absent
 * @throws {Error} When the file exists but could not be read
 */
async function readDeployWorkflow(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(path.join(projectRoot, DEPLOY_WORKFLOW), "utf8");
  } catch (error) {
    rethrowUnlessAbsent(error, DEPLOY_WORKFLOW);
    return null;
  }
}

/**
 * What an operator has to make true before uncommenting the entry, stated
 * here because the project's own copy of the workflow is precisely the file
 * that does not say.
 */
const ENABLING_PRECONDITIONS =
  "a repository secret named `AWS_ACCOUNT_ID_MAIN` holding the production " +
  "account id (`noliran/branch-based-secrets` expands `AWS_ACCOUNT_ID` to " +
  "`AWS_ACCOUNT_ID_<BRANCH IN UPPERCASE>`, so without it the account id " +
  "resolves empty and the deploy fails at the credentials step); a " +
  "`DeployServiceRole` in that account trusting this repository's OIDC " +
  "subject; the ECS cluster, services and ECR repositories this workflow " +
  "names in `env:`, whose names are fixed rather than suffixed per " +
  "environment; and a `production` environment in the Rails app";

/** Operator-facing statement of the finding and its remedy. */
const UNSTATED_DETAIL =
  `${DEPLOY_WORKFLOW} comments out its \`main\` branch entry with nothing ` +
  "saying why, so production deployment being off cannot be told apart from " +
  "a line someone dropped by mistake. Lisa seeded this file once and will " +
  `not rewrite it. Enabling production needs ${ENABLING_PRECONDITIONS}. ` +
  "Uncomment `- main` once all four hold; until then, record beside the " +
  "commented entry that it is deliberate, so the next reader is not left " +
  "guessing. Production stays reachable by hand meanwhile through this " +
  "workflow's `workflow_dispatch` trigger";

/**
 * Report whether a Rails project's deploy workflow states its production
 * intent.
 *
 * Warns rather than fails on a hit: nothing is broken, and the remedy is a
 * human decision about a host-owned file. Fails when the question could not
 * be answered, for the reason in the module note.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkRailsDeployIntent(
  targetPath: string
): Promise<DoctorCheck> {
  try {
    const root = await stat(targetPath);
    if (!root.isDirectory()) {
      throw new Error(`${targetPath} is not a directory`);
    }
    if (!(await isRailsProject(targetPath))) {
      return ok("Not a Rails project");
    }
    const workflowText = await readDeployWorkflow(targetPath);
    if (workflowText === null) {
      return ok(`No ${DEPLOY_WORKFLOW} in this project`);
    }
    return describeIntent(workflowText);
  } catch (error) {
    return {
      name: RAILS_DEPLOY_INTENT_CHECK_NAME,
      status: "fail",
      detail:
        `Could not determine whether ${DEPLOY_WORKFLOW} states its ` +
        `production deploy intent: ${
          error instanceof Error ? error.message : String(error)
        }. Treated as a failure rather than a pass: a workflow that could ` +
        "not be read is not one with nothing in it",
    };
  }
}

/**
 * Turn a parsed workflow into the check line it earns.
 * @param workflowText - Full deploy workflow source
 * @returns Doctor check result
 * @throws {Error} When the workflow cannot be parsed
 */
function describeIntent(workflowText: string): DoctorCheck {
  switch (classifyProductionDeployIntent(workflowText)) {
    case "triggers":
      return ok(`${DEPLOY_WORKFLOW} deploys production from \`main\``);
    case "explained":
      return ok(`${DEPLOY_WORKFLOW} states why production is withheld`);
    case "unmentioned":
      return ok(`${DEPLOY_WORKFLOW} carries no commented-out \`main\` entry`);
    default:
      return {
        name: RAILS_DEPLOY_INTENT_CHECK_NAME,
        status: "warn",
        detail: UNSTATED_DETAIL,
      };
  }
}

/**
 * A passing line for this check.
 * @param detail - What was found
 * @returns Doctor check result
 */
function ok(detail: string): DoctorCheck {
  return { name: RAILS_DEPLOY_INTENT_CHECK_NAME, status: "ok", detail };
}

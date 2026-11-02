/**
 * Does a third-party review evidence workflow wake when the reviewer reports
 * through a check run, and may its token read that run?
 *
 * A reviewer can report through a commit status or through a check run, and
 * the one this repository declares moved from the first to the second between
 * 2026-10-26 and 2026-10-27. The workflow Lisa seeded woke only on `status`
 * events and granted no `checks: read`, so from that day it never ran: a check
 * run fires no status event (CodySwannGT/lisa#4553).
 *
 * The seed is fixed, but it is `create-only`. Lisa writes it once, the host
 * owns it from then on, and `lisa apply` never refreshes it — so the fix
 * reaches new adoptions only, and every repository seeded earlier keeps a
 * workflow that silently stopped running. That population is what the
 * `lisa doctor` check exists to find, and it REPORTS rather than rewrites: an
 * apply runs on postinstall, and a wrong silent edit to a host-owned workflow
 * is worse than a report.
 *
 * The question lives here, apart from both callers, because two surfaces ask
 * it: the regression guard on the shipped seeds and the doctor check that lets
 * an already-seeded repository find itself. Two spellings of "wakes on a check
 * run" would drift, and the drift would be silent in the direction that
 * matters — a doctor check accepting a shape the seed guard rejects.
 *
 * A document that cannot be parsed is thrown rather than read as "missing":
 * guessing an answer out of unparsed YAML would report a working workflow as
 * broken, or the reverse.
 * @module core/third-party-evidence-seed
 */
import { loadYaml } from "../utils/yaml.js";

/** Repo-relative path the TypeScript stack seeds the workflow at. */
export const THIRD_PARTY_EVIDENCE_WORKFLOW =
  ".github/workflows/third-party-review-evidence.yml";

/** The prover the workflow runs, which marks the job whose token matters. */
const PROVER = "check-third-party-review-evidence";

/** Scope values that include reading check runs. */
const READS_CHECKS = new Set(["read", "write"]);

/** Shorthand `permissions:` values that grant every scope. */
const GRANTS_EVERYTHING = new Set(["read-all", "write-all"]);

/** What a seeded evidence workflow can and cannot do about check runs. */
export interface EvidenceSeedReading {
  /** It starts when a check run completes. */
  readonly wakesOnCheckRun: boolean;
  /** The job running the prover holds a token that may read check runs. */
  readonly readsChecks: boolean;
}

/** The slice of a workflow document this module reads. */
interface WorkflowDocument {
  readonly on?: unknown;
  readonly true?: unknown;
  readonly permissions?: unknown;
  readonly jobs?: unknown;
}

/** The slice of one job this module reads. */
interface WorkflowJob {
  readonly permissions?: unknown;
  readonly steps?: unknown;
}

/**
 * A plain object, as YAML parses a mapping.
 * @param value - Any parsed value
 * @returns True for a non-array object
 */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a trigger block starts the workflow when a check run completes.
 *
 * `check_run` with no `types:` filter wakes on every activity, `completed`
 * included, so it counts. A filter that leaves `completed` out never wakes on
 * the event that carries the answer, so it does not.
 * @param on - The parsed `on:` value, in any of its three spellings
 * @returns True when a completed check run starts the workflow
 */
function wakesOnCompletedCheckRun(on: unknown): boolean {
  if (on === "check_run") return true;
  if (Array.isArray(on)) return on.includes("check_run");
  if (!isMapping(on) || !Object.hasOwn(on, "check_run")) return false;
  const filter: unknown = on.check_run;
  if (!isMapping(filter)) return filter === null || filter === undefined;
  const types: unknown = filter.types;
  if (types === undefined || types === null) return true;
  if (typeof types === "string") return types === "completed";
  return Array.isArray(types) && types.includes("completed");
}

/**
 * Whether one `permissions:` value lets the token read check runs.
 *
 * An absent block is not a grant here. It hands the token the repository's
 * default, which this file cannot see, and the remedy for "unknown" is the same
 * line the remedy for "missing" names.
 * @param permissions - A parsed `permissions:` value
 * @returns True when `checks` is readable under it
 */
function grantsChecksRead(permissions: unknown): boolean {
  if (typeof permissions === "string") {
    return GRANTS_EVERYTHING.has(permissions);
  }
  return (
    isMapping(permissions) &&
    typeof permissions.checks === "string" &&
    READS_CHECKS.has(permissions.checks)
  );
}

/**
 * Whether a job runs the third-party evidence prover.
 * @param job - One parsed job
 * @returns True when a step's `run:` names the prover
 */
function runsProver(job: WorkflowJob): boolean {
  return (
    Array.isArray(job.steps) &&
    job.steps.some(
      step =>
        isMapping(step) &&
        typeof step.run === "string" &&
        step.run.includes(PROVER)
    )
  );
}

/**
 * Read what a seeded evidence workflow does about check runs.
 *
 * The token that matters is the one the prover's job runs with: a job-level
 * `permissions:` replaces the workflow-level block for that job. When no job
 * names the prover, every job is held to it, so an edited workflow cannot pass
 * by moving the prover somewhere this reader does not look.
 * @param workflowText - Full workflow source
 * @returns What the workflow wakes on and what its token may read
 * @throws {Error} When the document is not a parseable YAML mapping
 */
export function readEvidenceSeed(workflowText: string): EvidenceSeedReading {
  const document: unknown = loadYaml(workflowText);
  if (!isMapping(document)) {
    throw new Error("the workflow is not a YAML mapping");
  }
  const workflow = document as WorkflowDocument;
  const jobs = (isMapping(workflow.jobs) ? Object.values(workflow.jobs) : [])
    .filter(isMapping)
    .map(job => job as WorkflowJob);
  const proverJobs = jobs.filter(runsProver);
  const judged = proverJobs.length > 0 ? proverJobs : jobs;
  return {
    // `on:` is YAML 1.1 truthy, so a parser may key the trigger block `true`.
    wakesOnCheckRun: wakesOnCompletedCheckRun(workflow.on ?? workflow.true),
    readsChecks:
      judged.length > 0 &&
      judged.every(job =>
        grantsChecksRead(
          job.permissions === undefined ? workflow.permissions : job.permissions
        )
      ),
  };
}

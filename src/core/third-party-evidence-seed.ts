/**
 * Does a third-party review evidence workflow wake when the reviewer reports
 * through a check run, and does it then judge that run safely?
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
 * Waking is not enough to call a copy current, so six readings are taken,
 * and a copy is current only when all six hold:
 *
 *  - it wakes on a completed check run;
 *  - the prover's job holds a token that may read check runs, statuses and
 *    pull requests — without the last, every run quietly reads as "not a pull
 *    request head";
 *  - that job takes the commit and the reviewer from the check run, because a
 *    copy that only gained the trigger passes an empty `--sha` on every check
 *    run and judges nothing;
 *  - when runs cancel each other, they are keyed on that commit and reviewer,
 *    because a key that resolves to the same string for every check run lets
 *    any app's run, on any pull request, cancel the reviewer's verdict;
 *  - it does not check out the event's head, because a `check_run` run starts
 *    in this repository's context for any pull request — a fork's included —
 *    and checking out the head would run that pull request's own code with
 *    this repository's token and cache scope;
 *  - it publishes the verdict on the head it judged, with a token that may
 *    write check runs. A `status` or `check_run` run belongs to the default
 *    branch's latest commit, so a verdict that is only the job's own
 *    conclusion never reaches the pull request (CodySwannGT/lisa#4630).
 *
 * The readings are textual and say so: they look for the event fields a copy
 * must reference, not for every spelling a copy could use to reach them.
 *
 * The question lives here, apart from both callers, because two surfaces ask
 * it: the regression guard on the shipped seeds and the doctor check that lets
 * an already-seeded repository find itself. Two spellings of "current" would
 * drift, and the drift would be silent in the direction that matters — a
 * doctor check accepting a shape the seed guard rejects.
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

/** Where a check-run event carries the commit it reports on. */
export const CHECK_RUN_HEAD = "github.event.check_run.head_sha";

/** Where a check-run event carries the reviewer's name. */
export const CHECK_RUN_NAME = "github.event.check_run.name";

/** The scopes the prover reads with: its two evidence routes and the PR. */
const PROVER_SCOPES = ["checks", "statuses", "pull-requests"] as const;

/** Scope values that include reading. */
const READS = new Set(["read", "write"]);

/** Shorthand `permissions:` values that grant every scope. */
const GRANTS_EVERYTHING = new Set(["read-all", "write-all"]);

/** Where a step's `run:` hands a saved verdict to the prover to publish. */
const PUBLISH_FLAG = "--publish=";

/**
 * An event field a checkout ref could take a commit from. The repository's
 * own fields — its default branch, for one — name no pull request's code.
 */
const EVENT_COMMIT_FIELD = /github\.event\.(?!repository\.)/u;

/** What a seeded evidence workflow does about check runs. */
export interface EvidenceSeedReading {
  /** It starts when a check run completes. */
  readonly wakesOnCheckRun: boolean;
  /** The job running the prover holds a token that may read check runs. */
  readonly readsChecks: boolean;
  /** That token may also read statuses and pull requests. */
  readonly readsStatusesAndPullRequests: boolean;
  /** That job reads the check run's head SHA and name. */
  readonly readsRunIdentity: boolean;
  /** Runs that cancel each other are keyed on the run's head and name. */
  readonly keysConcurrencyPerRun: boolean;
  /** A checkout in that job takes its ref from the triggering event. */
  readonly checksOutEventHead: boolean;
  /** A `permissions:` block governs that job at all. */
  readonly declaresPermissions: boolean;
  /** That job's token may create check runs. */
  readonly writesChecks: boolean;
  /**
   * That job saves the prover's `--json` verdict in a step with an `id`, and a
   * later step reads that step's outputs and runs the prover's `--publish`.
   */
  readonly publishesVerdict: boolean;
}

/** The slice of a workflow document this module reads. */
interface WorkflowDocument {
  readonly on?: unknown;
  readonly true?: unknown;
  readonly permissions?: unknown;
  readonly env?: unknown;
  readonly concurrency?: unknown;
  readonly jobs?: unknown;
}

/** The slice of one job this module reads. */
interface WorkflowJob {
  readonly permissions?: unknown;
  readonly env?: unknown;
  readonly concurrency?: unknown;
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
 * Whether one `permissions:` value lets the token read one scope.
 *
 * An absent block is not a grant here. It hands the token the repository's
 * default, which this file cannot see, and the remedy for "unknown" is the same
 * block the remedy for "missing" names.
 * @param permissions - A parsed `permissions:` value
 * @param scope - The scope to read
 * @returns True when the scope is readable under it
 */
function grantsRead(permissions: unknown, scope: string): boolean {
  if (typeof permissions === "string") {
    return GRANTS_EVERYTHING.has(permissions);
  }
  if (!isMapping(permissions)) return false;
  const value: unknown = permissions[scope];
  return typeof value === "string" && READS.has(value);
}

/**
 * Whether one `permissions:` value lets the token create check runs.
 * @param permissions - A parsed `permissions:` value
 * @returns True when `checks` is writable under it
 */
function grantsChecksWrite(permissions: unknown): boolean {
  if (typeof permissions === "string") return permissions === "write-all";
  return isMapping(permissions) && permissions.checks === "write";
}

/**
 * The steps of a job that YAML parsed as mappings.
 * @param job - One parsed job
 * @returns Its steps
 */
function stepsOf(job: WorkflowJob): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(job.steps) ? job.steps.filter(isMapping) : [];
}

/**
 * Whether a job runs the third-party evidence prover.
 * @param job - One parsed job
 * @returns True when a step's `run:` names the prover
 */
function runsProver(job: WorkflowJob): boolean {
  return stepsOf(job).some(
    step => typeof step.run === "string" && step.run.includes(PROVER)
  );
}

/**
 * Whether one step saves the prover's JSON verdict under an `id`.
 * @param step - One parsed step
 * @returns The step's id, or null when it saves no verdict
 */
function verdictCaptureId(step: Record<string, unknown>): string | null {
  const { id, run } = step;
  return typeof id === "string" &&
    typeof run === "string" &&
    run.includes(PROVER) &&
    run.includes("--json")
    ? id
    : null;
}

/**
 * Whether a job saves the prover's JSON verdict and then publishes it.
 *
 * Textual, like every reading here: a step with an `id` runs the prover with
 * `--json`, and a step after it reads that step's outputs and hands a saved
 * verdict to the prover's `--publish`.
 * @param job - One parsed job
 * @returns True when the verdict reaches a publish step
 */
function publishesVerdict(job: WorkflowJob): boolean {
  const steps = stepsOf(job);
  return steps.some((capture, index) => {
    const id = verdictCaptureId(capture);
    if (id === null) return false;
    return steps
      .slice(index + 1)
      .some(
        publish =>
          typeof publish.run === "string" &&
          publish.run.includes(PUBLISH_FLAG) &&
          JSON.stringify(publish).includes(`steps.${id}.outputs.`)
      );
  });
}

/**
 * Whether a text names both the check run's commit and its name.
 * @param text - Serialized workflow fragment
 * @returns True when both fields are referenced
 */
function namesRunIdentity(text: string): boolean {
  return text.includes(CHECK_RUN_HEAD) && text.includes(CHECK_RUN_NAME);
}

/**
 * Whether a job checks out a ref taken from the triggering event.
 * @param job - One parsed job
 * @returns True when a checkout step's `ref:` reads an event commit field
 */
function checksOutEventHead(job: WorkflowJob): boolean {
  return stepsOf(job).some(step => {
    const options: unknown = step.with;
    return (
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/checkout@") &&
      isMapping(options) &&
      typeof options.ref === "string" &&
      EVENT_COMMIT_FIELD.test(options.ref)
    );
  });
}

/**
 * Whether a `concurrency:` value lets one check run cancel another reviewer's.
 *
 * Without `cancel-in-progress`, runs queue rather than cancel, so the key does
 * not matter. With it, the key must name the run's commit and reviewer, or a
 * key that resolves the same for every check run lets any one cancel any other.
 * @param concurrency - A parsed `concurrency:` value, or undefined
 * @returns True when no cancellation can cross runs
 */
function keysPerRun(concurrency: unknown): boolean {
  if (!isMapping(concurrency)) return true;
  const cancels: unknown = concurrency["cancel-in-progress"];
  if (cancels === false || cancels === undefined || cancels === null) {
    return true;
  }
  return (
    typeof concurrency.group === "string" && namesRunIdentity(concurrency.group)
  );
}

/**
 * Read what a seeded evidence workflow does about check runs.
 *
 * The job that matters is the one running the prover: a job-level
 * `permissions:` replaces the workflow-level block for that job. When no job
 * names the prover, every job is held to it, so an edited workflow cannot pass
 * by moving the prover somewhere this reader does not look.
 * @param workflowText - Full workflow source
 * @returns What the workflow wakes on, what its token may read, and what it runs
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
  const permissionsOf = (job: WorkflowJob): unknown =>
    job.permissions === undefined ? workflow.permissions : job.permissions;
  const grants = (scopes: readonly string[]): boolean =>
    judged.length > 0 &&
    judged.every(job =>
      scopes.every(scope => grantsRead(permissionsOf(job), scope))
    );
  return {
    // `on:` is YAML 1.1 truthy, so a parser may key the trigger block `true`.
    wakesOnCheckRun: wakesOnCompletedCheckRun(workflow.on ?? workflow.true),
    readsChecks: grants(["checks"]),
    readsStatusesAndPullRequests: grants(
      PROVER_SCOPES.filter(scope => scope !== "checks")
    ),
    readsRunIdentity:
      judged.length > 0 &&
      judged.every(job =>
        namesRunIdentity(JSON.stringify([workflow.env, job.env, stepsOf(job)]))
      ),
    keysConcurrencyPerRun:
      keysPerRun(workflow.concurrency) &&
      judged.every(job => keysPerRun(job.concurrency)),
    checksOutEventHead: judged.some(checksOutEventHead),
    declaresPermissions:
      judged.length > 0 &&
      judged.every(job => permissionsOf(job) !== undefined),
    writesChecks:
      judged.length > 0 &&
      judged.every(job => grantsChecksWrite(permissionsOf(job))),
    publishesVerdict: judged.length > 0 && judged.every(publishesVerdict),
  };
}

/**
 * Whether a copy wakes on, can read, and safely judges the reviewer's run, and
 * publishes its verdict on the head it judged.
 * @param reading - What the copy does
 * @returns True when nothing needs to change
 */
export function isCurrentEvidenceSeed(reading: EvidenceSeedReading): boolean {
  return (
    reading.wakesOnCheckRun &&
    reading.readsChecks &&
    reading.readsStatusesAndPullRequests &&
    reading.readsRunIdentity &&
    reading.keysConcurrencyPerRun &&
    !reading.checksOutEventHead &&
    reading.writesChecks &&
    reading.publishesVerdict
  );
}

/**
 * Shared consequential-operation scanning for the B1 and B4 readiness producers
 * (PRD #1739, #1896).
 *
 * B1 ("a realistic path causes silent data loss") and B4 ("a consequential
 * operation has no gate and no recovery") ask different questions about the same
 * raw material: a command an automated pipeline runs. They therefore share one
 * definition of what counts as *automated* and what counts as *gated*, so the
 * two producers cannot drift into disagreeing about the same workflow file.
 *
 * Everything here is written to be wrong in the safe direction. These are the
 * two most false-positive-prone blockers in the rubric, and a standing blocker
 * flips the entire repository to `NOT_READY` no matter what status the finding
 * carries. So a guard this module cannot see is treated as a guard that exists:
 * a conditional step, a conditional job, a declared environment, a manual-only
 * trigger, or a reusable workflow whose caller is invisible all mean "not
 * provable from this file", and not-provable never stands a blocker.
 * @module cli/doctor-readiness-operations
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";

/** One command an automated job runs, with the file coordinates to cite it. */
export interface ScannedCommand {
  readonly workflow: string;
  readonly jobId: string;
  readonly command: string;
}

/** What one scan of a repository's workflows established. */
export interface OperationScan {
  /** Commands running in a job this file proves is automated and ungated. */
  readonly ungated: readonly ScannedCommand[];
  /** Commands running in a job something already gates. */
  readonly gated: readonly ScannedCommand[];
  /** Stated reasons a job's gating could not be settled offline. */
  readonly unresolved: readonly string[];
}

/** Optional refinements a caller layers onto a scan. */
export interface ScanOptions {
  /**
   * A job-level exemption, evaluated when a match is found. B1 uses it for a
   * job that takes its own backup first: the destructive command is real, but
   * the way back is right there in the same job.
   */
  readonly exemptJob?: (job: ParsedWorkflowJob) => boolean;
  /**
   * A workflow-level reason the match cannot be settled offline, returning
   * `null` when it can. Used for triggers that make the operation obviously
   * ephemeral — a per-pull-request teardown destroys what that same pull
   * request created, so there is nothing durable for a gate to protect.
   */
  readonly unresolvedWorkflow?: (workflow: ParsedWorkflow) => string | null;
  /**
   * A job-level reason the match cannot be settled offline, returning `null`
   * when it can. Used for a job that boots its own `services:` containers.
   */
  readonly unresolvedJob?: (job: ParsedWorkflowJob) => string | null;
  /**
   * A step-level reason the match cannot be settled offline, returning `null`
   * when it can. Used when the same job-level evidence only applies to some
   * matching commands.
   */
  readonly unresolvedStep?: (
    workflow: ParsedWorkflow,
    job: ParsedWorkflowJob,
    step: ParsedWorkflowStep
  ) => string | null;
}

/**
 * Targets that mark an operation as aimed at throwaway state — a CI database,
 * a per-pull-request preview stack, a scratch stage. A pipeline that tears down
 * what it just built is doing the correct thing, and reporting it as an ungated
 * consequential operation is the archetypal false positive for both B1 and B4.
 * Shared by both producers so they cannot drift apart on what "ephemeral" means.
 */
const EPHEMERAL_TARGETS: readonly RegExp[] = [
  /(^|[^a-z0-9])test([^a-z0-9]|$)/,
  /_test\b/,
  /-test\b/,
  /\blocalhost\b/,
  /\b127\.0\.0\.1\b/,
  /(^|[^a-z0-9])(tmp|temp)([^a-z0-9]|$)/,
  /(^|[^a-z0-9])pr-/,
  /github\.event\.number/,
  /\bpull_request\b/,
];

/**
 * Whether any text — a command, a job's `env:` block, or the two together —
 * names an obviously ephemeral target.
 * @param text - The text to screen (case is normalized here)
 * @returns True when the text names throwaway state
 */
export function looksEphemeral(text: string): boolean {
  const normalized = text.toLowerCase();
  return EPHEMERAL_TARGETS.some(pattern => pattern.test(normalized));
}

/** Local endpoints that corroborate a command targets job-owned CI state. */
const LOCAL_SERVICE_TARGETS: readonly RegExp[] = [
  /\blocalhost\b/,
  /\b127\.0\.0\.1\b/,
];

/**
 * Escape a literal string for use inside a regular expression.
 * @param value - Literal value to escape
 * @returns Regex-safe literal
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a command/env blob names the concrete service hostname.
 * @param command - Lower-cased command and environment text
 * @param service - Lower-cased service id
 * @returns True when the service appears as its own host/token
 */
function namesServiceHost(command: string, service: string): boolean {
  return new RegExp(
    `(^|[\\s:/@="'(,])${escapeRegExp(service)}($|[\\s:/;),'"?])`
  ).test(command);
}

/**
 * Whether the command plausibly targets one of the job's own `services:`
 * containers. A service only defers the step it can explain; an unrelated
 * container in the same job must not hide a durable target.
 * @param job - The job to consider
 * @param step - The step being classified
 * @returns True when the command plausibly points at a job-local service
 */
export function commandTargetsOwnedService(
  job: ParsedWorkflowJob,
  step: ParsedWorkflowStep
): boolean {
  if (job.services.length === 0) {
    return false;
  }
  const command = `${step.run}\n${job.env}`.toLowerCase();
  return (
    LOCAL_SERVICE_TARGETS.some(pattern => pattern.test(command)) ||
    job.services.some(service =>
      namesServiceHost(command, service.toLowerCase())
    )
  );
}

/**
 * Whether one command is the kind of operation a producer is looking for. The
 * job travels with the command because the evidence that settles the question
 * is often outside the command text — a job `env:` block naming a CI database,
 * for instance.
 */
export type CommandPredicate = (
  command: string,
  job: ParsedWorkflowJob
) => boolean;

/** One classified match, before the buckets are assembled. */
type ScanOutcome =
  | { readonly kind: "ungated" | "gated"; readonly command: ScannedCommand }
  | { readonly kind: "unresolved"; readonly reason: string };

/**
 * Triggers that mean the workflow does not run itself. `workflow_dispatch` puts
 * a human at the console, and `workflow_call` hides the caller from an offline
 * read — neither is a path this module may call automated.
 */
const NON_AUTOMATED_EVENTS: readonly string[] = [
  "workflow_dispatch",
  "workflow_call",
];

/**
 * Whether a workflow's declared triggers prove it runs without a human. A
 * workflow that declares no `on:` block this parser could read is treated as
 * NOT automated, because absence of a readable trigger is absence of proof.
 * @param workflow - The parsed workflow
 * @returns True when at least one trigger fires with no human in the loop
 */
export function runsUnattended(workflow: ParsedWorkflow): boolean {
  // An empty trigger list yields `false` here, which is the intended reading:
  // a workflow whose `on:` block could not be parsed proves nothing.
  return workflow.on.events.some(
    event => !NON_AUTOMATED_EVENTS.includes(event)
  );
}

/**
 * Whether anything in the file already gates this job. A declared
 * `environment:` counts even though its protection rules are unreadable
 * offline: the operator has named a deployment boundary, and calling that
 * ungated would be exactly the false positive this module exists to prevent.
 * @param job - The parsed job
 * @returns True when the job is conditional or names an environment
 */
export function jobIsGated(job: ParsedWorkflowJob): boolean {
  return job.ifCondition !== "" || job.environment.length > 0;
}

/**
 * Whether a step is individually gated — a conditional step, or a command that
 * names its own confirmation or rehearsal switch.
 * @param step - The parsed step
 * @returns True when the step carries its own guard
 */
export function stepIsGated(step: ParsedWorkflowStep): boolean {
  if (step.ifCondition !== "") {
    return true;
  }
  const command = step.run.toLowerCase();
  return (
    // `-dryrun` covers the AWS CLI's own hyphen-less spelling and the
    // double-dashed one; `--dry-run` is the GNU-style form everything else uses.
    command.includes("--dry-run") ||
    command.includes("-dryrun") ||
    command.includes("--require-approval") ||
    command.includes("inputs.confirm")
  );
}

/**
 * State the reason one job's exposure could not be settled from the file alone.
 * @param workflow - The workflow declaring the job
 * @param job - The job that matched
 * @returns One operator-language reason line
 */
function unresolvedReason(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): string {
  return (
    `\`${workflow.file}\` job \`${job.id}\` runs a consequential operation, but ` +
    "the workflow only starts from a manual dispatch or from a caller this " +
    "offline read cannot see, so whether it ever runs unattended is not " +
    "established either way"
  );
}

/**
 * Classify every matching step in one job.
 * @param workflow - The workflow declaring the job
 * @param job - The job to classify
 * @param matches - Predicate over a lower-cased `run` command
 * @param options - Scan refinements
 * @returns The classified outcomes for this job (empty when nothing matched)
 */
function classifyJob(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  matches: CommandPredicate,
  options: ScanOptions
): readonly ScanOutcome[] {
  const hits = job.steps.filter(
    step => step.run !== "" && matches(step.run.toLowerCase(), job)
  );
  if (hits.length === 0) {
    return [];
  }
  if (!runsUnattended(workflow)) {
    return [{ kind: "unresolved", reason: unresolvedReason(workflow, job) }];
  }
  const deferred =
    options.unresolvedWorkflow?.(workflow) ?? options.unresolvedJob?.(job);
  if (deferred !== undefined && deferred !== null) {
    return [{ kind: "unresolved", reason: deferred }];
  }
  const jobGated = jobIsGated(job) || (options.exemptJob?.(job) ?? false);
  return hits.map(step => {
    const stepDeferred = options.unresolvedStep?.(workflow, job, step);
    if (stepDeferred !== undefined && stepDeferred !== null) {
      return { kind: "unresolved" as const, reason: stepDeferred };
    }
    return {
      kind:
        jobGated || stepIsGated(step)
          ? ("gated" as const)
          : ("ungated" as const),
      command: { workflow: workflow.file, jobId: job.id, command: step.run },
    };
  });
}

/**
 * Scan every workflow for the commands matching a predicate, partitioned by
 * whether the file itself proves the command runs unattended and ungated.
 * @param workflows - Parsed workflows
 * @param matches - Predicate over a lower-cased `run` command
 * @param options - Scan refinements
 * @returns The partitioned scan
 */
export function scanCommands(
  workflows: readonly ParsedWorkflow[],
  matches: CommandPredicate,
  options: ScanOptions = {}
): OperationScan {
  const outcomes = workflows.flatMap(workflow =>
    workflow.jobs.flatMap(job => classifyJob(workflow, job, matches, options))
  );
  return {
    ungated: outcomes.flatMap(outcome =>
      outcome.kind === "ungated" ? [outcome.command] : []
    ),
    gated: outcomes.flatMap(outcome =>
      outcome.kind === "gated" ? [outcome.command] : []
    ),
    unresolved: outcomes.flatMap(outcome =>
      outcome.kind === "unresolved" ? [outcome.reason] : []
    ),
  };
}

/**
 * Whether the repository checks in an automation runbook — the "way back" half
 * of B1 and B4. The `automation-runbook-contract` rule puts them under
 * `.lisa/automations/*.runbook.md`; the conventional documentation homes are
 * honored as well, so a project that writes its recovery procedure somewhere
 * reasonable is never told it has none.
 * @param root - Repository root
 * @returns True when at least one runbook is checked in
 */
export async function hasCheckedInRunbook(root: string): Promise<boolean> {
  const holdsRunbooks = await Promise.all([
    directoryHolds(root, path.join(".lisa", "automations"), ".runbook.md"),
    ...["wiki/runbooks", "docs/runbooks", "runbooks"].map(
      async candidate =>
        // An EMPTY directory is not a recovery procedure. Accepting one would
        // make `mkdir runbooks` a one-command switch for turning B1 and B4 off.
        await directoryHolds(root, candidate, ".md")
    ),
  ]);
  return holdsRunbooks.includes(true);
}

/**
 * Whether a repository directory holds at least one file with a given suffix.
 * @param root - Repository root
 * @param relativePath - Repo-relative directory path
 * @param suffix - Required file-name suffix
 * @returns True when the directory exists and holds a matching file
 */
async function directoryHolds(
  root: string,
  relativePath: string,
  suffix: string
): Promise<boolean> {
  try {
    const entries = await readdir(path.join(root, ...relativePath.split("/")));
    return entries.some(entry => entry.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Render scanned commands as one evidence string, quoting the file, the job, and
 * the command so the operator can go straight to the line.
 * @param commands - The commands to cite
 * @param limit - Most commands to quote before summarizing the remainder
 * @returns One evidence string
 */
export function describeCommands(
  commands: readonly ScannedCommand[],
  limit: number
): string {
  const shown = commands.slice(0, limit);
  const overflow = commands.length - shown.length;
  const lines = shown.map(
    entry =>
      `\`${entry.workflow}\` job \`${entry.jobId}\` runs \`${entry.command}\``
  );
  return (
    lines.join(" | ") +
    (overflow > 0
      ? ` | (+${overflow} further operation(s) of the same kind)`
      : "")
  );
}

/**
 * Release-path assessment for the delivery/authority readiness dimension — ship
 * blocker B2 (PRD #1739, #1896).
 *
 * B2 asks whether the thing that ships equals the thing that was validated. The
 * question is answered offline, from the workflow files alone, which imposes a
 * hard discipline: **absence of evidence is not evidence of a bypass.** A
 * reusable `workflow_call` publish workflow has no validating job of its own
 * because validation is the caller's obligation; a `workflow_run`-triggered
 * deploy is gated by the upstream workflow that fired it; a default-branch push
 * may be gated by branch protection. None of those are visible here, so none of
 * them may be reported as a violation.
 *
 * The rule is therefore: stand B2 only when the bypass is provable from the file
 * alone — a job that self-builds AND publishes with no validating ancestor, in a
 * workflow whose trigger makes in-file validation the expected place for it
 * (a tag push, `workflow_dispatch`, `schedule`, a non-default-branch push, or an
 * unstated trigger). Everything else that cannot be settled offline returns a
 * stated-reason SKIP, never a FAIL.
 * @module cli/doctor-readiness-release-path
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";

/** Commands that put an artifact in front of users. */
const PUBLISH_VERBS = [
  "npm publish",
  "docker push",
  "gh release upload",
  "aws s3 sync",
  "cdk deploy",
  "eas submit",
];

/**
 * Commands that actually run a test suite. Deliberately narrow: the invariant B2
 * protects is "this artifact was *tested*", and a loose substring match (`echo
 * "test the release notes"`, or a lint step) would manufacture false
 * reassurance — the wrong direction to err for a gate.
 */
const VALIDATING_COMMANDS: readonly RegExp[] = [
  /\b(npm|yarn|pnpm|bun|npx|bunx)\s+(run\s+)?test\b/,
  /\btest:[\w:-]+/,
  /\b(vitest|jest|pytest|rspec|phpunit|minitest)\b/,
  /\b(go|cargo|mvn|gradle|make|dotnet)\s+test\b/,
];

/**
 * Whether a shell command runs a test suite.
 * @param run - The step's `run` text
 * @returns True when the command matches a known test invocation
 */
function isValidatingCommand(run: string): boolean {
  return VALIDATING_COMMANDS.some(pattern => pattern.test(run));
}

/** Reusable workflows whose whole purpose is validation. */
const VALIDATING_WORKFLOW = /(quality|quality-rails|test|ci)\.ya?ml/;

/** Commands that produce an artifact locally, inside the shipping job. */
const LOCAL_BUILD_COMMAND =
  /\b(npm pack|npm run build|yarn build|bun run build|bun run build:\w+|pnpm build|docker build|tsc)\b/;

/** A publish argument naming a local path rather than a registry coordinate. */
const LOCAL_PATH_ARGUMENT = /\s\.{0,2}\//;

/** A publish argument naming a packaged artifact file on disk. */
const LOCAL_ARTIFACT_FILE = /\.(tgz|tar\.gz|zip|whl)\b/;

/** The action that promotes the artifact CI already built and validated. */
export const PROMOTION_ACTION = "actions/download-artifact";

/** Branch names treated as the repository's default branch. */
const DEFAULT_BRANCHES = new Set(["main", "master"]);

/** Longest step description carried into persisted evidence. */
const MAX_STEP_LABEL = 80;

/** What assessing one publishing job established. */
export type ReleasePathOutcome =
  /** The bypass is provable from this file alone. */
  | { readonly kind: "violation"; readonly evidence: string }
  /** The proof, if any, lives somewhere not resolvable offline. */
  | { readonly kind: "unresolved"; readonly reason: string }
  /** Validation provably precedes the publish, or the artifact is promoted. */
  | { readonly kind: "clean" };

/**
 * Describe a step for persisted evidence: prefer its `name`, else the first
 * non-empty line of its `run`, truncated. A raw multi-line `run` would dump a
 * shell script into `.lisa/readiness.json` and into an operator's face.
 * @param step - The step to describe
 * @returns A single-line label, at most {@link MAX_STEP_LABEL} characters
 */
export function describeStep(step: ParsedWorkflowStep): string {
  const source =
    step.name.trim() !== ""
      ? step.name.trim()
      : (step.run
          .split("\n")
          .find(line => line.trim() !== "")
          ?.trim() ?? "");
  return source.length > MAX_STEP_LABEL
    ? `${source.slice(0, MAX_STEP_LABEL).trimEnd()}…`
    : source;
}

/**
 * Find the first step in a job that ships something.
 * @param job - The parsed job
 * @returns The publishing step, or undefined when the job ships nothing
 */
export function findPublishStep(
  job: ParsedWorkflowJob
): ParsedWorkflowStep | undefined {
  return job.steps.find(step =>
    PUBLISH_VERBS.some(verb => step.run.includes(verb))
  );
}

/**
 * Whether a job proves anything about the artifact.
 * @param job - The parsed job
 * @returns True when the job runs a test suite or calls a validating workflow
 */
function isValidatingJob(job: ParsedWorkflowJob): boolean {
  if (job.uses !== "" && VALIDATING_WORKFLOW.test(job.uses)) {
    return true;
  }
  return job.steps.some(
    step =>
      isValidatingCommand(step.run) ||
      (step.uses !== "" && VALIDATING_WORKFLOW.test(step.uses))
  );
}

/**
 * Walk a job's transitive `needs:` closure within its workflow. The `seen` list
 * makes a `needs:` cycle terminate instead of recursing forever.
 * @param workflow - The workflow declaring the job
 * @param job - The job whose ancestors to resolve
 * @returns Every job the given job transitively depends on
 */
function ancestorJobs(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly ParsedWorkflowJob[] {
  const byId = new Map(workflow.jobs.map(entry => [entry.id, entry]));
  const walk = (
    ids: readonly string[],
    seen: readonly string[]
  ): readonly ParsedWorkflowJob[] => {
    const fresh = ids.filter(id => !seen.includes(id));
    if (fresh.length === 0) {
      return [];
    }
    const jobs = fresh.flatMap(id => {
      const ancestor = byId.get(id);
      return ancestor ? [ancestor] : [];
    });
    return [
      ...jobs,
      ...walk(
        jobs.flatMap(ancestor => ancestor.needs),
        [...seen, ...fresh]
      ),
    ];
  };
  return walk(job.needs, []);
}

/**
 * Whether validation provably precedes the publish: either an ancestor job
 * validated, or a step earlier in this same job did.
 * @param workflow - The workflow declaring the job
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @returns True when something was proved before the artifact left
 */
function validationPrecedesPublish(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep
): boolean {
  if (ancestorJobs(workflow, job).some(isValidatingJob)) {
    return true;
  }
  return job.steps
    .slice(0, job.steps.indexOf(publishStep))
    .some(step => isValidatingCommand(step.run));
}

/**
 * Whether the job ships an artifact it produced itself rather than promoting the
 * one CI built and validated. Downloading the CI artifact only exempts the job
 * when nothing rebuilds *after* the download — a rebuild past the promotion is
 * the very bypass B2 exists to catch.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @returns True when a self-built artifact is shipped
 */
function shipsSelfBuiltArtifact(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep
): boolean {
  const downloadIndex = job.steps.findIndex(step =>
    step.uses.includes(PROMOTION_ACTION)
  );
  const rebuildsAfterDownload = job.steps
    .slice(downloadIndex + 1)
    .some(step => LOCAL_BUILD_COMMAND.test(step.run));
  if (downloadIndex >= 0 && !rebuildsAfterDownload) {
    return false;
  }
  return (
    LOCAL_PATH_ARGUMENT.test(publishStep.run) ||
    LOCAL_ARTIFACT_FILE.test(publishStep.run) ||
    job.steps.some(step => LOCAL_BUILD_COMMAND.test(step.run))
  );
}

/**
 * Decide whether a workflow's trigger makes in-file validation the expected
 * place for it — the only case where absent validation proves a bypass.
 * @param workflow - The workflow to classify
 * @returns The reason validation may live elsewhere, or null when it must be here
 */
function offlineUnresolvableTrigger(workflow: ParsedWorkflow): string | null {
  const events = workflow.on.events;
  if (events.length > 0 && events.every(event => event === "workflow_call")) {
    return (
      "it is a reusable `workflow_call` workflow, so validation is the calling " +
      "workflow's obligation and callers are not resolved offline"
    );
  }
  if (events.includes("workflow_run")) {
    return (
      "it is triggered by `workflow_run`, so the validating workflow that fired " +
      "it runs upstream and is not resolved offline"
    );
  }
  if (events.includes("release")) {
    return (
      "it is triggered by a `release` event, so validation may have run on the " +
      "commit or tag the release was cut from, which is not visible in this file"
    );
  }
  const defaultBranchPush = workflow.on.pushBranches.some(branch =>
    DEFAULT_BRANCHES.has(branch)
  );
  if (defaultBranchPush) {
    return (
      "it is triggered by a push to the default branch, where branch protection " +
      "may already require the validating checks — a rule that is not visible " +
      "in this file"
    );
  }
  return null;
}

/**
 * Assess one job's release path against B2.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @returns What this job established, or undefined when it ships nothing
 */
export function assessReleasePath(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): ReleasePathOutcome | undefined {
  const publishStep = findPublishStep(job);
  if (!publishStep) {
    return undefined;
  }
  const where = `${workflow.file} job \`${job.id}\` step \`${describeStep(publishStep)}\``;
  if (
    validationPrecedesPublish(workflow, job, publishStep) ||
    !shipsSelfBuiltArtifact(job, publishStep)
  ) {
    return { kind: "clean" };
  }
  const unresolvable = offlineUnresolvableTrigger(workflow);
  if (unresolvable !== null) {
    return {
      kind: "unresolved",
      reason:
        `${where} builds and ships its own artifact with no validating job in ` +
        `its \`needs:\` closure, but ${unresolvable}. Whether what ships equals ` +
        "what was validated is therefore not established either way",
    };
  }
  return {
    kind: "violation",
    evidence:
      `${where} builds its own artifact and ships it with no validating job in ` +
      `its \`needs:\` closure and no \`${PROMOTION_ACTION}\` promotion of the ` +
      "CI-built one — nothing was proved about the bytes that reached users",
  };
}

/**
 * Release-path assessment for the delivery/authority readiness dimension — ship
 * blocker B2 (PRD #1739, #1896).
 * @module cli/doctor-readiness-release-path
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";

const PUBLISH_VERBS = [
  "npm publish",
  "docker push",
  "gh release upload",
  "aws s3 sync",
  "cdk deploy",
  "eas submit",
];

const DOCKER_BUILD_PUSH_ACTION = "docker/build-push-action";
const PYPI_PUBLISH_ACTION = "pypa/gh-action-pypi-publish";
const GITHUB_RELEASE_ACTION = "softprops/action-gh-release";

/** Commands that actually run a test suite. */
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
const LOCAL_BUILD_COMMANDS: readonly RegExp[] = [
  /\b(npm pack|npm run build|yarn build|bun run build|bun run build:\w+|pnpm build|docker build|tsc)\b/,
];

/**
 * Whether a templated package manager expression runs the standard build script.
 * @param run - The step's `run` text
 * @returns True for commands like `${{ inputs.package_manager }} run build`
 */
function isTemplatedPackageManagerBuild(run: string): boolean {
  const lower = run.toLowerCase();
  const scan = (cursor: number): boolean => {
    const start = lower.indexOf("${{", cursor);
    if (start < 0) {
      return false;
    }
    const end = lower.indexOf("}}", start + 3);
    if (end < 0) {
      return false;
    }
    const expression = lower.slice(start + 3, end);
    const tail = lower.slice(end + 2).trimStart();
    if (
      (expression.includes("package_manager") ||
        expression.includes("package-manager")) &&
      /^run\s+build(?:\s|$)/.test(tail)
    ) {
      return true;
    }
    return scan(end + 2);
  };
  return scan(0);
}

/**
 * Whether a command builds an artifact inside the shipping job.
 * @param run - The step's `run` text
 * @returns True when the command matches a known local build invocation
 */
function isLocalBuildCommand(run: string): boolean {
  return (
    LOCAL_BUILD_COMMANDS.some(pattern => pattern.test(run)) ||
    isTemplatedPackageManagerBuild(run)
  );
}

const LOCAL_PATH_ARGUMENT = /\s\.{0,2}\//;

const LOCAL_ARTIFACT_FILE = /\.(tgz|tar\.gz|zip|whl)\b/;

export const PROMOTION_ACTION = "actions/download-artifact";

const DEFAULT_BRANCHES = new Set(["main", "master"]);

const MAX_STEP_LABEL = 80;

/** What assessing one publishing step established. */
export type ReleasePathOutcome =
  | { readonly kind: "violation"; readonly evidence: string }
  | { readonly kind: "unresolved"; readonly reason: string }
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
          ?.trim() ?? step.uses.trim());
  return source.length > MAX_STEP_LABEL
    ? `${source.slice(0, MAX_STEP_LABEL).trimEnd()}…`
    : source;
}

/**
 * A rehearsal flag: the command goes through the motions and ships nothing.
 */
const DRY_RUN_FLAG = /--dry[-_]?run\b/;

/**
 * Normalize an action reference to its owner/repo component.
 * @param uses - Raw `uses:` value
 * @returns Lowercase action id without an `@ref`
 */
function actionId(uses: string): string {
  return (uses.split("@")[0] ?? "").trim().toLowerCase();
}

/**
 * Whether a serialized `with:` block sets a boolean option to true.
 * @param inputs - Flattened step inputs
 * @param name - Input name to read
 * @returns True when the option is explicitly true
 */
function hasTrueInput(inputs: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)${escaped}:\\s*['"]?true['"]?(\\s|$)`, "i").test(
    inputs
  );
}

/**
 * Whether an action step publishes something externally.
 * @param step - The step to classify
 * @returns True when the action is a known publishing action
 */
function isPublishAction(step: ParsedWorkflowStep): boolean {
  const id = actionId(step.uses);
  if (id === DOCKER_BUILD_PUSH_ACTION) {
    return hasTrueInput(step.inputs, "push");
  }
  return id === PYPI_PUBLISH_ACTION || id === GITHUB_RELEASE_ACTION;
}

/**
 * Whether a step actually puts an artifact in front of users. A `--dry-run`
 * invocation names a publish verb but ships nothing, so faulting its release
 * path would be a finding about something that cannot reach anyone.
 * @param step - The step to classify
 * @returns True when the step really publishes
 */
function isPublishStep(step: ParsedWorkflowStep): boolean {
  return (
    (PUBLISH_VERBS.some(verb => step.run.includes(verb)) &&
      !DRY_RUN_FLAG.test(step.run)) ||
    isPublishAction(step)
  );
}

/**
 * Find every step in a job that ships something.
 * @param job - The parsed job
 * @returns The publishing steps, in execution order
 */
export function findPublishSteps(
  job: ParsedWorkflowJob
): readonly ParsedWorkflowStep[] {
  return job.steps.filter(isPublishStep);
}

/**
 * Find the first step in a job that ships something.
 * @param job - The parsed job
 * @returns The first publishing step, or undefined when the job ships nothing
 */
export function findPublishStep(
  job: ParsedWorkflowJob
): ParsedWorkflowStep | undefined {
  return findPublishSteps(job)[0];
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
  if (actionId(publishStep.uses) === DOCKER_BUILD_PUSH_ACTION) {
    return true;
  }
  const publishIndex = job.steps.indexOf(publishStep);
  const stepsThroughPublish = job.steps.slice(0, publishIndex + 1);
  const downloadIndex = job.steps
    .slice(0, publishIndex)
    .reduce(
      (latest, step, index) =>
        step.uses.includes(PROMOTION_ACTION) ? index : latest,
      -1
    );
  if (downloadIndex >= 0) {
    const rebuildsAfterDownload = stepsThroughPublish
      .slice(downloadIndex + 1)
      .some(step => isLocalBuildCommand(step.run));
    if (!rebuildsAfterDownload) {
      return false;
    }
  }
  return (
    LOCAL_PATH_ARGUMENT.test(publishStep.run) ||
    LOCAL_ARTIFACT_FILE.test(publishStep.run) ||
    stepsThroughPublish.some(step => isLocalBuildCommand(step.run))
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
  // An unfiltered `on: [push]` is a SUPERSET of a default-branch push, so it
  // cannot be treated more strictly than the spelling that names the branch.
  const unfilteredPush =
    workflow.on.events.includes("push") &&
    workflow.on.pushBranches.length === 0 &&
    workflow.on.pushTags.length === 0;
  const defaultBranchPush = workflow.on.pushBranches.some(branch =>
    DEFAULT_BRANCHES.has(branch)
  );
  if (unfilteredPush || defaultBranchPush) {
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
  return assessReleasePaths(workflow, job)[0];
}

/**
 * Assess every publishing step in one job against B2.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @returns One outcome per publishing step, or an empty list when it ships nothing
 */
export function assessReleasePaths(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly ReleasePathOutcome[] {
  return findPublishSteps(job).map(publishStep => {
    const where = `${workflow.file} job \`${job.id}\` step \`${describeStep(publishStep)}\``;
    const validated = validationPrecedesPublish(workflow, job, publishStep);
    if (shipsSelfBuiltArtifact(job, publishStep)) {
      return validated
        ? rebuildPastValidation(where)
        : unvalidatedSelfBuild(where, workflow);
    }
    if (validated || promotesValidatedArtifact(job, publishStep)) {
      return { kind: "clean" };
    }
    // Neither built here nor promoted from CI, and nothing validating precedes it:
    // the link between what ships and what was validated is simply not observable
    // in this file. That is unestablished, not clean.
    return {
      kind: "unresolved",
      reason:
        `${where} neither builds its own artifact nor promotes a CI-built one via ` +
        `\`${PROMOTION_ACTION}\`, and no validating job precedes it, so what it ` +
        "ships cannot be tied to anything that was validated",
    };
  });
}

/**
 * The provable bypass that survives every trigger: the pipeline validated the
 * source, then the release job rebuilt and shipped its own artifact. Whatever
 * ran upstream, the bytes that reached users are not the bytes that were
 * checked — so no trigger exempts this.
 * @param where - Evidence location label
 * @returns The violation outcome
 */
function rebuildPastValidation(where: string): ReleasePathOutcome {
  return {
    kind: "violation",
    evidence:
      `${where} rebuilds and ships its own artifact after validation ran — the ` +
      "pipeline proved things about the source tree, then shipped bytes that " +
      `were produced afterwards and never validated. Promote the CI-built ` +
      `artifact via \`${PROMOTION_ACTION}\` instead of repacking at release time`,
  };
}

/**
 * A self-built, self-shipped artifact with nothing validating in front of it:
 * a violation when the trigger makes in-file validation the expected place, and
 * a stated-reason SKIP when the proof could live somewhere not visible offline.
 * @param where - Evidence location label
 * @param workflow - The workflow declaring the job
 * @returns The violation or unresolved outcome
 */
function unvalidatedSelfBuild(
  where: string,
  workflow: ParsedWorkflow
): ReleasePathOutcome {
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

/**
 * Whether the job promotes the artifact CI already built and validated.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @returns True when a download-artifact step is present
 */
function promotesValidatedArtifact(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep
): boolean {
  return job.steps
    .slice(0, job.steps.indexOf(publishStep))
    .some(step => step.uses.includes(PROMOTION_ACTION));
}

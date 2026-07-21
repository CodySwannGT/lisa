/**
 * The delivery/authority readiness producer — ship blockers B2 and B3
 * (PRD #1739, #1896).
 *
 * Dimension 7 of the `readiness-rubric` asks two questions no other dimension
 * can answer: does the thing that ships equal the thing that was validated
 * (B2), and does the shipping credential carry only the authority it needs
 * (B3)? Both are answered offline from the repository's own
 * `.github/workflows/*.yml` declarations — the release path is a property of
 * what CI declares, so no network call is needed and none is made.
 *
 * B2 stands when a job that publishes or deploys either (a) has no ancestor in
 * its `needs:` closure that validates anything, so nothing was proved before the
 * artifact left the building, or (b) ships an artifact it built itself instead
 * of promoting the one CI validated. Both are the same failure in different
 * clothes: what shipped is not what was checked.
 *
 * Discipline that is load-bearing rather than stylistic: a finding names a
 * `blocker` id ONLY on an actual violation. The blocker engine stands a blocker
 * up on any finding that names an id and carries evidence, regardless of the
 * finding's status — so a clean repository's PASS finding must carry no
 * `blocker` key, or a healthy repository would be reported NOT_READY.
 * @module cli/doctor-readiness-delivery
 */
import { detectCredentialViolations } from "./doctor-readiness-credentials.js";
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";
import {
  type ParsedWorkflow,
  type ParsedWorkflowJob,
  type ParsedWorkflowStep,
  parseRepositoryWorkflows,
} from "./doctor-readiness-workflows.js";

/** The delivery/authority readiness dimension id (readiness-rubric, RRR-1). */
export const DELIVERY_AUTHORITY_DIMENSION_ID = "delivery-authority";

/** The ship blocker for a release path that bypasses the validated artifact. */
const RELEASE_BLOCKER_ID = "B2";

/** The ship blocker for credentials carrying material unintended authority. */
const CREDENTIAL_BLOCKER_ID = "B3";

/** Commands that put an artifact in front of users. */
const PUBLISH_VERBS = [
  "npm publish",
  "docker push",
  "gh release upload",
  "aws s3 sync",
  "cdk deploy",
  "eas submit",
];

/** Commands that prove something about the artifact before it ships. */
const VALIDATING_COMMAND =
  /\b(test|tests|lint|typecheck|type-check|tsc|vitest|jest|pytest|rspec|quality)\b/;

/** Reusable workflows whose whole purpose is validation. */
const VALIDATING_WORKFLOW = /(quality|quality-rails|test|ci)\.ya?ml/;

/** Commands that produce an artifact locally, inside the shipping job. */
const LOCAL_BUILD_COMMAND =
  /\b(npm pack|npm run build|yarn build|bun run build|pnpm build|docker build|tsc)\b/;

/** A publish argument naming a local path rather than a registry coordinate. */
const LOCAL_PATH_ARGUMENT = /\s\.{0,2}\//;

/** A publish argument naming a packaged artifact file on disk. */
const LOCAL_ARTIFACT_FILE = /\.(tgz|tar\.gz|zip|whl)\b/;

/** The action that promotes the artifact CI already built and validated. */
const PROMOTION_ACTION = "actions/download-artifact";

/**
 * Find the first step in a job that ships something.
 * @param job - The parsed job
 * @returns The publishing step, or undefined when the job ships nothing
 */
function findPublishStep(
  job: ParsedWorkflowJob
): ParsedWorkflowStep | undefined {
  return job.steps.find(step =>
    PUBLISH_VERBS.some(verb => step.run.includes(verb))
  );
}

/**
 * Whether a job proves anything about the artifact.
 * @param job - The parsed job
 * @returns True when the job runs a validating command or calls a quality workflow
 */
function isValidatingJob(job: ParsedWorkflowJob): boolean {
  if (job.uses !== "" && VALIDATING_WORKFLOW.test(job.uses)) {
    return true;
  }
  return job.steps.some(
    step =>
      VALIDATING_COMMAND.test(step.run) ||
      (step.uses !== "" && VALIDATING_WORKFLOW.test(step.uses))
  );
}

/**
 * Walk a job's transitive `needs:` closure within its workflow.
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
  const publishIndex = job.steps.indexOf(publishStep);
  return job.steps
    .slice(0, publishIndex)
    .some(step => VALIDATING_COMMAND.test(step.run));
}

/**
 * Whether the job ships an artifact it produced itself rather than promoting
 * the one CI built and validated.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @returns True when a self-built artifact is shipped
 */
function shipsSelfBuiltArtifact(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep
): boolean {
  if (job.steps.some(step => step.uses.includes(PROMOTION_ACTION))) {
    return false;
  }
  return (
    LOCAL_PATH_ARGUMENT.test(publishStep.run) ||
    LOCAL_ARTIFACT_FILE.test(publishStep.run) ||
    job.steps.some(step => LOCAL_BUILD_COMMAND.test(step.run))
  );
}

/**
 * Assess one publishing job against B2.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @returns Evidence lines for this job (empty when the release path is sound)
 */
function releasePathViolations(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly string[] {
  const publishStep = findPublishStep(job);
  if (!publishStep) {
    return [];
  }
  const where = `${workflow.file} job \`${job.id}\` step \`${publishStep.run}\``;
  return [
    ...(validationPrecedesPublish(workflow, job, publishStep)
      ? []
      : [
          `${where} ships without any validating job in its \`needs:\` closure ` +
            "— nothing was proved about this artifact before it reached users",
        ]),
    ...(shipsSelfBuiltArtifact(job, publishStep)
      ? [
          `${where} ships an artifact built inside the shipping job instead of ` +
            `promoting the CI-built one via \`${PROMOTION_ACTION}\` — what ` +
            "shipped is not the bytes CI validated",
        ]
      : []),
  ];
}

/**
 * Build the B2 finding from its evidence lines.
 * @param violations - Evidence lines
 * @returns The rubric-shaped B2 finding
 */
function releaseFinding(
  violations: readonly string[]
): Record<string, unknown> {
  return {
    blocker: RELEASE_BLOCKER_ID,
    invariant_violated:
      "what ships to users is the exact artifact the validating pipeline checked",
    evidence: violations.join(" | "),
    why_proof_missed:
      "the existing checks prove things about the source tree, not about the " +
      "artifact the release path actually hands to users, so a release that " +
      "skips or rebuilds past them still reports green",
    root_correction:
      "make the release job depend on the validating jobs and publish only an " +
      `artifact downloaded via \`${PROMOTION_ACTION}\`, so the validated bytes ` +
      "are the only bytes that can ship",
    machinery_to_remove: [
      "any rebuild step inside the release job, which exists only because the " +
        "validated artifact was not carried forward",
    ],
  };
}

/**
 * Build the B3 finding from its evidence lines.
 * @param violations - Evidence lines
 * @returns The rubric-shaped B3 finding
 */
function credentialFinding(
  violations: readonly string[]
): Record<string, unknown> {
  return {
    blocker: CREDENTIAL_BLOCKER_ID,
    invariant_violated:
      "a shipping credential carries only the authority the job it runs needs",
    evidence: violations.join(" | "),
    why_proof_missed:
      "credential scope is declared, never exercised, so no test or review run " +
      "observes the unused authority a workflow silently carries",
    root_correction:
      "declare a minimal job-level `permissions:` block, map secrets explicitly " +
      "per environment instead of inheriting them, and prefer keyless OIDC over " +
      "long-lived static keys",
    machinery_to_remove: [
      "blanket permission grants and inherited secret blocks made unnecessary " +
        "by explicit per-job scoping",
    ],
  };
}

/**
 * Build the clean record. It deliberately carries evidence of what was checked
 * but names no `blocker` — naming one here would stand the blocker up.
 * @param workflows - Parsed workflows
 * @returns The PASS dimension record
 */
function cleanRecord(
  workflows: readonly ParsedWorkflow[]
): ReadinessDimensionRecord {
  const jobCount = workflows.reduce(
    (total, workflow) => total + workflow.jobs.length,
    0
  );
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "PASS",
    findings: [
      {
        evidence:
          `Assessed ${jobCount} job(s) across ${workflows.length} workflow ` +
          "file(s): every publishing job is preceded by validation and promotes " +
          "the CI-built artifact, and no workflow declares blanket permissions, " +
          "inherited secrets, cross-environment secret reuse, or static cloud keys.",
        checked: [RELEASE_BLOCKER_ID, CREDENTIAL_BLOCKER_ID],
      },
    ],
  };
}

/**
 * Assess the delivery/authority dimension: B2 (release path bypasses the
 * validated artifact) and B3 (credentials carry unintended authority). Offline
 * by construction — it reads only the repository's declared workflows.
 * @param root - Project root to assess
 * @param parsedWorkflows - Pre-parsed workflows (default: parse `root`)
 * @returns The delivery/authority dimension record
 */
export async function assessDeliveryAuthorityDimension(
  root: string,
  parsedWorkflows?: readonly ParsedWorkflow[]
): Promise<ReadinessDimensionRecord> {
  const workflows = parsedWorkflows ?? (await parseRepositoryWorkflows(root));
  if (workflows.length === 0) {
    return {
      id: DELIVERY_AUTHORITY_DIMENSION_ID,
      status: "SKIP",
      findings: [
        {
          reason:
            "no .github/workflows/*.yml files were found, so this repository " +
            "declares no release path or shipping credential to assess; " +
            "delivery authority is not established either way",
          skip: true,
        },
      ],
    };
  }
  const releaseViolations = workflows.flatMap(workflow =>
    workflow.jobs.flatMap(job => releasePathViolations(workflow, job))
  );
  const credentialViolations = detectCredentialViolations(workflows);
  if (releaseViolations.length === 0 && credentialViolations.length === 0) {
    return cleanRecord(workflows);
  }
  // Ordered by consequence: shipping unvalidated bytes outranks over-broad
  // authority, because it is already user-visible rather than latent.
  return {
    id: DELIVERY_AUTHORITY_DIMENSION_ID,
    status: "FAIL",
    findings: [
      ...(releaseViolations.length > 0
        ? [releaseFinding(releaseViolations)]
        : []),
      ...(credentialViolations.length > 0
        ? [credentialFinding(credentialViolations)]
        : []),
    ],
  };
}

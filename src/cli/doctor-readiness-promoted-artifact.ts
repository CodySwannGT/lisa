/**
 * Promoted-artifact checks shared by delivery/authority readiness.
 * @module cli/doctor-readiness-promoted-artifact
 */
import type {
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";
import type { ReleasePathOutcome } from "./doctor-readiness-release-path.js";

/** The GitHub Actions promotion step Lisa recognizes for CI-built artifacts. */
export const PROMOTION_ACTION = "actions/download-artifact";
const DOCKER_BUILD_PUSH_ACTION = "docker/build-push-action";
const GITHUB_RELEASE_ACTION = "softprops/action-gh-release";
const PYPI_PUBLISH_ACTION = "pypa/gh-action-pypi-publish";
const UPLOAD_ARTIFACT_ACTION = "actions/upload-artifact";

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
export function isPublishAction(step: ParsedWorkflowStep): boolean {
  const id = actionId(step.uses);
  if (id === DOCKER_BUILD_PUSH_ACTION) {
    return hasTrueInput(step.inputs, "push");
  }
  return id === PYPI_PUBLISH_ACTION || id === GITHUB_RELEASE_ACTION;
}

/**
 * Whether an action reference is the trusted artifact-promotion action.
 * @param uses - Raw action reference
 * @returns True when the action id is exactly actions/download-artifact
 */
export function isPromotionAction(uses: string): boolean {
  return actionId(uses) === PROMOTION_ACTION;
}

/**
 * Whether an action reference uploads an artifact produced by CI.
 * @param uses - Raw action reference
 * @returns True when the action id is exactly actions/upload-artifact
 */
function isUploadAction(uses: string): boolean {
  return actionId(uses) === UPLOAD_ARTIFACT_ACTION;
}

/**
 * Read a scalar step input from the parser's flattened `with:` text.
 * @param inputs - Flattened step inputs
 * @param name - Input name to read
 * @returns The input value, or null when absent
 */
function stepInput(inputs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)${escaped}:\\s*(.+)(\\n|$)`).exec(inputs);
  const value = match?.[2]?.trim();
  if (value === undefined || value === "") {
    return null;
  }
  return value.replace(/^['"]|['"]$/g, "");
}

/**
 * List artifact names uploaded by jobs whose outputs have already been validated.
 * @param validatingAncestorJobs - Validating jobs in the publishing job's `needs:` closure
 * @returns Uploaded artifact names
 */
function uploadedArtifactNames(
  validatingAncestorJobs: readonly ParsedWorkflowJob[]
): Set<string> {
  return new Set(
    validatingAncestorJobs.flatMap(job =>
      job.steps
        .filter(step => isUploadAction(step.uses))
        .map(step => stepInput(step.inputs, "name"))
        .filter((name): name is string => name !== null)
    )
  );
}

/**
 * Whether the job promotes an artifact produced by another job.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @param ancestorJobs - Jobs in the publishing job's `needs:` closure
 * @returns True when a download-artifact step is present before publication
 */
export function promotesValidatedArtifact(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep,
  ancestorJobs: readonly ParsedWorkflowJob[] = []
): boolean {
  const uploads = uploadedArtifactNames(ancestorJobs);
  return job.steps.slice(0, job.steps.indexOf(publishStep)).some(step => {
    if (!isPromotionAction(step.uses)) {
      return false;
    }
    const downloadName = stepInput(step.inputs, "name");
    return (
      downloadName === null || uploads.size === 0 || uploads.has(downloadName)
    );
  });
}

/**
 * Whether a named artifact download disagrees with named ancestor uploads.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @param ancestorJobs - Jobs in the publishing job's `needs:` closure
 * @returns True when the downloaded artifact name is not uploaded by any ancestor
 */
export function hasArtifactNameMismatch(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep,
  ancestorJobs: readonly ParsedWorkflowJob[]
): boolean {
  const uploads = uploadedArtifactNames(ancestorJobs);
  return job.steps.slice(0, job.steps.indexOf(publishStep)).some(step => {
    if (!isPromotionAction(step.uses)) {
      return false;
    }
    const downloadName = stepInput(step.inputs, "name");
    return downloadName !== null && !uploads.has(downloadName);
  });
}

/**
 * The release job downloaded a named artifact different from anything a
 * validating ancestor uploaded, so the shipped bytes are not the tested bytes.
 * @param where - Evidence location label
 * @returns The violation outcome
 */
export function artifactNameMismatch(where: string): ReleasePathOutcome {
  return {
    kind: "violation",
    evidence:
      `${where} downloads a named artifact that no validating ancestor uploads, ` +
      "so the release path cannot prove the shipped artifact is the one CI tested",
  };
}

/**
 * A downloaded artifact without linked validation is unestablished, not clean.
 * @param where - Evidence location label
 * @returns The unresolved outcome
 */
export function unresolvedPromotedArtifact(where: string): ReleasePathOutcome {
  return {
    kind: "unresolved",
    reason:
      `${where} promotes an artifact via \`${PROMOTION_ACTION}\`, but no ` +
      "validating job precedes it in this workflow or resolved caller chain, so " +
      "the downloaded artifact cannot be tied to anything that was validated",
  };
}

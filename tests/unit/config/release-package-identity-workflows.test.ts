/**
 * @file release-package-identity-workflows.test.ts
 * @description Structural contract for one immutable release identity
 * @module tests/unit/config/release-package-identity-workflows.test
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Minimal workflow step fields exercised by this contract. */
interface WorkflowStep {
  /** Stable output identifier. */
  id?: string;
  /** Human-readable step name. */
  name?: string;
  /** Shell body. */
  run?: string;
  /** Referenced action. */
  uses?: string;
  /** Action arguments. */
  with?: Record<string, unknown>;
}

/** Minimal workflow job fields exercised by this contract. */
interface WorkflowJob {
  /** Values exposed to dependent jobs. */
  outputs?: Record<string, string>;
  /** Ordered workflow steps. */
  steps?: WorkflowStep[];
  /** Reusable-workflow inputs. */
  with?: Record<string, unknown>;
}

/** Parsed subset of a reusable GitHub Actions workflow. */
interface WorkflowDocument {
  /** Reusable-workflow trigger contract. */
  on?: {
    /** workflow_call input and output schema. */
    workflow_call?: {
      /** Callable workflow inputs. */
      inputs?: Record<string, Record<string, unknown>>;
      /** Callable workflow outputs. */
      outputs?: Record<string, Record<string, unknown>>;
    };
  };
  /** Jobs keyed by identifier. */
  jobs: Record<string, WorkflowJob>;
}

/**
 * Parse one checked-in workflow through the same YAML boundary GitHub consumes.
 * @param fileName - Workflow file name
 * @returns Parsed workflow document
 */
async function readWorkflow(fileName: string): Promise<WorkflowDocument> {
  return yaml.load(
    await readFile(
      path.join(REPOSITORY_ROOT, ".github", "workflows", fileName),
      "utf8"
    )
  ) as WorkflowDocument;
}

/**
 * Find a named step and fail the test clearly when it is absent.
 * @param job - Workflow job to search
 * @param name - Exact step name
 * @returns Matching workflow step
 */
function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps?.find(candidate => candidate.name === name);
  expect(step, `missing workflow step: ${name}`).toBeDefined();
  return step ?? {};
}

describe("release package identity workflow", () => {
  it("ships the exact validator read by the package workflow to consumers", async () => {
    const rootValidator = await readFile(
      path.join(
        REPOSITORY_ROOT,
        "scripts",
        "check-release-package-identity.mjs"
      ),
      "utf8"
    );
    const deliveredValidator = await readFile(
      path.join(
        REPOSITORY_ROOT,
        "all",
        "copy-overwrite",
        "scripts",
        "check-release-package-identity.mjs"
      ),
      "utf8"
    );

    expect(deliveredValidator).toBe(rootValidator);
  });

  it("exports the pushed release commit and targets tags and releases to it", async () => {
    const release = await readWorkflow("release.yml");
    const releaseCommit = namedStep(
      release.jobs.version,
      "Resolve immutable release commit"
    );
    const releaseCommitRun = releaseCommit.run ?? "";

    expect(release.on?.workflow_call?.outputs?.release_commit?.value).toBe(
      "${{ jobs.version.outputs.release_commit }}"
    );
    expect(release.jobs.version.outputs?.release_commit).toBe(
      "${{ steps.release_commit.outputs.sha }}"
    );
    expect(releaseCommit.id).toBe("release_commit");
    expect(releaseCommitRun).toContain('git rev-parse "HEAD^{commit}"');
    expect(releaseCommitRun).toContain(
      'git rev-parse "origin/$target_ref^{commit}"'
    );
    expect(releaseCommitRun).toContain(
      'if [ "$release_commit" != "$remote_commit" ]'
    );
    expect(releaseCommitRun).toContain(
      'echo "sha=$release_commit" >> "$GITHUB_OUTPUT"'
    );

    const signingCheckout = release.jobs.release_signing.steps?.find(
      step => step.uses === "actions/checkout@v6"
    );
    expect(signingCheckout?.with?.ref).toBe(
      "${{ needs.version.outputs.release_commit }}"
    );

    const createRelease = namedStep(
      release.jobs.github_release,
      "Create GitHub Release"
    ).run;
    expect(createRelease).toContain(
      '--arg target "${{ needs.version.outputs.release_commit }}"'
    );
    expect(createRelease).toContain(
      '[ "$TARGET" != "${{ needs.version.outputs.release_commit }}" ]'
    );
    expect(createRelease).not.toContain('--arg target "${{ github.sha }}"');
  });

  it("requires the exact release commit and establishes version before build", async () => {
    const deploy = await readWorkflow("deploy.yml");
    const publish = await readWorkflow("publish-to-npm.yml");
    const publishJob = publish.jobs.publish;
    const steps = publishJob.steps ?? [];

    expect(deploy.jobs.publish_npm.with?.release_commit).toBe(
      "${{ needs.release.outputs.release_commit }}"
    );
    expect(publish.on?.workflow_call?.inputs?.release_commit).toMatchObject({
      required: true,
      type: "string",
    });

    const checkoutIdentity = namedStep(
      publishJob,
      "Validate checked-out release identity"
    );
    expect(checkoutIdentity.run).toContain(
      "node scripts/check-release-package-identity.mjs checkout"
    );
    expect(checkoutIdentity.run).toContain(
      '--release-commit "${{ inputs.release_commit }}"'
    );

    const updateIndex = steps.findIndex(
      step => step.name === "Update package version"
    );
    const buildIndex = steps.findIndex(step => step.name === "Build package");
    const packIndex = steps.findIndex(
      step => step.name === "Pack and validate release candidate"
    );
    const publishIndex = steps.findIndex(
      step => step.name === "Publish to npm with OIDC"
    );

    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(updateIndex);
    expect(packIndex).toBeGreaterThan(buildIndex);
    expect(publishIndex).toBeGreaterThan(packIndex);
    const stampReleaseCommit =
      namedStep(publishJob, "Stamp immutable release commit").run ?? "";
    expect(stampReleaseCommit).toContain(
      'RELEASE_COMMIT="${{ inputs.release_commit }}"'
    );
    expect(stampReleaseCommit).toContain(
      'npm pkg set lisaReleaseCommit="$RELEASE_COMMIT"'
    );
    expect(stampReleaseCommit).toContain(
      'npm pkg set gitHead="$RELEASE_COMMIT"'
    );
    expect(namedStep(publishJob, "Publish to npm with OIDC").run).toContain(
      'npm publish "${{ steps.release_package.outputs.tarball }}"'
    );
  });
});

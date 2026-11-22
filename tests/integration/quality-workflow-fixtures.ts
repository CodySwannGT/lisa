/**
 * Shared fixtures for the reusable-workflow contract suites: repo-relative
 * workflow paths, the parsed-YAML shapes they assert on, and small helpers.
 * @module tests/integration/quality-workflow-fixtures
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const GITHUB_WORKFLOWS_PARTS = [".github", "workflows"] as const;
export const CREATE_ONLY_DIR = "create-only";
const WORKFLOWS_DIR = path.join(REPO_ROOT, ...GITHUB_WORKFLOWS_PARTS);
const DEPLOY_WORKFLOW_FILE = "deploy.yml";
export const QUALITY_WORKFLOW_FILE = "quality.yml";
export const QUALITY_RAILS_WORKFLOW_FILE = "quality-rails.yml";
export const PACKAGE_MANAGER_INPUT = "${{ inputs.package_manager }}";
export const QUALITY_YML = path.join(WORKFLOWS_DIR, QUALITY_WORKFLOW_FILE);
export const QUALITY_RAILS_YML = path.join(
  WORKFLOWS_DIR,
  QUALITY_RAILS_WORKFLOW_FILE
);
export const RELEASE_YML = path.join(WORKFLOWS_DIR, "release.yml");
export const DEPLOY_YML = path.join(WORKFLOWS_DIR, DEPLOY_WORKFLOW_FILE);
export const NESTJS_DEPLOY_YML = path.join(
  REPO_ROOT,
  "nestjs",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  DEPLOY_WORKFLOW_FILE
);
export const NESTJS_CI_YML = path.join(
  REPO_ROOT,
  "nestjs",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  "ci.yml"
);
export const EXPO_DEPLOY_YML = path.join(
  REPO_ROOT,
  "expo",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  DEPLOY_WORKFLOW_FILE
);
export const EXPO_CI_YML = path.join(
  REPO_ROOT,
  "expo",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  "ci.yml"
);
export const EAS_BUILD_YML = path.join(WORKFLOWS_DIR, "build.yml");
export const CREATE_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-issue-on-failure.yml"
);
export const CREATE_GITHUB_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-github-issue-on-failure.yml"
);

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  "working-directory"?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
export interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  environment?: unknown;
  outputs?: Record<string, string>;
  permissions?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown>; "fail-fast"?: boolean };
  steps?: WorkflowStep[];
  with?: Record<string, unknown>;
}

/** Root shape of the parsed `quality.yml` reusable workflow. */
export interface QualityWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `release.yml` reusable workflow. */
export interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `deploy.yml` workflow. */
export interface DeployWorkflow {
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, WorkflowJob>;
}

/** Root shape for lightweight reusable workflow contract checks. */
export interface ReusableWorkflow {
  on?: {
    workflow_call?: {
      secrets?: Record<string, { required?: boolean }>;
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

/**
 * Normalize GitHub Actions' scalar-or-list `needs` value for assertions.
 *
 * @param job Parsed workflow job.
 * @returns Job dependency names.
 */
export function needsList(job: WorkflowJob | undefined): string[] {
  if (!job?.needs) {
    return [];
  }

  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * Live-status probe for Deploy pipeline stages in `lisa ui`.
 *
 * Combines the project's `.github/workflows/deploy.yml` job sequence with
 * live GitHub environment protection rules for each `github.environments`
 * entry. READ-ONLY — never fabricates a hold/no-hold claim.
 * @module cli/ui-deploy-pipeline
 */
import { execFile } from "node:child_process";
import { isJsonObject } from "../sync/json-path.js";
import {
  readConfinedMergedConfig,
  readConfinedProjectText,
} from "./ui-confined-project-read.js";
import type { StatusProbe } from "./ui-status.js";
import {
  buildDeployPipelineResult,
  DEPLOY_PIPELINE_PROBE_ID,
  type DeployPipelineValue,
  type GithubEnvironmentInfo,
  type GithubEnvironmentsLookup,
} from "./ui-deploy-pipeline-model.js";

export {
  assembleDeployPipelineStages,
  buildDeployPipelineResult,
  DEPLOY_PIPELINE_PROBE_ID,
  mapEnvironmentHoldStage,
  parseDeployWorkflowStages,
  type DeployPipelineStage,
  type DeployPipelineValue,
  type GithubEnvironmentInfo,
  type GithubEnvironmentsLookup,
} from "./ui-deploy-pipeline-model.js";

const DEPLOY_YML_RELATIVE = ".github/workflows/deploy.yml";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Injectable collaborators for focused unit tests. */
export type DeployPipelineDependencies = {
  readonly readDeployWorkflow?: (cwd: string) => Promise<string | null>;
  readonly readConfiguredEnvironments?: (
    cwd: string
  ) => Promise<readonly string[]>;
  readonly listGithubEnvironments?: (
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number
  ) => Promise<GithubEnvironmentsLookup>;
};

/**
 * Read deploy.yml when present; null when the project has no deploy workflow.
 * @param cwd - Project root
 * @returns File contents or null
 */
async function readDeployWorkflowDefault(cwd: string): Promise<string | null> {
  return (await readConfinedProjectText(cwd, DEPLOY_YML_RELATIVE)) ?? null;
}

/**
 * Read configured environment names from merged Lisa config.
 * @param cwd - Project root
 * @returns Stable key order from the merged `github.environments` map
 */
async function readConfiguredEnvironmentsDefault(
  cwd: string
): Promise<readonly string[]> {
  const merged = await readConfinedMergedConfig(cwd);
  const github = merged.github;
  if (!isJsonObject(github)) {
    return [];
  }
  const environments = github.environments;
  if (!isJsonObject(environments)) {
    return [];
  }
  return Object.keys(environments);
}

/**
 * Detect whether a gh failure means the CLI is not authenticated.
 * @param stderr - Combined stderr/stdout from the failed command
 * @returns Whether the failure is an authentication problem
 */
function isNotAuthenticatedFailure(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return (
    text.includes("not logged into") ||
    text.includes("not authenticated") ||
    text.includes("gh auth login") ||
    text.includes("http 401") ||
    text.includes("401 unauthorized") ||
    text.includes("to re-authenticate") ||
    text.includes("authentication required")
  );
}

/**
 * Parse a required-reviewers protection rule into a boolean hold signal.
 * @param rules - Protection rules from one environment payload
 * @returns True when at least one required reviewer is configured
 */
function protectionHasRequiredReviewers(rules: unknown): boolean {
  if (!Array.isArray(rules)) {
    return false;
  }
  return rules.some(rule => {
    if (!isJsonObject(rule) || rule.type !== "required_reviewers") {
      return false;
    }
    const reviewers = rule.reviewers;
    return Array.isArray(reviewers) && reviewers.length > 0;
  });
}

/**
 * Classify a failed `gh api` invocation without fabricating hold state.
 * @param stderr - Command stderr
 * @param errorMessage - Error message from execFile
 * @returns not-authenticated or generic error lookup
 */
function classifyGithubEnvironmentsFailure(
  stderr: string,
  errorMessage: string
): GithubEnvironmentsLookup {
  const detail = `${stderr}\n${errorMessage}`.trim();
  if (isNotAuthenticatedFailure(detail)) {
    return {
      status: "not-authenticated",
      message: detail.length > 0 ? detail : "GitHub CLI is not authenticated",
    };
  }
  return {
    status: "error",
    message: detail.length > 0 ? detail : "Failed to list GitHub environments",
  };
}

/**
 * Parse the jq-shaped environments array from `gh api`.
 * @param stdout - Command stdout
 * @returns ok lookup or parse error
 */
function parseGithubEnvironmentsStdout(
  stdout: string
): GithubEnvironmentsLookup {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        status: "error",
        message: "GitHub environments response was not an array",
      };
    }
    const environments = parsed.flatMap((entry): GithubEnvironmentInfo[] => {
      if (!isJsonObject(entry) || typeof entry.name !== "string") {
        return [];
      }
      return [
        {
          name: entry.name,
          hasRequiredReviewers: protectionHasRequiredReviewers(
            entry.protection_rules
          ),
        },
      ];
    });
    return { status: "ok", environments };
  } catch (parseError) {
    return {
      status: "error",
      message:
        parseError instanceof Error
          ? parseError.message
          : "Failed to parse GitHub environments response",
    };
  }
}

/**
 * List GitHub Environments for the project's origin repo via `gh api`.
 * @param cwd - Project root
 * @param signal - Probe cancellation signal
 * @param timeoutMs - Child-process timeout
 * @returns Authenticated list, not-authenticated, or error
 */
export async function listGithubEnvironmentsViaGh(
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<GithubEnvironmentsLookup> {
  return await new Promise(resolve => {
    const ghExecutable = "gh";
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed gh executable
      ghExecutable,
      [
        "api",
        "repos/{owner}/{repo}/environments",
        "--paginate",
        "--jq",
        "[.environments[]? | {name, protection_rules}]",
      ],
      { cwd, signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolve(classifyGithubEnvironmentsFailure(stderr, error.message));
          return;
        }
        resolve(parseGithubEnvironmentsStdout(stdout));
      }
    );
  });
}

/**
 * Create the probe that reports Deploy pipeline stages for `lisa ui`.
 * @param cwd - Project root the console is serving
 * @param dependencies - Injectable IO for focused tests
 * @returns Status probe registered as `deploy-pipeline-stages`
 */
export function createDeployPipelineProbe(
  cwd: string,
  dependencies: DeployPipelineDependencies = {}
): StatusProbe<DeployPipelineValue> {
  const readDeployWorkflow =
    dependencies.readDeployWorkflow ?? readDeployWorkflowDefault;
  const readConfiguredEnvironments =
    dependencies.readConfiguredEnvironments ??
    readConfiguredEnvironmentsDefault;
  const listGithubEnvironments =
    dependencies.listGithubEnvironments ?? listGithubEnvironmentsViaGh;
  return {
    id: DEPLOY_PIPELINE_PROBE_ID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    run: async signal => {
      const [workflow, configuredEnvironments] = await Promise.all([
        readDeployWorkflow(cwd),
        readConfiguredEnvironments(cwd),
      ]);
      const lookup =
        configuredEnvironments.length === 0
          ? { status: "ok" as const, environments: [] }
          : await listGithubEnvironments(cwd, signal, DEFAULT_TIMEOUT_MS + 250);
      return buildDeployPipelineResult(
        workflow,
        configuredEnvironments,
        lookup
      );
    },
  };
}

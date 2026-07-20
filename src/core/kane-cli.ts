/** Lisa-owned policy adapter for TestMu Kane CLI. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  readProjectConfig,
  validateProjectConfig,
  type KaneBrowserConfig,
} from "./project-config.js";
import { parseKaneResult } from "./kane-cli-parser.js";
import { isChromeAvailable, runKaneCommand } from "./kane-cli-process.js";
import type {
  ChromeAvailabilityProbe,
  KaneCommandResult,
  KaneCommandRunner,
  KaneReadiness,
  KaneRunRequest,
  KaneRunResult,
} from "./kane-cli-types.js";

export { parseKaneResult } from "./kane-cli-parser.js";
export { isChromeAvailable, runKaneCommand } from "./kane-cli-process.js";
export type {
  ChromeAvailabilityProbe,
  KaneCommandResult,
  KaneCommandRunner,
  KaneMutationLevel,
  KaneOutcome,
  KaneReadiness,
  KaneRunRequest,
  KaneRunResult,
  KaneTerminalEvent,
} from "./kane-cli-types.js";

/** Kane CLI version covered by Lisa's adapter contract tests. */
export const SUPPORTED_KANE_VERSION = "0.6.3";

/** Provider config narrowed by Lisa's hard run gate. */
type AllowedKaneConfig = KaneBrowserConfig & {
  readonly enabled: true;
  readonly cloudUploadApproved: true;
  readonly version: typeof SUPPORTED_KANE_VERSION;
  readonly projectId: string;
};

/**
 * Merge committed and local Kane config using per-key local precedence.
 * @param projectRoot - Downstream project root
 * @returns Effective optional provider config
 */
export async function readEffectiveKaneConfig(
  projectRoot: string
): Promise<KaneBrowserConfig | undefined> {
  const committed = (await readProjectConfig(projectRoot)).verification?.browser
    ?.kane;
  const localPath = path.join(projectRoot, ".lisa.config.local.json");
  if (!existsSync(localPath)) return committed;
  const parsed = JSON.parse(await readFile(localPath, "utf8")) as unknown;
  const local = validateProjectConfig(parsed, localPath).verification?.browser
    ?.kane;
  return local === undefined ? committed : { ...committed, ...local };
}

/**
 * Assert that a request satisfies Lisa's hard Kane safety gate.
 * @param config - Effective provider config
 * @param request - Environment and mutation policy
 */
export function assertKaneRunAllowed(
  config: KaneBrowserConfig | undefined,
  request: Pick<KaneRunRequest, "environment" | "mutation">
): asserts config is AllowedKaneConfig {
  if (config?.enabled !== true) {
    throw new Error("Kane CLI is not enabled for this project");
  }
  if (config.cloudUploadApproved !== true) {
    throw new Error(
      "Kane CLI cloud upload has not been approved for this project"
    );
  }
  if (config.version !== SUPPORTED_KANE_VERSION) {
    throw new Error(
      `Kane CLI version must be ${SUPPORTED_KANE_VERSION}; configured ${config.version ?? "none"}`
    );
  }
  if (
    !config.allowedEnvironments?.includes(request.environment) ||
    ["prod", "production"].includes(request.environment.toLowerCase())
  ) {
    throw new Error(
      `Kane CLI is not allowed in environment ${JSON.stringify(request.environment)}`
    );
  }
  if (request.mutation !== "full") {
    throw new Error(
      "Kane CLI requires Lisa mutation policy 'full' during the initial provider rollout"
    );
  }
  if (config.projectId === undefined) {
    throw new Error("Kane CLI requires a configured Test Manager projectId");
  }
}

/**
 * Build the fixed provider argument vector.
 * @param request - Validated run request
 * @param config - Effective provider config
 * @returns Kane argument vector
 */
function buildRunArguments(
  request: KaneRunRequest,
  config: KaneBrowserConfig
): readonly string[] {
  return [
    "run",
    request.objective,
    "--agent",
    "--headless",
    "--timeout",
    String(config.timeoutSeconds ?? 120),
    "--max-steps",
    String(request.maxSteps ?? 30),
    ...(request.url === undefined ? [] : ["--url", request.url]),
  ];
}

/**
 * Execute a run after asynchronous config resolution.
 * @param request - Objective and resolved Lisa policy context
 * @param config - Effective provider config
 * @param runner - Fixed-argv process runner
 * @returns Normalized provider result
 */
async function executeKaneRun(
  request: KaneRunRequest,
  config: KaneBrowserConfig | undefined,
  runner: KaneCommandRunner
): Promise<KaneRunResult> {
  const timeoutSeconds = config?.timeoutSeconds ?? 120;
  // eslint-disable-next-line no-restricted-syntax -- child inherits existing auth without logging values
  const env = { ...process.env, KANE_CLI_USER_AGENT: "lisa" };
  assertKaneRunAllowed(config, request);
  if (request.objective.trim().length === 0) {
    throw new Error("Kane CLI objective must not be empty");
  }
  if (
    request.maxSteps !== undefined &&
    (!Number.isInteger(request.maxSteps) ||
      request.maxSteps < 1 ||
      request.maxSteps > 100)
  ) {
    throw new Error("Kane CLI maxSteps must be an integer from 1 to 100");
  }
  return parseKaneResult(
    await runner("kane-cli", buildRunArguments(request, config), {
      cwd: request.projectRoot,
      timeoutMs: (timeoutSeconds + 15) * 1000,
      env,
    })
  );
}

/**
 * Run one policy-approved Kane browser objective.
 * @param request - Objective and resolved Lisa policy context
 * @param runner - Injectable fixed-argv process runner
 * @returns Normalized provider result
 */
export async function runKane(
  request: KaneRunRequest,
  runner: KaneCommandRunner = runKaneCommand
): Promise<KaneRunResult> {
  const config = await readEffectiveKaneConfig(request.projectRoot);
  return await executeKaneRun(request, config, runner);
}

/**
 * Return a failed readiness result for an unknown error.
 * @param error - Unknown caught value
 * @returns Failed readiness result
 */
function readinessError(error: unknown): KaneReadiness {
  return {
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Evaluate config-only readiness policy.
 * @param config - Enabled effective provider config
 * @returns Failure result or undefined
 */
function policyReadinessFailure(
  config: KaneBrowserConfig
): KaneReadiness | undefined {
  try {
    assertKaneRunAllowed(config, {
      environment: config.allowedEnvironments?.[0] ?? "",
      mutation: "full",
    });
    return undefined;
  } catch (error) {
    return readinessError(error);
  }
}

/**
 * Verify the configured Test Manager target.
 * @param config - Effective provider config
 * @param output - `config show` output
 * @returns Failure detail or undefined
 */
function targetFailure(
  config: KaneBrowserConfig,
  output: string
): string | undefined {
  return [config.projectId, config.folderId]
    .filter((expected): expected is string => expected !== undefined)
    .find(expected => !output.includes(expected));
}

/**
 * Parse a numeric credit balance from supported human-readable output forms.
 * @param output - Kane balance output
 * @returns Numeric credits or undefined when not observable
 */
function parseCreditBalance(output: string): number | undefined {
  const balanceLine = output
    .split(/\r?\n/u)
    .find(line => line.toLowerCase().includes("balance"));
  const balanceFirst =
    balanceLine === undefined
      ? undefined
      : /-?\d+(?:\.\d+)?/u.exec(balanceLine)?.[0];
  return balanceFirst === undefined ? undefined : Number(balanceFirst);
}

/**
 * Interpret the final account-balance readiness probe.
 * @param balance - Captured balance command
 * @param projectId - Expected Test Manager project
 * @returns Final readiness result
 */
function balanceReadiness(
  balance: Pick<KaneCommandResult, "exitCode" | "stdout">,
  projectId: string
): KaneReadiness {
  const credits = parseCreditBalance(balance.stdout);
  if (balance.exitCode !== 0) {
    return {
      status: "warn",
      detail:
        "Kane CLI is authenticated and configured, but balance could not be verified",
    };
  }
  if (credits === undefined) {
    return {
      status: "warn",
      detail:
        "Kane CLI is authenticated and configured, but its credit balance could not be parsed",
    };
  }
  if (credits <= 0) {
    return {
      status: "fail",
      detail: "Kane CLI account has no available credits",
    };
  }
  return {
    status: "ready",
    detail: `Kane CLI ${SUPPORTED_KANE_VERSION} authenticated for project ${projectId}`,
  };
}

/**
 * Run install, version, auth, target, and balance readiness probes.
 * @param projectRoot - Downstream project root
 * @param runner - Injectable process runner
 * @param chromeAvailable - Injectable host-browser probe
 * @returns Readiness status for doctor and setup
 */
export async function probeKaneReadiness(
  projectRoot: string,
  runner: KaneCommandRunner = runKaneCommand,
  chromeAvailable: ChromeAvailabilityProbe = isChromeAvailable
): Promise<KaneReadiness> {
  const config = await readEffectiveKaneConfig(projectRoot);
  const policyFailure =
    config?.enabled === true ? policyReadinessFailure(config) : undefined;
  if (config?.enabled !== true) {
    return { status: "disabled", detail: "Kane CLI provider is not enabled" };
  }
  if (policyFailure !== undefined) return policyFailure;
  if (!chromeAvailable()) {
    return {
      status: "fail",
      detail:
        "Kane CLI requires Google Chrome or Chromium; install it or set CHROME_PATH",
    };
  }
  // eslint-disable-next-line no-restricted-syntax -- read-only probes inherit existing auth/config
  const env = { ...process.env, KANE_CLI_USER_AGENT: "lisa-doctor" };
  const options = { cwd: projectRoot, timeoutMs: 15_000, env };
  const version = await runner("kane-cli", ["--version"], options);
  const observedVersion = /\b\d+\.\d+\.\d+\b/u.exec(version.stdout)?.[0];
  if (version.exitCode !== 0) {
    return {
      status: "fail",
      detail: `Kane CLI unavailable: ${version.stderr.trim() || "version probe failed"}`,
    };
  }
  if (observedVersion !== SUPPORTED_KANE_VERSION) {
    return {
      status: "fail",
      detail: `Kane CLI ${SUPPORTED_KANE_VERSION} required; observed ${version.stdout.trim()}`,
    };
  }
  const identity = await runner("kane-cli", ["whoami"], options);
  if (identity.exitCode !== 0) {
    return {
      status: "fail",
      detail: `Kane CLI authentication failed: ${identity.stderr.trim() || identity.stdout.trim()}`,
    };
  }
  const shown = await runner("kane-cli", ["config", "show"], options);
  if (shown.exitCode !== 0) {
    return { status: "fail", detail: "Kane CLI config show failed" };
  }
  const missingTarget = targetFailure(config, shown.stdout);
  if (missingTarget !== undefined) {
    return {
      status: "fail",
      detail: `Kane CLI is not configured for expected Test Manager target ${missingTarget}`,
    };
  }
  const balance = await runner("kane-cli", ["balance"], options);
  return balanceReadiness(balance, config.projectId as string);
}

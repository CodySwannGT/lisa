import { RUNTIME_ADAPTERS } from "./runtime-adapters.mjs";

export const SUPPORTED_COUNCIL_RUNTIMES = Object.freeze(
  Object.keys(RUNTIME_ADAPTERS)
);

export const DEFAULT_COUNCIL_CONTEXT = Object.freeze({
  repository: "lisa",
  sourceArtifacts: [],
  targetEnvironment: "main",
});

export const COUNCIL_GUARDED_WORKSPACE_ENV = "LISA_COUNCIL_GUARDED_WORKSPACE";

export const COUNCIL_WRITE_ACK_ENV = "LISA_COUNCIL_ALLOW_WRITE";

const WORKTREE_PATH_PATTERNS = Object.freeze([
  {
    id: "codex-worktree",
    pattern: /[/\\]\.codex[/\\]worktrees(?:[/\\]|$)/u,
  },
  {
    id: "claude-worktree",
    pattern: /[/\\]\.claude[/\\]worktrees(?:[/\\]|$)/u,
  },
]);

/**
 * Read council environment values without assuming a Node global exists.
 * @returns {NodeJS.ProcessEnv} Process environment values when available.
 */
function defaultEnv() {
  return globalThis.process?.env ?? {};
}

/**
 * Read a boolean-like feature flag from an environment mapping.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env Environment values to inspect.
 * @param {string} name Environment variable name to read.
 * @returns {boolean} True when the environment variable is set to a truthy flag value.
 */
function readEnvFlag(env, name) {
  const value = env?.[name];
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Detect whether the current council run is already isolated in a guarded workspace.
 * @param {string} [cwd] Working directory to classify.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] Environment values to inspect.
 * @returns {{ guarded: boolean; reason: string }} Guard status plus the reason it was granted.
 */
export function detectGuardedWorkspace(
  cwd = process.cwd(),
  env = defaultEnv()
) {
  if (readEnvFlag(env, COUNCIL_GUARDED_WORKSPACE_ENV)) {
    return {
      guarded: true,
      reason: "env-override",
    };
  }

  const matchedPattern = WORKTREE_PATH_PATTERNS.find(({ pattern }) =>
    pattern.test(cwd)
  );
  if (matchedPattern) {
    return {
      guarded: true,
      reason: matchedPattern.id,
    };
  }

  return {
    guarded: false,
    reason: "none",
  };
}

/**
 * Resolve whether a council run must stay read-only or may enter guarded write mode.
 * @param {{ writeMode?: string | null; cwd?: string }} [options] Requested execution settings.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] Environment values to inspect.
 * @returns {{
 *   mode: "read-only" | "guarded-write";
 *   writeMode: string | null;
 *   mutationAllowed: boolean;
 *   guardedWorkspace: boolean;
 *   guardedWorkspaceReason: string;
 *   requiresExplicitWriteAck: boolean;
 *   writeAck: boolean;
 * }} Normalized execution policy for the council run.
 */
export function resolveCouncilExecutionPolicy(
  { writeMode = null, cwd = process.cwd() } = {},
  env = defaultEnv()
) {
  const normalizedWriteMode = writeMode?.trim() ?? null;
  const workspace = detectGuardedWorkspace(cwd, env);
  const writeAck = readEnvFlag(env, COUNCIL_WRITE_ACK_ENV);

  if (!normalizedWriteMode) {
    return {
      mode: "read-only",
      writeMode: null,
      mutationAllowed: false,
      guardedWorkspace: workspace.guarded,
      guardedWorkspaceReason: workspace.reason,
      requiresExplicitWriteAck: false,
      writeAck,
    };
  }

  if (!workspace.guarded) {
    throw new Error(
      `Write mode '${normalizedWriteMode}' requires an isolated worktree or ${COUNCIL_GUARDED_WORKSPACE_ENV}=1.`
    );
  }

  if (!writeAck) {
    throw new Error(
      `Write mode '${normalizedWriteMode}' also requires ${COUNCIL_WRITE_ACK_ENV}=1 to confirm repo mutation is intentional.`
    );
  }

  return {
    mode: "guarded-write",
    writeMode: normalizedWriteMode,
    mutationAllowed: true,
    guardedWorkspace: true,
    guardedWorkspaceReason: workspace.reason,
    requiresExplicitWriteAck: true,
    writeAck,
  };
}

/**
 * Normalize free-form context into a stable council input shape.
 * @param {{
 *   repository?: string;
 *   sourceArtifacts?: string[];
 *   targetEnvironment?: string;
 * }} [context] Optional council context overrides.
 * @returns {{
 *   repository: string;
 *   sourceArtifacts: string[];
 *   targetEnvironment: string;
 * }} Normalized council context.
 */
export function normalizeCouncilContext(context = {}) {
  return {
    repository:
      context.repository?.trim() || DEFAULT_COUNCIL_CONTEXT.repository,
    sourceArtifacts: Array.isArray(context.sourceArtifacts)
      ? context.sourceArtifacts.map(value => `${value}`.trim()).filter(Boolean)
      : [...DEFAULT_COUNCIL_CONTEXT.sourceArtifacts],
    targetEnvironment:
      context.targetEnvironment?.trim() ||
      DEFAULT_COUNCIL_CONTEXT.targetEnvironment,
  };
}

/**
 * Resolve the runtime ids a council run should consult.
 * @param {string | null | undefined} runtimeFilter Optional single-runtime filter.
 * @returns {(keyof typeof RUNTIME_ADAPTERS)[]} Ordered council runtimes to consult.
 */
export function resolveCouncilRuntimes(runtimeFilter) {
  if (!runtimeFilter) {
    return [...SUPPORTED_COUNCIL_RUNTIMES];
  }

  const normalizedRuntime = runtimeFilter.trim().toLowerCase();
  if (!SUPPORTED_COUNCIL_RUNTIMES.includes(normalizedRuntime)) {
    throw new Error(
      `Unsupported council runtime: ${runtimeFilter}. Supported runtimes: ${SUPPORTED_COUNCIL_RUNTIMES.join(", ")}`
    );
  }

  return [normalizedRuntime];
}

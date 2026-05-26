import { RUNTIME_ADAPTERS } from "./runtime-adapters.mjs";

export const SUPPORTED_COUNCIL_RUNTIMES = Object.freeze(
  Object.keys(RUNTIME_ADAPTERS)
);

export const DEFAULT_COUNCIL_CONTEXT = Object.freeze({
  repository: "lisa",
  sourceArtifacts: [],
  targetEnvironment: "main",
});

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

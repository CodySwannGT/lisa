/** One-write Health composition and persistence consumer. */
import { type AgenticHealthEvaluator, runHealth } from "./agentic.js";
import { type HealthResult, validateHealthResult } from "./contract.js";
import type { DeterministicHealthOptions } from "./deterministic.js";
import {
  evaluationForHealthRequest,
  resolveHealthProtocolProjectRoot,
} from "./evaluation-protocol.js";
import {
  serializeHealthResult,
  type HealthWriteResult,
  writeLatestHealthResult,
} from "./storage.js";

/** Optional agentic response supplied by the current harness. */
export interface PersistedHealthAgenticOptions {
  readonly enabled: boolean;
  readonly response?: unknown;
  readonly timeoutMs?: number;
}

/** Deterministic controls plus one optional hostile response envelope. */
export interface PersistedHealthOptions extends DeterministicHealthOptions {
  readonly agentic?: PersistedHealthAgenticOptions;
}

/** Final stored result and the exact bytes consumers must emit. */
export interface PersistedHealthRun {
  readonly writeOutcome: HealthWriteResult;
  readonly result: HealthResult;
  readonly serialized: string;
}

/**
 * Build the digest-checking evaluator used only during final composition.
 * @param canonicalProjectRoot - Canonical project identity
 * @param response - Untrusted harness response envelope
 * @returns Evaluator that releases only a request-bound response
 */
function boundEvaluator(
  canonicalProjectRoot: string,
  response: unknown
): AgenticHealthEvaluator {
  return (request, _signal) =>
    Promise.resolve(
      evaluationForHealthRequest(canonicalProjectRoot, request, response)
    );
}

/**
 * Re-run composition against current facts and persist exactly its final result.
 * Missing, malformed, unavailable, or stale responses degrade deterministically.
 * @param projectPath - Project to inspect and persist
 * @param options - Deterministic controls and optional harness response
 * @returns Stored result, storage outcome, and exact canonical result bytes
 */
export async function runPersistedHealth(
  projectPath: string,
  options: PersistedHealthOptions = {}
): Promise<PersistedHealthRun> {
  const { agentic, ...deterministicOptions } = options;
  const root = await resolveHealthProtocolProjectRoot(projectPath);
  const evaluator =
    agentic?.response === undefined
      ? undefined
      : boundEvaluator(root, agentic.response);
  const composed = validateHealthResult(
    await runHealth(root, {
      ...deterministicOptions,
      ...(agentic === undefined
        ? {}
        : {
            agentic: {
              enabled: agentic.enabled,
              ...(evaluator === undefined ? {} : { evaluator }),
              ...(agentic.timeoutMs === undefined
                ? {}
                : { timeoutMs: agentic.timeoutMs }),
            },
          }),
    })
  );
  const writeOutcome = await writeLatestHealthResult(root, composed);
  const result = writeOutcome.result;
  return Object.freeze({
    writeOutcome,
    result,
    serialized: serializeHealthResult(result),
  });
}

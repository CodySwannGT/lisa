/** Storage-free prepare phase for current-harness Health evaluation. */
import { type AgenticHealthRequest, runHealth } from "./agentic.js";
import type { DeterministicHealthOptions } from "./deterministic.js";
import {
  createHealthEvaluationRequestEnvelope,
  type HealthEvaluationRequestEnvelope,
  resolveHealthProtocolProjectRoot,
} from "./evaluation-protocol.js";

/** Deterministic controls shared by prepare and final composition. */
export interface PrepareHealthEvaluationOptions extends DeterministicHealthOptions {
  readonly timeoutMs?: number;
}

/**
 * Capture the bounded request produced by `runHealth` without persisting its
 * deterministic intermediate. Undefined means evidence preparation degraded.
 * @param projectPath - Project to inspect
 * @param options - Deterministic controls and optional evaluator deadline
 * @returns Digest-bound request envelope, or undefined on safe degradation
 */
export async function prepareHealthEvaluation(
  projectPath: string,
  options: PrepareHealthEvaluationOptions = {}
): Promise<HealthEvaluationRequestEnvelope | undefined> {
  const root = await resolveHealthProtocolProjectRoot(projectPath);
  const { timeoutMs, ...deterministicOptions } = options;
  // eslint-disable-next-line functional/no-let -- callback capture is the prepare protocol boundary
  let captured: AgenticHealthRequest | undefined;
  await runHealth(root, {
    ...deterministicOptions,
    agentic: {
      enabled: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      evaluator: request => {
        captured = request;
        return Promise.resolve(Object.freeze({ status: "unavailable" }));
      },
    },
  });
  return captured === undefined
    ? undefined
    : createHealthEvaluationRequestEnvelope(root, captured);
}

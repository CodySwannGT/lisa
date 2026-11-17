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
  const capture = new RequestCapture();
  await runHealth(root, {
    ...deterministicOptions,
    agentic: {
      enabled: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      evaluator: request => {
        capture.record(request);
        return Promise.resolve(Object.freeze({ status: "unavailable" }));
      },
    },
  });
  return capture.request === undefined
    ? undefined
    : createHealthEvaluationRequestEnvelope(root, capture.request);
}

/** Holds the one request the evaluator callback hands back to prepare. */
class RequestCapture {
  private captured: AgenticHealthRequest | undefined;

  /**
   * The request the evaluator received, if collection reached it.
   * @returns The captured request, or undefined when it never arrived
   */
  get request(): AgenticHealthRequest | undefined {
    return this.captured;
  }

  /**
   * Keep the request the evaluator callback received.
   * @param request - Bounded request produced by `runHealth`
   */
  record(request: AgenticHealthRequest): void {
    this.captured = request;
  }
}

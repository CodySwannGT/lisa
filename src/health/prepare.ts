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
  const request = await captureCallback<AgenticHealthRequest>(deliver =>
    runHealth(root, {
      ...deterministicOptions,
      agentic: {
        enabled: true,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        evaluator: evaluated => {
          deliver(evaluated);
          return Promise.resolve(Object.freeze({ status: "unavailable" }));
        },
      },
    })
  );
  return request === undefined
    ? undefined
    : createHealthEvaluationRequestEnvelope(root, request);
}

/**
 * Runs `body` with a callback and reports the value the callback received, once
 * `body` has settled. The value travels through a promise rather than a
 * variable: after `body` settles, the promise is either already resolved or
 * never will be, and racing it against an already-resolved `undefined` reads
 * which.
 * @param body - Work that may call the callback, at most meaningfully once
 * @returns The first value the callback received, or undefined if never called
 */
function captureCallback<T>(
  body: (deliver: (value: T) => void) => Promise<unknown>
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const delivered = new Promise<T>(deliver => {
      Promise.resolve()
        .then(() => body(deliver))
        .then(
          () => resolve(Promise.race([delivered, Promise.resolve(undefined)])),
          reject
        );
    });
  });
}

/**
 * Shared fixtures for the two-phase Health consumer suites
 * (`consumer*.test.ts`). Each suite owns its own `vi.mock` of the agentic and
 * storage layers and its own temporary project root; this module only supplies
 * the pure result builders and the fake implementations those mocks delegate to.
 * @module tests/unit/health/consumer-fixtures
 */
import path from "node:path";

import type {
  AgenticHealthEvaluation,
  AgenticHealthRequest,
  HealthOptions,
} from "../../../src/health/agentic.js";
import type { HealthResult } from "../../../src/health/contract.js";

/** Start timestamp stamped on every fixture deterministic result. */
const STARTED_AT = "2026-07-21T12:00:00.000Z";
/** Completion timestamp stamped on every fixture deterministic result. */
const COMPLETED_AT = "2026-07-21T12:01:00.000Z";
/** Storage path of the latest Health result, relative to the project root. */
export const LATEST_HEALTH_PATH = ".lisa/health/latest.json";

/**
 * Build a frozen deterministic Health v1 result with one passing finding.
 * @param overrides - Fields replacing the fixture defaults
 * @returns Frozen deterministic result
 */
export const deterministicResult = (
  overrides: Partial<HealthResult> = {}
): HealthResult =>
  Object.freeze({
    schemaVersion: 1 as const,
    runId: "health-consumer-run",
    mode: "deterministic" as const,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    findings: Object.freeze([
      Object.freeze({
        check: "config.sync",
        layer: "deterministic" as const,
        status: "pass" as const,
        reason: "Configuration is synchronized.",
      }),
    ]),
    summary: Object.freeze({
      verdict: "in band" as const,
      counts: Object.freeze({ pass: 1, warn: 0, fail: 0 }),
    }),
    ...overrides,
  });

/**
 * Build the frozen agentic evaluation request for one CI workflow artifact.
 * @param artifactContent - Workflow content; changing it changes the digest
 * @returns Frozen agentic evaluation request
 */
export const evaluationRequest = (
  artifactContent = "skip_jobs: []"
): AgenticHealthRequest =>
  Object.freeze({
    schemaVersion: 1 as const,
    deterministicFindings: deterministicResult().findings,
    config: Object.freeze({
      quality: Object.freeze({
        mutation: Object.freeze({
          gate: Object.freeze({ enabled: true }),
        }),
      }),
      gates: Object.freeze({
        traceability: Object.freeze({ level: null }),
      }),
    }),
    artifacts: Object.freeze([
      Object.freeze({
        kind: "workflow" as const,
        path: ".github/workflows/ci.yml",
        content: artifactContent,
      }),
    ]),
  });

/**
 * Compose the result shape that the shipped runHealth API would return.
 * @param deterministic - Deterministic intermediate
 * @param evaluation - Completed evaluator judgments
 * @returns Full Health v1 result
 */
function fullResult(
  deterministic: HealthResult,
  evaluation: Extract<AgenticHealthEvaluation, { readonly status: "completed" }>
): HealthResult {
  const findings = Object.freeze([
    ...deterministic.findings,
    ...evaluation.judgments.map(judgment =>
      Object.freeze({
        ...judgment,
        layer: "agentic" as const,
        status: "warn" as const,
      })
    ),
  ]);
  return deterministicResult({
    mode: "full",
    findings,
    summary: Object.freeze({
      verdict: "in band",
      counts: Object.freeze({
        pass: 1,
        warn: evaluation.judgments.length,
        fail: 0,
      }),
    }),
  });
}

/**
 * Build a fake `runHealth` that consults the supplied evaluator with the
 * suite's current request and composes the shipped result shape.
 * @param currentRequest - Reads the request the evaluator should receive now
 * @returns Fake `runHealth` implementation for `mockImplementation`
 */
export const fakeRunHealth =
  (currentRequest: () => AgenticHealthRequest) =>
  async (_projectPath: string, options: HealthOptions = {}) => {
    const deterministic = deterministicResult();
    const evaluator = options.agentic?.evaluator;
    if (options.agentic?.enabled !== true || evaluator === undefined) {
      return deterministic;
    }
    try {
      const evaluation = await evaluator(
        currentRequest(),
        new AbortController().signal
      );
      return evaluation.status === "completed"
        ? fullResult(deterministic, evaluation)
        : deterministic;
    } catch {
      return deterministic;
    }
  };

/**
 * Fake `writeLatestHealthResult` that reports every write as performed.
 * @param root - Canonical project root the result is written under
 * @param result - Result being persisted
 * @returns Frozen `written` storage outcome
 */
export const fakeWriteLatestHealthResult = async (
  root: string,
  result: HealthResult
) =>
  Object.freeze({
    status: "written" as const,
    path: path.join(root, LATEST_HEALTH_PATH),
    result,
  });

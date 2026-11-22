/**
 * Optional, read-only agentic Health composition over deterministic facts.
 * Evidence collection lives in agentic-evidence.ts and the evaluator contract
 * in agentic-contract.ts; this module validates the evaluator's answer and
 * composes it with the deterministic result.
 * @module health/agentic
 */
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isProxy } from "node:util/types";

import type {
  AgenticConfigProjection,
  AgenticHealthArtifact,
  AgenticHealthConfig,
  AgenticHealthEvaluation,
  AgenticHealthJudgment,
  AgenticHealthRequest,
} from "./agentic-contract.js";
import {
  collectAgenticArtifacts,
  readAgenticConfig,
} from "./agentic-evidence.js";
import {
  summarizeHealthFindings,
  type HealthResult,
  validateHealthResult,
} from "./contract.js";
import { HealthDeadline } from "./deadline.js";
import {
  runDeterministicHealth,
  type DeterministicHealthOptions,
} from "./deterministic.js";
import {
  hasUnsafeTextCharacter,
  readStrictDenseArray,
  readStrictProperty as read,
  requireBoundedMachineId,
  requireClosedString,
  requireStrictRecord,
} from "./strict-validation.js";

export type {
  AgenticArtifactKind,
  AgenticHealthArtifact,
  AgenticHealthConfig,
  AgenticHealthEvaluation,
  AgenticHealthEvaluator,
  AgenticHealthJudgment,
  AgenticHealthRequest,
} from "./agentic-contract.js";

const DEFAULT_AGENTIC_TIMEOUT_MS = 60_000;
const MAX_JUDGMENTS = 50;
const MAX_FINAL_FINDINGS = 200;
const MAX_CHECK_BYTES = 128;
const MAX_REASON_BYTES = 2_000;
const RESERVED_CHECK = "agentic.review-completed";

/** Deterministic options plus the optional agentic pass. */
export interface HealthOptions extends DeterministicHealthOptions {
  readonly agentic?: AgenticHealthConfig;
}

/**
 * Create a detached deeply frozen evaluator request.
 * @param deterministic - Completed deterministic result
 * @param config - Allowlisted config projection disclosed to the evaluator
 * @param artifacts - Confined, bounded project evidence
 * @returns A frozen request the evaluator cannot mutate
 */
function evaluatorRequest(
  deterministic: HealthResult,
  config: AgenticConfigProjection,
  artifacts: readonly AgenticHealthArtifact[]
): AgenticHealthRequest {
  const deterministicFindings = deterministic.findings.map(finding =>
    Object.freeze({ ...finding })
  );
  return Object.freeze({
    schemaVersion: 1,
    deterministicFindings: Object.freeze(deterministicFindings),
    config,
    artifacts: Object.freeze(
      artifacts.map(artifact => Object.freeze({ ...artifact }))
    ),
  });
}

/**
 * Validate one evaluator-produced warning without accepting attribution fields.
 * @param candidate - Untrusted judgment value
 * @param index - Position in the judgments array, for error messages
 * @returns The validated, frozen judgment
 */
function validateJudgment(
  candidate: unknown,
  index: number
): AgenticHealthJudgment {
  const input = requireStrictRecord(
    candidate,
    ["check", "reason"] as const,
    `agentic judgments[${index}]`
  );
  const check = requireBoundedMachineId(
    read(input, "check"),
    `agentic judgments[${index}].check`,
    MAX_CHECK_BYTES
  );
  if (!check.startsWith("agentic.") || check === RESERVED_CHECK) {
    throw new Error("Invalid agentic judgment check namespace");
  }
  const reason = read(input, "reason");
  if (
    typeof reason !== "string" ||
    reason.trim() !== reason ||
    reason.length === 0 ||
    Buffer.byteLength(reason, "utf8") > MAX_REASON_BYTES ||
    hasUnsafeTextCharacter(reason)
  ) {
    throw new Error("Invalid agentic judgment reason");
  }
  return Object.freeze({ check, reason });
}

/**
 * Validate the evaluator's exact closed result union atomically.
 * @param candidate - Untrusted evaluator output
 * @returns The validated, frozen evaluation
 */
export function validateAgenticHealthEvaluation(
  candidate: unknown
): AgenticHealthEvaluation {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    isProxy(candidate)
  ) {
    throw new Error("Invalid agentic evaluation: expected a plain object");
  }
  const statusInput = requireStrictRecord(
    candidate,
    Object.prototype.hasOwnProperty.call(candidate, "judgments")
      ? (["status", "judgments"] as const)
      : (["status"] as const),
    "agentic evaluation"
  );
  const status = requireClosedString(
    read(statusInput, "status"),
    ["completed", "unavailable"] as const,
    "agentic evaluation.status"
  );
  if (status === "unavailable") {
    if (Object.prototype.hasOwnProperty.call(candidate, "judgments")) {
      throw new Error("Unavailable agentic evaluation cannot carry judgments");
    }
    return Object.freeze({ status });
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, "judgments")) {
    throw new Error("Completed agentic evaluation requires judgments");
  }
  const judgments = readStrictDenseArray(
    read(statusInput, "judgments"),
    0,
    MAX_JUDGMENTS,
    "agentic judgments"
  ).map(validateJudgment);
  const checks = judgments.map(judgment => judgment.check);
  if (new Set(checks).size !== checks.length) {
    throw new Error("Agentic judgment checks must be unique");
  }
  return Object.freeze({ status, judgments: Object.freeze(judgments) });
}

/**
 * Compose completed, validated judgments without changing deterministic facts.
 * @param deterministic - Completed deterministic result
 * @param evaluation - Validated completed evaluation
 * @param now - Clock used for the composed completion time
 * @returns The validated full-mode health result
 */
function composeFullResult(
  deterministic: HealthResult,
  evaluation: Extract<
    AgenticHealthEvaluation,
    { readonly status: "completed" }
  >,
  now: () => Date
): HealthResult {
  const deterministicChecks = new Set(
    deterministic.findings.map(finding => finding.check)
  );
  if (
    evaluation.judgments.some(judgment =>
      deterministicChecks.has(judgment.check)
    )
  ) {
    throw new Error(
      "Agentic judgment check collides with deterministic output"
    );
  }
  if (
    deterministic.findings.length + evaluation.judgments.length >
    MAX_FINAL_FINDINGS
  ) {
    throw new Error("Completed agentic output exceeds final finding capacity");
  }
  const warnings = [...evaluation.judgments]
    .sort((left, right) =>
      left.check === right.check
        ? left.reason.localeCompare(right.reason)
        : left.check.localeCompare(right.check)
    )
    .map(judgment =>
      Object.freeze({
        check: judgment.check,
        layer: "agentic" as const,
        status: "warn" as const,
        reason: judgment.reason,
      })
    );
  const findings = [...deterministic.findings, ...warnings];
  const observedCompleted = now().toISOString();
  const completedAt =
    observedCompleted < deterministic.completedAt
      ? deterministic.completedAt
      : observedCompleted;
  return validateHealthResult({
    schemaVersion: 1,
    runId: deterministic.runId,
    mode: "full",
    startedAt: deterministic.startedAt,
    completedAt,
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

/**
 * Resolve a canonical project directory for confined evidence collection.
 * @param projectPath - Project path as supplied by the caller
 * @returns The real path of the project directory
 */
async function canonicalProjectRoot(projectPath: string): Promise<string> {
  const root = await realpath(path.resolve(projectPath));
  if (!(await lstat(root)).isDirectory()) {
    throw new Error("Health project root is not a directory");
  }
  return root;
}

/**
 * Run deterministic health and, only when explicitly enabled and available,
 * compose one bounded optional agentic review. Collection never persists.
 * @param projectPath - Host project to inspect
 * @param options - Deterministic options plus the optional agentic pass
 * @returns The deterministic result, or the composed full result
 */
export async function runHealth(
  projectPath: string,
  options: HealthOptions = {}
): Promise<HealthResult> {
  const { agentic, ...deterministicOptions } = options;
  const deterministic = await runDeterministicHealth(
    projectPath,
    deterministicOptions
  );
  if (agentic?.enabled !== true || agentic.evaluator === undefined) {
    return deterministic;
  }
  const deadline = new HealthDeadline(
    agentic.timeoutMs ?? DEFAULT_AGENTIC_TIMEOUT_MS
  );
  try {
    const root = await deadline.run(
      () => canonicalProjectRoot(projectPath),
      undefined
    );
    if (root === undefined) return deterministic;
    const evidence = await deadline.run(
      async () =>
        Promise.all([
          readAgenticConfig(root),
          collectAgenticArtifacts(root, deterministic),
        ]),
      undefined
    );
    if (evidence === undefined) return deterministic;
    const [config, artifacts] = evidence;
    const request = evaluatorRequest(deterministic, config, artifacts);
    const evaluation = await deadline.run(
      async () =>
        validateAgenticHealthEvaluation(
          await agentic.evaluator!(request, deadline.signal)
        ),
      undefined
    );
    if (evaluation === undefined || evaluation.status === "unavailable") {
      return deterministic;
    }
    return composeFullResult(
      deterministic,
      evaluation,
      options.now ?? (() => new Date())
    );
  } catch {
    return deterministic;
  } finally {
    deadline.close();
  }
}

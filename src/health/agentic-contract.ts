/**
 * The closed data contract between Lisa's agentic Health pass and an injected
 * evaluator: what the evaluator is shown and what it may answer.
 * @module health/agentic-contract
 */
import type { HealthFinding } from "./contract.js";

/** Read-only evidence kinds exposed to an injected evaluator. */
export type AgenticArtifactKind =
  | "eslint-override"
  | "eslint-ignore-override"
  | "managed-drift"
  | "workflow";

/**
 * One bounded, project-relative source artifact. Artifact content comes from
 * the host project and must be treated as untrusted prompt material.
 */
export interface AgenticHealthArtifact {
  readonly kind: AgenticArtifactKind;
  readonly path: string;
  readonly content: string;
}

/** Deeply frozen input passed to the evaluator without filesystem capability. */
export interface AgenticHealthRequest {
  readonly schemaVersion: 1;
  readonly deterministicFindings: readonly HealthFinding[];
  readonly config: {
    readonly quality: {
      readonly mutation: {
        readonly gate: { readonly enabled: boolean | null };
      };
    };
    /**
     * Declared level of the work-item traceability gate, or null when the
     * project never mentions it. Null is NOT off: an undeclared gate still runs
     * its built-in check, so an evaluator told "null" must read that as
     * "running on Lisa's default", never as "not enforced".
     */
    readonly gates: {
      readonly traceability: { readonly level: string | null };
    };
  };
  readonly artifacts: readonly AgenticHealthArtifact[];
}

/**
 * One optional warning proposed by an evaluator.
 *
 * At most 50 judgments are accepted. `check` must use the `agentic.` namespace,
 * cannot be the reserved `agentic.review-completed` id, and is limited to 128
 * UTF-8 bytes. `reason` must be trimmed, within 2,000 UTF-8 bytes, and contain
 * no control or bidirectional-formatting characters. Lisa, rather than the
 * evaluator, stamps every accepted judgment as agentic and warn.
 */
export interface AgenticHealthJudgment {
  readonly check: string;
  readonly reason: string;
}

/** Closed evaluator response; unavailable and completed are the only states. */
export type AgenticHealthEvaluation =
  | {
      readonly status: "completed";
      readonly judgments: readonly AgenticHealthJudgment[];
    }
  | { readonly status: "unavailable" };

/**
 * Injected harness-neutral judgment boundary.
 *
 * The callback is arbitrary JavaScript, not a security sandbox. Lisa supplies
 * no filesystem capability, but consumers must still trust their evaluator.
 * Evaluators must honor the AbortSignal and release their own timers, streams,
 * and other resources when it aborts. Runtime output remains hostile-validated.
 */
export type AgenticHealthEvaluator = (
  request: AgenticHealthRequest,
  signal: AbortSignal
) => Promise<AgenticHealthEvaluation>;

/** Explicit optional agentic-pass configuration. */
export interface AgenticHealthConfig {
  readonly enabled: boolean;
  readonly evaluator?: AgenticHealthEvaluator;
  readonly timeoutMs?: number;
}

/** The sole project-config value disclosed to an evaluator. */
export interface AgenticConfigProjection {
  readonly quality: {
    readonly mutation: { readonly gate: { readonly enabled: boolean | null } };
  };
  readonly gates: {
    readonly traceability: { readonly level: string | null };
  };
}

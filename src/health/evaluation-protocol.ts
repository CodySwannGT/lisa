/** Digest-bound wire protocol for out-of-process Health evaluation. */
import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import {
  type AgenticHealthEvaluation,
  type AgenticHealthRequest,
  validateAgenticHealthEvaluation,
} from "./agentic.js";
import {
  readStrictProperty as read,
  requireStrictRecord,
} from "./strict-validation.js";

export const HEALTH_EVALUATION_PROTOCOL_VERSION = 1 as const;
export const MAX_HEALTH_EVALUATION_REQUEST_BYTES = 1024 * 1024;
export const MAX_HEALTH_EVALUATION_RESPONSE_BYTES = 128 * 1024;

const PROTOCOL_DOMAIN = "lisa-health-evaluation";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const UNAVAILABLE_EVALUATION = Object.freeze({
  status: "unavailable" as const,
});

/** Bounded request emitted for judgment by the current harness. */
export interface HealthEvaluationRequestEnvelope {
  readonly protocolVersion: typeof HEALTH_EVALUATION_PROTOCOL_VERSION;
  readonly requestDigest: string;
  readonly request: AgenticHealthRequest;
}

/** Hostile response accepted back from the current harness. */
export interface HealthEvaluationResponseEnvelope {
  readonly protocolVersion: typeof HEALTH_EVALUATION_PROTOCOL_VERSION;
  readonly requestDigest: string;
  readonly evaluation: AgenticHealthEvaluation;
}

/**
 * Resolve the digest's canonical project identity without following aliases.
 * @param projectPath - Project path supplied by the consumer
 * @returns Canonical real directory path used by the protocol digest
 */
export async function resolveHealthProtocolProjectRoot(
  projectPath: string
): Promise<string> {
  const root = await realpath(path.resolve(projectPath));
  if (!(await lstat(root)).isDirectory()) {
    throw new Error("Health project root is not a directory");
  }
  return root;
}

/**
 * Hash the protocol version, canonical root, and exact evaluator request.
 * @param canonicalProjectRoot - Canonical project identity
 * @param request - Request produced by the shipped composition API
 * @returns Lowercase SHA-256 hex digest
 */
function requestDigest(
  canonicalProjectRoot: string,
  request: AgenticHealthRequest
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        protocol: PROTOCOL_DOMAIN,
        protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
        projectRoot: canonicalProjectRoot,
        request,
      }),
      "utf8"
    )
    .digest("hex");
}

/**
 * Create a bounded envelope for the captured request.
 * @param canonicalProjectRoot - Canonical project identity
 * @param request - Request produced by the shipped composition API
 * @returns Frozen bounded transport envelope
 */
export function createHealthEvaluationRequestEnvelope(
  canonicalProjectRoot: string,
  request: AgenticHealthRequest
): HealthEvaluationRequestEnvelope {
  const envelope = Object.freeze({
    protocolVersion: HEALTH_EVALUATION_PROTOCOL_VERSION,
    requestDigest: requestDigest(canonicalProjectRoot, request),
    request,
  });
  assertSerializedBound(
    JSON.stringify(envelope),
    MAX_HEALTH_EVALUATION_REQUEST_BYTES,
    "Health evaluation request"
  );
  return envelope;
}

/**
 * Serialize a prepare envelope for harness transport.
 * @param envelope - Request envelope returned by prepare
 * @returns Pretty canonical JSON with a trailing newline
 */
export function serializeHealthEvaluationRequest(
  envelope: HealthEvaluationRequestEnvelope
): string {
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  assertSerializedBound(
    serialized,
    MAX_HEALTH_EVALUATION_REQUEST_BYTES,
    "Health evaluation request"
  );
  return serialized;
}

/**
 * Validate a response envelope without trusting accessors or extra fields.
 * @param candidate - Untrusted harness response
 * @returns Detached validated response envelope
 */
function validateResponseEnvelope(
  candidate: unknown
): HealthEvaluationResponseEnvelope {
  const input = requireStrictRecord(
    candidate,
    ["protocolVersion", "requestDigest", "evaluation"] as const,
    "health evaluation response"
  );
  const protocolVersion = read(input, "protocolVersion");
  if (protocolVersion !== HEALTH_EVALUATION_PROTOCOL_VERSION) {
    throw new Error("Unsupported health evaluation protocol version");
  }
  const digest = read(input, "requestDigest");
  if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
    throw new Error("Invalid health evaluation request digest");
  }
  const evaluation = validateAgenticHealthEvaluation(read(input, "evaluation"));
  const envelope = Object.freeze({
    protocolVersion,
    requestDigest: digest,
    evaluation,
  });
  assertSerializedBound(
    JSON.stringify(envelope),
    MAX_HEALTH_EVALUATION_RESPONSE_BYTES,
    "Health evaluation response"
  );
  return envelope;
}

/**
 * Return a response only when it is bound to this exact project and request.
 * A stale digest is an unavailable evaluation, never a judgment on new facts.
 * @param canonicalProjectRoot - Canonical project identity
 * @param request - Current request produced during final composition
 * @param candidate - Untrusted harness response
 * @returns Valid evaluation, or unavailable when its digest is stale
 */
export function evaluationForHealthRequest(
  canonicalProjectRoot: string,
  request: AgenticHealthRequest,
  candidate: unknown
): AgenticHealthEvaluation {
  const response = validateResponseEnvelope(candidate);
  const expected = Buffer.from(
    requestDigest(canonicalProjectRoot, request),
    "hex"
  );
  const actual = Buffer.from(response.requestDigest, "hex");
  if (!timingSafeEqual(expected, actual)) return UNAVAILABLE_EVALUATION;
  return response.evaluation;
}

/**
 * Reject transport payloads beyond their public byte budgets.
 * @param serialized - Canonical transport payload
 * @param maximumBytes - Public byte budget
 * @param label - Operator-readable payload name
 */
function assertSerializedBound(
  serialized: string,
  maximumBytes: number,
  label: string
): void {
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error(`${label} exceeds byte limit`);
  }
}

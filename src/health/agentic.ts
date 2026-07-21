/** Optional, read-only agentic Health composition over deterministic facts. */
/* eslint-disable functional/immutable-data, functional/no-let, jsdoc/require-param, jsdoc/require-returns, max-lines -- one auditable hostile boundary stays cohesive */
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isProxy } from "node:util/types";

import {
  hasUnsafeTextCharacter,
  readStrictDenseArray,
  readStrictProperty as read,
  requireBoundedMachineId,
  requireClosedString,
  requireStrictRecord,
} from "./strict-validation.js";
import {
  summarizeHealthFindings,
  type HealthFinding,
  type HealthResult,
  validateHealthResult,
} from "./contract.js";
import {
  runDeterministicHealth,
  type DeterministicHealthOptions,
} from "./deterministic.js";
import { HealthDeadline } from "./deadline.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
  resolveProjectPath,
} from "./read-only-fs.js";

const DEFAULT_AGENTIC_TIMEOUT_MS = 60_000;
const MAX_AGENTIC_ARTIFACTS = 67;
const MAX_WORKFLOW_FILES = 64;
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 512 * 1024;
const MAX_JUDGMENTS = 50;
const MAX_FINAL_FINDINGS = 200;
const MAX_CHECK_BYTES = 128;
const MAX_REASON_BYTES = 2_000;
const RESERVED_CHECK = "agentic.review-completed";
const WORKFLOW_DIRECTORY = path.join(".github", "workflows");
const CONFIG_PATH = ".lisa.config.json";
const LOCAL_CONFIG_PATH = ".lisa.config.local.json";
const WORKFLOW_CONTROL =
  /^\s*(?:skip_jobs|verify_enforced|mutation(?:_gate)?(?:_enabled)?)\s*:/u;
const YAML_COMMENT = /^\s*#/u;
const JOB_IDENTIFIER = /^ {2}[a-zA-Z0-9_-]+:\s*(?:#.*)?$/u;
const OVERRIDE_PATHS = [
  {
    kind: "eslint-override",
    path: "eslint.config.local.ts",
  },
  {
    kind: "eslint-ignore-override",
    path: "eslint.ignore.config.local.json",
  },
] as const;

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

/** Deterministic options plus the optional agentic pass. */
export interface HealthOptions extends DeterministicHealthOptions {
  readonly agentic?: AgenticHealthConfig;
}

/** The sole project-config value disclosed to an evaluator. */
interface AgenticConfigProjection {
  readonly quality: {
    readonly mutation: { readonly gate: { readonly enabled: boolean | null } };
  };
}

/** One path-specific config read, distinguishing absence from invalid values. */
interface MutationGateRead {
  readonly present: boolean;
  readonly enabled: boolean | null;
}

/** Read one optional fixed-path override artifact. */
async function readOptionalArtifact(
  projectRoot: string,
  descriptor: Readonly<{ kind: AgenticArtifactKind; path: string }>
): Promise<AgenticHealthArtifact | undefined> {
  const kind = await projectPathKind(projectRoot, descriptor.path);
  if (kind === "missing") return undefined;
  if (kind !== "file") throw new Error("Unsafe agentic evidence path");
  const content = await readProjectText(
    projectRoot,
    descriptor.path,
    MAX_ARTIFACT_BYTES
  );
  if (content === undefined) return undefined;
  return Object.freeze({ ...descriptor, content });
}

/** Enumerate bounded regular workflow files without following special paths. */
async function workflowPaths(projectRoot: string): Promise<readonly string[]> {
  const kind = await projectPathKind(projectRoot, WORKFLOW_DIRECTORY);
  if (kind === "missing") return [];
  if (kind !== "directory") throw new Error("Unsafe workflow evidence path");
  const directory = resolveProjectPath(projectRoot, WORKFLOW_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true });
  const workflows = entries
    .filter(entry => /\.ya?ml$/u.test(entry.name))
    .map(entry => {
      if (!entry.isFile()) throw new Error("Unsafe workflow evidence file");
      return path.join(WORKFLOW_DIRECTORY, entry.name);
    })
    .sort((left, right) => left.localeCompare(right));
  if (workflows.length > MAX_WORKFLOW_FILES) {
    throw new Error("Agentic workflow evidence exceeds file limit");
  }
  return workflows;
}

/** Reduce workflow YAML in one pass to controls, job ids, and comment blocks. */
function workflowExcerpt(source: string): string {
  const lines = source.split(/\r?\n/u);
  const selected = new Map<number, string>();
  let currentJob: Readonly<{ index: number; line: string }> | undefined;
  let pendingComments: Array<Readonly<{ index: number; line: string }>> = [];
  let captureFollowingComments = false;
  lines.forEach((line, index) => {
    if (JOB_IDENTIFIER.test(line)) {
      currentJob = Object.freeze({ index, line });
      pendingComments = [];
      captureFollowingComments = false;
      return;
    }
    if (YAML_COMMENT.test(line)) {
      const comment = Object.freeze({ index, line });
      pendingComments.push(comment);
      if (captureFollowingComments) selected.set(index, line);
      return;
    }
    if (WORKFLOW_CONTROL.test(line)) {
      if (currentJob !== undefined) {
        selected.set(currentJob.index, currentJob.line);
      }
      pendingComments.forEach(comment =>
        selected.set(comment.index, comment.line)
      );
      selected.set(index, line);
      pendingComments = [];
      captureFollowingComments = true;
      return;
    }
    pendingComments = [];
    captureFollowingComments = false;
  });
  return [...selected.entries()]
    .map(([index, line]) => `${index + 1}: ${line}`)
    .join("\n");
}

/** Read current managed ESLint content only when deterministic drift names it. */
async function readManagedDriftArtifact(
  projectRoot: string,
  deterministic: HealthResult
): Promise<AgenticHealthArtifact | undefined> {
  const finding = deterministic.findings.find(
    candidate =>
      candidate.check === "templates.managed" &&
      candidate.status === "fail" &&
      /(?:^|[ :,])eslint\.config\.ts(?:$|[ ,])/u.test(candidate.reason)
  );
  if (finding === undefined) return undefined;
  return readOptionalArtifact(projectRoot, {
    kind: "managed-drift",
    path: "eslint.config.ts",
  });
}

/** Resolve the allowlisted path without retaining unrelated config values. */
function mutationGateRead(
  config: Readonly<Record<string, unknown>>
): MutationGateRead {
  let current: unknown = config;
  for (const field of ["quality", "mutation", "gate", "enabled"] as const) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return Object.freeze({ present: true, enabled: null });
    }
    if (!Object.prototype.hasOwnProperty.call(current, field)) {
      return Object.freeze({ present: false, enabled: null });
    }
    current = (current as Readonly<Record<string, unknown>>)[field];
  }
  return Object.freeze({
    present: true,
    enabled: typeof current === "boolean" ? current : null,
  });
}

/** Read the effective mutation-gate boolean with local-config precedence. */
async function readAgenticConfig(
  projectRoot: string
): Promise<AgenticConfigProjection> {
  const [committed, local] = await Promise.all([
    readProjectJsonObject(projectRoot, CONFIG_PATH),
    readProjectJsonObject(projectRoot, LOCAL_CONFIG_PATH),
  ]);
  const localGate = mutationGateRead(local ?? {});
  const committedGate = mutationGateRead(committed ?? {});
  const enabled = localGate.present ? localGate.enabled : committedGate.enabled;
  return Object.freeze({
    quality: Object.freeze({
      mutation: Object.freeze({
        gate: Object.freeze({ enabled }),
      }),
    }),
  });
}

/** Collect confined project evidence with hard per-file and aggregate bounds. */
async function collectAgenticArtifacts(
  projectRoot: string,
  deterministic: HealthResult
): Promise<readonly AgenticHealthArtifact[]> {
  const [overrides, managedDrift] = await Promise.all([
    Promise.all(
      OVERRIDE_PATHS.map(descriptor =>
        readOptionalArtifact(projectRoot, descriptor)
      )
    ),
    readManagedDriftArtifact(projectRoot, deterministic),
  ]);
  const workflows = (
    await Promise.all(
      (await workflowPaths(projectRoot)).map(async relativePath => {
        const content = await readProjectText(
          projectRoot,
          relativePath,
          MAX_ARTIFACT_BYTES
        );
        if (content === undefined) {
          throw new Error("Workflow evidence disappeared during collection");
        }
        const excerpt = workflowExcerpt(content);
        if (excerpt.length === 0) return undefined;
        if (Buffer.byteLength(excerpt, "utf8") > MAX_ARTIFACT_BYTES) {
          throw new Error("Workflow excerpt exceeds artifact size limit");
        }
        return Object.freeze({
          kind: "workflow" as const,
          path: relativePath.split(path.sep).join("/"),
          content: excerpt,
        });
      })
    )
  ).filter(item => item !== undefined);
  const artifacts = [
    ...overrides.filter(item => item !== undefined),
    ...(managedDrift === undefined ? [] : [managedDrift]),
    ...workflows,
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (artifacts.length > MAX_AGENTIC_ARTIFACTS) {
    throw new Error("Agentic evidence exceeds artifact limit");
  }
  const totalBytes = artifacts.reduce(
    (total, artifact) => total + Buffer.byteLength(artifact.content, "utf8"),
    0
  );
  if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
    throw new Error("Agentic evidence exceeds aggregate size limit");
  }
  return Object.freeze(artifacts);
}

/** Create a detached deeply frozen evaluator request. */
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

/** Validate one evaluator-produced warning without accepting attribution fields. */
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

/** Validate the evaluator's exact closed result union atomically. */
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

/** Compose completed, validated judgments without changing deterministic facts. */
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

/** Resolve a canonical project directory for confined evidence collection. */
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

/* eslint-enable functional/immutable-data, functional/no-let, jsdoc/require-param, jsdoc/require-returns, max-lines -- restore repository defaults */

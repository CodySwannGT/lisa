// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Pure shared diagnostics retain one error identity without importing producer orchestration. */
const stages = new Set([
  "configuration",
  "cancel-intent",
  "cancel-origin",
  "cancel-checkpoint",
  "cancel-close",
  "gate-input",
  "gate-validate",
  "gate-scratch",
  "gate-stage",
  "gate-baseline",
  "gate-link",
  "gate-attach",
  "gate-proof",
  "gate-tools",
  "gate-graph",
  "gate-install",
  "gate-hooks",
  "gate-scope",
  "gate-broker",
  "gate-gateway",
  "gate-commit",
  "gate-push",
  "gate-close",
  "gate-output",
]);
const diagnostics = new WeakMap();
const capturedErrors = new WeakMap();
const provenancePhases = new Set([
  "local-proof",
  "configuration",
  "verifier",
  "canonical-context",
  "recovery-local",
  "historical-provider",
  "historical-signature",
  "recovery-signature",
  "recovery-provider",
  "assignable",
  "ordinary-signature",
  "ordinary-provider",
  "final-proof",
  "gateway-context",
  "gateway-entry",
  "gateway-input",
  "gateway-child",
]);
const provenancePrefix =
  "Invalid automation provenance: required proof, policy or provider evidence failed";

/** A synchronous verifier keeps its original exception and innermost source-selected phase. */
export function withProvenancePhase(phase, operation) {
  required(provenancePhases.has(phase), "invalid provenance diagnostic phase");
  try {
    return operation();
  } catch (error) {
    recordProvenancePhase(error, phase);
    throw error;
  }
}

/** Shared sync/async catches never inspect exception properties, including hostile getters. */
export function recordProvenancePhase(error, phase) {
  required(provenancePhases.has(phase), "invalid provenance diagnostic phase");
  if (
    error !== null &&
    (typeof error === "object" || typeof error === "function")
  ) {
    const prior = diagnostics.get(error) ?? {};
    diagnostics.set(error, { ...prior, provenance: prior.provenance ?? phase });
  }
}

/** Canonical CLI and gateway failures expose one closed label, never provider or exception text. */
export function provenanceFailure(error) {
  return `${provenancePrefix} (phase=${diagnostics.get(error)?.provenance ?? "unknown"})`;
}

/** Only a complete fixed diagnostic from an observed native exit-one can add a phase, never authority. */
export function inheritProvenanceFailure(error) {
  const facts = diagnostics.get(error);
  const bytes = capturedErrors.get(error);
  if (
    facts?.native !== "exit" ||
    facts.status !== 1 ||
    !bytes ||
    bytes.length > 256
  )
    return;
  const text = bytes.toString("utf8");
  for (const phase of provenancePhases)
    if (text === `${provenancePrefix} (phase=${phase})\n`)
      recordProvenancePhase(error, phase);
}
const signals = new Set([
  "SIGTERM",
  "SIGINT",
  "SIGKILL",
  "SIGHUP",
  "SIGQUIT",
  "SIGABRT",
  "SIGPIPE",
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGTRAP",
  "SIGFPE",
]);
const errnos = new Set([
  "EACCES",
  "ENOENT",
  "ENOEXEC",
  "EMFILE",
  "ENFILE",
  "EAGAIN",
  "EIO",
  "EPIPE",
]);
const categories = new Set([
  "exit",
  "signal",
  "cancelled",
  "deadline",
  "output-bound",
  "input-failed",
  "spawn-error",
]);

/** Nested stages preserve the innermost observed boundary and the exact original thrown value. */
export async function withStage(stage, operation) {
  required(stages.has(stage), "invalid updater diagnostic stage");
  try {
    return await operation();
  } catch (error) {
    if (
      error !== null &&
      (typeof error === "object" || typeof error === "function")
    ) {
      const prior = diagnostics.get(error) ?? {};
      diagnostics.set(error, { ...prior, stage: prior.stage ?? stage });
    }
    throw error;
  }
}

/** Only native capture registers observed close facts; exception properties never establish provenance. */
export function recordNativeFailure(
  error,
  category,
  status,
  signal,
  errno,
  stderr
) {
  if (Buffer.isBuffer(stderr) && stderr.length <= 256)
    capturedErrors.set(error, Buffer.from(stderr));
  diagnostics.set(error, {
    ...diagnostics.get(error),
    native: categories.has(category) ? category : "unknown",
    status:
      Number.isInteger(status) && status >= 0 && status <= 255 ? status : null,
    signal: signals.has(signal) ? signal : null,
    errno: errnos.has(errno) ? errno : null,
  });
}

/** Never inspect arbitrary messages, stacks, getters, commands, paths or captured child output. */
export function publicFailure(error) {
  const facts = diagnostics.get(error);
  const parts = [`stage=${facts?.stage ?? "unknown"}`];
  if (facts?.native) {
    parts.push(`native=${facts.native}`, `status=${facts.status ?? "null"}`);
    if (facts.signal) parts.push(`signal=${facts.signal}`);
    if (facts.errno) parts.push(`errno=${facts.errno}`);
  }
  if (facts?.provenance) parts.push(`provenance=${facts.provenance}`);
  return `npm updater failed: required policy, authorization, installation, gate or exact publication evidence was unavailable (${parts.join(" ")})`;
}

/** Only trusted static boundary reasons may leave a phase as a public diagnostic. */
export class UpdaterError extends Error {
  constructor(reason) {
    super(`npm updater: ${reason}`);
  }
}

/** Reject a boundary explicitly without printing untrusted candidate values. */
export function required(ok, reason) {
  if (!ok) throw new UpdaterError(reason);
}

/** Unknown keys are never an executable extension point. */
export function keys(value, expected) {
  required(
    value && typeof value === "object" && !Array.isArray(value),
    "expected object"
  );
  required(
    Object.keys(value).sort().join("\n") === [...expected].sort().join("\n"),
    "unknown or missing fields"
  );
}

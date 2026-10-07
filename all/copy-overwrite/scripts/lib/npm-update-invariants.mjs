// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Pure shared diagnostics retain one error identity without importing producer orchestration. */
const stages = new Set([
  "configuration",
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
export function recordNativeFailure(error, category, status, signal, errno) {
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

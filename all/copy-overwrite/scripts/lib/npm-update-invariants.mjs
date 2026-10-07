// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Pure shared diagnostics retain one error identity without importing producer orchestration. */

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

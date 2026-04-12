export * from "./fibonacci.js";
export * from "./file-operations.js";
export * from "./json-utils.js";
export * from "./path-utils.js";
// Intentionally narrow: the reconciliation trampoline's dist-path resolver and
// detached-spawn primitive are only consumed by src/core/lisa.ts directly; keeping
// them out of the barrel prevents leaking internal reconciliation plumbing as a
// public API surface with semver commitments.
export {
  isRunningAsLifecycleScript,
  isRunningAsTrampoline,
  shouldSchedulePostinstallReconciliation,
} from "./postinstall-trampoline.js";

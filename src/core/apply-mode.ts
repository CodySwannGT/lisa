/**
 * Apply Mode Resolution
 *
 * One place that decides whether an apply runs the full set of work or the
 * reduced `postinstall-safe` subset, so every consumer of that decision reads
 * the same answer.
 *
 * ## Why this exists
 *
 * The decision used to be re-derived from `config.skipGitCheck` at seven call
 * sites, in two files that never referenced each other: `core/lisa.ts` decided
 * the BEHAVIOUR (whether agent emits run, whether `package.json` is protected)
 * and `cli/apply.ts` independently decided what the RECEIPT recorded. Two
 * expressions of one fact, with nothing holding them together.
 *
 * That is the failure mode this module exists to prevent, and it is worse than
 * the bug it descends from: a run that skips agent emits while recording
 * `"apply_mode": "full"` makes `doctor` — which reads that receipt to decide
 * whether a repo still needs a full apply — vouch for every stale repo in the
 * fleet. A silent gap is bad; a silent gap with an instrument attesting to it
 * is worse.
 *
 * ## What did NOT change, deliberately
 *
 * `--skip-git-check` still selects `postinstall-safe` by default. That is the
 * conflation CodySwannGT/lisa#3066 reports, and it is preserved here rather
 * than separated, because separating it safely needs a reliable "this is a
 * postinstall" signal and there is not one:
 *
 * - npm sets `npm_lifecycle_event=postinstall` during a postinstall.
 * - **bun sets neither `npm_lifecycle_event` nor `npm_command`**, while still
 *   running the script. Measured, not assumed.
 *
 * So keying the mode off the lifecycle environment would classify every
 * bun-based project's postinstall as a full apply, and a full apply under
 * `bun install` regenerates agent trees — precisely what the reduced mode
 * exists to prevent. The alternative, marking the hook command itself, means
 * changing text that `ensure-lisa-postinstall` recognises by exact match and
 * that already lives in every consumer's `package.json`; that carries the
 * two-channel hazard of CodySwannGT/lisa#3050, where a recogniser miss appends
 * a second invocation rather than failing.
 *
 * What this module adds instead is an explicit opt-out for the caller who
 * genuinely wants both — a dirty tree AND the full apply — which is the case
 * the fleet-update flow needs and the only case the conflation actually
 * blocked.
 * @module core/apply-mode
 */
import type { ApplyMode } from "./apply-receipt.js";

/** The subset of config this decision reads. */
export interface ApplyModeInputs {
  /** Whether the dirty-tree check was waived. */
  readonly skipGitCheck: boolean;
  /**
   * Explicit request for the full apply even with the git check waived.
   *
   * The escape hatch from the conflation. Absent or false preserves today's
   * behaviour exactly, so no existing caller changes.
   */
  readonly fullApply?: boolean;
}

/**
 * Resolves the mode this apply runs in.
 *
 * Every consumer — agent emits, `package.json` protection, and the receipt —
 * MUST read this rather than re-deriving from `skipGitCheck`, so the recorded
 * mode can never describe work the run did not do.
 * @param config - The apply's resolved configuration.
 * @returns `"postinstall-safe"` for the reduced subset, otherwise `"full"`.
 */
export function resolveApplyMode(config: ApplyModeInputs): ApplyMode {
  if (config.fullApply === true) {
    return "full";
  }
  return config.skipGitCheck ? "postinstall-safe" : "full";
}

/**
 * Whether this apply runs the reduced subset.
 *
 * Convenience over {@link resolveApplyMode} for the call sites that only need
 * the boolean, kept as a derivation of the same function so a future third
 * mode cannot make the two disagree.
 * @param config - The apply's resolved configuration.
 * @returns True when the reduced `postinstall-safe` subset applies.
 */
export function isPostinstallSafeApply(config: ApplyModeInputs): boolean {
  return resolveApplyMode(config) === "postinstall-safe";
}

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
 * ## The conflation, and how it is separated
 *
 * `--skip-git-check` used to carry two unrelated propositions, and selecting
 * the reduced subset was the one nothing in its name suggested
 * (CodySwannGT/lisa#3066). They are separated here because they are scoped to
 * different things:
 *
 * | proposition | scoped to | expressed by |
 * |---|---|---|
 * | "do not require a clean working tree" | the INVOCATION — the caller knows its own tree | `--skip-git-check` |
 * | "run the reduced subset" | the CONTEXT — is this a package manager's install lifecycle | `--postinstall-safe` / `LISA_POSTINSTALL=1` |
 *
 * `skipGitCheck` is accepted by {@link ApplyModeInputs} and deliberately read
 * by nothing in this module. Keeping the field makes the separation directly
 * assertable and makes any future re-reading of it a visible diff rather than
 * a silent regression.
 *
 * ## Why the context is DECLARED and not detected
 *
 * Lisa already has an ambient detector — `isRunningAsLifecycleScript()`, which
 * reads `npm_package_json`. It cannot decide this, and the reason is measured
 * rather than assumed:
 *
 * - `npm install` postinstall sets `npm_lifecycle_event=postinstall`.
 * - **`bun install` postinstall sets neither `npm_lifecycle_event` nor
 *   `npm_command`** while still running the script; it does set
 *   `npm_config_user_agent` and `npm_package_json`.
 * - Every one of those leaks into the descendants of ANY `bun run` / `npm run`
 *   — including the shell an operator, a CI job, or an agent runs an apply
 *   from.
 *
 * A detector keyed on the first would classify every bun-based project's
 * postinstall as a full apply, and a full apply under `bun install`
 * regenerates agent trees — exactly what the reduced mode exists to prevent. A
 * detector keyed on the second over-fires instead, handing the reduced subset
 * back to the very callers this fixes, silently. A declaration can do neither:
 * only Lisa's own postinstall invocations carry it.
 *
 * The declaration is also concrete at the moment the decision is taken — a
 * plain string already present in the process, never a deferred or
 * lazily-resolved value that could still be token-shaped when read.
 * @module core/apply-mode
 */
import type { ApplyMode } from "./apply-receipt.js";

/** Environment variable a postinstall invocation sets to declare itself. */
export const LISA_POSTINSTALL_ENV = "LISA_POSTINSTALL";

/** The value {@link LISA_POSTINSTALL_ENV} must hold to count as declared. */
export const LISA_POSTINSTALL_ENV_VALUE = "1";

/** The subset of config this decision reads. */
export interface ApplyModeInputs {
  /**
   * Whether the dirty-tree check was waived.
   *
   * Accepted and DELIBERATELY UNREAD. This field used to decide the mode, and
   * that conflation is the defect this module resolves; it stays in the shape
   * so the separation can be asserted directly and so re-reading it would show
   * up as a diff here rather than as behaviour nobody notices.
   */
  readonly skipGitCheck: boolean;
  /**
   * Whether this apply declared itself a package-manager install lifecycle.
   *
   * Set by `--postinstall-safe` or `LISA_POSTINSTALL=1`, which every
   * Lisa-written postinstall invocation carries. This is the only input that
   * selects the reduced subset.
   */
  readonly postinstall?: boolean;
  /**
   * Explicit request for the full apply even inside a declared postinstall.
   *
   * The override of last resort, for an operator who means to force the
   * complete apply from inside a lifecycle script.
   */
  readonly fullApply?: boolean;
}

/**
 * Resolves the mode this apply runs in.
 *
 * Every consumer — agent emits, `package.json` protection, and the receipt —
 * MUST read this rather than re-deriving from any single flag, so the recorded
 * mode can never describe work the run did not do.
 * @param config - The apply's resolved configuration.
 * @returns `"postinstall-safe"` for the reduced subset, otherwise `"full"`.
 */
export function resolveApplyMode(config: ApplyModeInputs): ApplyMode {
  if (config.fullApply === true) {
    return "full";
  }
  return config.postinstall === true ? "postinstall-safe" : "full";
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

/**
 * Resolve the postinstall declaration from the CLI flag and the environment.
 *
 * Two spellings, one meaning. The flag is what Lisa's own spawned invocations
 * pass, because a spawned child's environment is sanitised of package-manager
 * variables and a flag survives that; the environment variable is what the
 * hook text in a consumer's `package.json` carries, because prefixing an
 * assignment leaves the command tail untouched and therefore leaves the
 * recogniser in `ensure-lisa-postinstall` matching both shapes with a single
 * added alternative.
 * @param flag - Value of `--postinstall-safe`, if passed.
 * @param env - Environment to read {@link LISA_POSTINSTALL_ENV} from.
 * @returns True when this apply declared itself a postinstall.
 */
export function resolvePostinstallDeclaration(
  flag: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return (
    flag === true || env[LISA_POSTINSTALL_ENV] === LISA_POSTINSTALL_ENV_VALUE
  );
}

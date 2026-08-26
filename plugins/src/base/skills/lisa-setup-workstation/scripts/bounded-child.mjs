/**
 * bounded-child — the plugin payload's child-start deadline.
 *
 * @remarks
 * ## Why this exists separately from `scripts/lib/bounded-spawn.mjs`
 *
 * Same property, different reach. A plugin payload cannot import from
 * `scripts/lib/`: the built plugin is a self-contained copy of
 * `plugins/src/<name>/`, and nothing outside that tree exists at runtime. So the
 * rule is written out here rather than pointed at — the accommodation
 * `threshold-ratchet.mjs` and `preflight-secrets.mjs` already make for their
 * entry guards.
 *
 * It is a MODULE rather than 28 inline copies because the fanout preserves
 * relative imports. Measured in the built output, not assumed:
 * `plugins/lisa/skills/lisa-setup-workstation/scripts/catalogue.mjs` exists and
 * is imported as `../../lisa-setup-workstation/scripts/catalogue.mjs` from a
 * sibling skill. The build copies the plugin tree wholesale, so a path that
 * resolves in `plugins/src/base/` resolves in all five copies.
 *
 * That distinction matters because the accommodation above is narrower than its
 * wording suggests. `threshold-ratchet.mjs` cannot import a sibling because it
 * is **materialized into other lanes** — `typescript/`, `rails/` — where the
 * sibling does not exist at the destination. A file that lives only in this
 * plugin has no such problem.
 *
 * ## The one thing a deadline alone does not fix
 *
 * `spawnSync` does not throw when it kills a child. It returns:
 *
 * | outcome | `.code` | `.status` | `.signal` | streams |
 * | --- | --- | --- | --- | --- |
 * | killed at deadline | `"ETIMEDOUT"` | `null` | `"SIGKILL"` | **empty** |
 * | ran, exited non-zero | *(absent)* | `3` | `null` | real |
 * | binary not found | `"ENOENT"` | `null` | `null` | empty |
 *
 * So the shape that appears all over this tree —
 *
 * ```js
 * return result.status === 0 ? result.stdout : null;
 * ```
 *
 * — takes the benign branch for a killed child exactly as it does for a program
 * that ran and said no. **Adding `timeout:` gives such a call site a deadline
 * and changes nothing about its verdict.** There is no `catch` to fix, because
 * the fail-open is in the conditional.
 *
 * That is why `boundedChild` THROWS rather than returning a flag: a caller that
 * does nothing inherits fail-closed behaviour, and only one that deliberately
 * catches can proceed.
 * ## Why it lives in THIS skill's directory
 *
 * It is not about workstation setup, and it is here anyway, for a measured
 * reason. The built Codex artifact — `plugins/lisa/.codex-plugin/` — copies
 * `skills/` and nothing else: no `scripts/`, `agents/`, `commands/` or
 * `rules/`. So a skill script importing `../../../scripts/lib/…` resolves to a
 * path that does not exist in that copy, while `../../<skill>/scripts/…`
 * resolves everywhere, which is exactly why `catalogue.mjs` beside this file is
 * already imported that way from a sibling skill.
 *
 * A directory of its own under `skills/` was the tidier home and was rejected
 * on evidence: every `skills/` subdirectory in this tree is a real skill with a
 * `SKILL.md`, the generators parse that file to build their artifacts, and a
 * directory without one is a shape nothing here has ever produced. Choosing an
 * unproven layout is what put the import in the wrong place to begin with.
 *
 * **Do not delete this as unused from its host skill.** Its importers are in
 * other skills and in `../../../scripts/`; `lisa-setup-workstation` hosts it,
 * it does not own it.
 * @module bounded-child
 */

import { execFileSync, spawnSync } from "node:child_process";

/**
 * Deadline a child gets when the caller states none, in milliseconds.
 *
 * A hang detector, not a performance budget. `git` resolved through `PATH` on
 * macOS goes via Apple's `xcrun` shim, measured at over 20 seconds under load
 * against 11ms for a real binary (CodySwannGT/lisa#2887) — so a tighter
 * deadline would make this module's own timeout the dominant failure mode, and
 * the tool would start manufacturing the failures it exists to detect.
 */
export const CHILD_BUDGET_MS = 30_000;

/**
 * Deadline for setup operations that legitimately include downloads, package
 * installation, secret-provider calls, or a project-declared hook.
 *
 * Kept separate from {@link CHILD_BUDGET_MS}: probes should still fail quickly,
 * while a cold network install must not be killed by the probe budget.
 */
export const SETUP_OPERATION_BUDGET_MS = 10 * 60_000;

/**
 * Whether this value is a child that was killed at its deadline.
 *
 * Reads `code` rather than an error class, because `ETIMEDOUT` is set by Node
 * itself on all three call forms — it is a platform fact, not a convention this
 * module invented, so the same test is correct anywhere including inline.
 *
 * Defensive about the shape: a `catch` binding is `unknown` and a thrown
 * non-object is legal JavaScript, so this must answer `false` rather than crash
 * the guard that was being careful.
 * @param {unknown} error A caught value, or `result.error` from `spawnSync`.
 * @returns {boolean} True when the child was killed at its deadline.
 */
export function isChildTimeout(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    /** @type {{ code?: unknown }} */ (error).code === "ETIMEDOUT"
  );
}

/**
 * Re-raise a caught value when it is a killed child, otherwise do nothing.
 *
 * The correct spelling is `throw error` — not wrapping — because a wrapped
 * error loses the `code` the next frame up needs to make the same decision.
 * @param {unknown} error The caught value.
 * @returns {void}
 * @throws {unknown} The original value, when it is a killed child.
 */
export function rethrowIfChildTimeout(error) {
  if (isChildTimeout(error)) throw error;
}

/**
 * `spawnSync` with a deadline, refusing to return a killed child's result.
 * @param {string} command The executable.
 * @param {readonly string[]} args Arguments.
 * @param {object} [options] `spawnSync` options; `timeout` overrides the default.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The result.
 * @throws {Error} When the child was killed at its deadline.
 */
export function boundedChild(command, args = [], options = {}) {
  const result = spawnSync(command, [...args], {
    ...options,
    // `SIGKILL` rather than the default `SIGTERM`: the hang this exists for is
    // a process not servicing signals, and a `SIGTERM` a child ignores turns
    // the deadline into a suggestion.
    killSignal: "SIGKILL",
    timeout: options.timeout ?? CHILD_BUDGET_MS,
  });
  if (isChildTimeout(result.error)) throw result.error;
  return result;
}

/**
 * `execFileSync` with a deadline.
 *
 * `execFileSync` already throws on a timeout, so this changes the FAILURE MODE
 * rather than adding one: without a `timeout` there is no deadline to reach and
 * the call blocks for as long as the child lives.
 * @param {string} command The executable.
 * @param {readonly string[]} args Arguments.
 * @param {object} [options] `execFileSync` options; `timeout` overrides the default.
 * @returns {string|Buffer} Whatever the child wrote to stdout.
 * @throws {Error} When the child was killed, or exited non-zero.
 */
export function boundedChildOutput(command, args = [], options = {}) {
  return execFileSync(command, [...args], {
    ...options,
    killSignal: "SIGKILL",
    timeout: options.timeout ?? CHILD_BUDGET_MS,
  });
}

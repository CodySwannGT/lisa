// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * bounded-spawn — the one implementation of "start a child, and refuse to
 * return a verdict from one that never finished", shared by every guarded
 * `.mjs` entry point Lisa ships that starts a synchronous child.
 *
 * @remarks
 * ## The defect this exists to remove
 *
 * A test with a hung child fails a gate. **A guard with a hung child returns a
 * verdict.** That is the whole reason this module is separate from the test
 * tree's equivalent: out here the consequence of a child that never answered
 * is a check that says "allow".
 *
 * The mechanism is one line, and it is measured rather than reasoned. These are
 * the three outcomes of a synchronous child start, on this platform:
 *
 * | outcome | `.code` | `.status` | `.signal` | streams |
 * | --- | --- | --- | --- | --- |
 * | killed at its deadline | `"ETIMEDOUT"` | `null` | `"SIGKILL"` | **empty** |
 * | ran and exited non-zero | *(absent)* | `3` | `null` | real |
 * | binary not found | `"ENOENT"` | `null` | `null` | empty |
 *
 * Now read the shape that appears all over this repository:
 *
 * ```js
 * return result.status === 0 ? result.stdout : null;
 * ```
 *
 * `status === 0` is false for a killed child **and** for a program that ran and
 * said no, so the two are indistinguishable and both become `null`. The caller
 * treats `null` as "the answer is no" and proceeds. **A busy machine therefore
 * produces the same value a clean answer does**, and nothing anywhere says the
 * word "time".
 *
 * That is why the fail-open spelling was never a careless choice. It is
 * indistinguishable from correct handling unless you already know the kill case
 * exists — which is precisely the argument for putting the discrimination in
 * one shared place instead of asking 80 call sites to remember it.
 *
 * ## Why this THROWS
 *
 * Returning a distinguishable value would leave every call site free to ignore
 * it, and the call sites that most need to check are the ones that already
 * decided a falsy result means "no". Throwing inverts the default: a call site
 * that does nothing gets fail-closed behaviour, and only a call site that
 * *deliberately* catches can proceed.
 *
 * Measured on the tree this was written for: of 80 synchronous child starts in
 * shipped scripts, **51 propagate** — a throw escapes and fails the process, so
 * those are fixed by this module alone — and **29 sit inside a `try` with a
 * `catch`**, where a throw would be swallowed. Those 29 are not a conversion
 * job; each needs a human answer to "what should happen when this child is
 * killed?", and the answer is written at the call site with
 * {@link isChildTimeout}.
 *
 * ## Why the discriminator is `error.code`, not a custom error class
 *
 * A class cannot cross the boundary. Plugin payloads have no `./lib/` to import
 * from — the accommodation `threshold-ratchet.mjs` and `preflight-secrets.mjs`
 * already make — so a shared class would be unavailable in exactly the tree
 * with the most call sites. `ETIMEDOUT` is set by Node itself on all three
 * forms (`spawnSync` puts it on `result.error`; `execFileSync` and `execSync`
 * throw an error carrying it), so a payload that cannot import this module
 * writes the identical check inline and is stating the same **platform fact**
 * rather than duplicating a Lisa convention.
 *
 * `ENOENT` is deliberately NOT treated as a timeout. A missing binary is a real
 * answer about the environment, it is reported the same way on every run, and
 * conflating it with a kill would hide a broken install behind a retryable-
 * looking error.
 * @module scripts/lib/bounded-spawn
 */

import { execFileSync, spawnSync } from "node:child_process";

/**
 * Deadline a child gets when the caller states none, in milliseconds.
 *
 * Deliberately generous. This is not a performance budget — it is the point
 * past which a child is presumed hung, and the cost of setting it too low is a
 * guard that fails on a slow machine while the cost of setting it too high is
 * only a slower failure. `git` resolved through `PATH` on macOS goes through
 * Apple's `xcrun` shim, which has been measured at over 20 seconds under load
 * against 11ms for a real binary (CodySwannGT/lisa#2887).
 *
 * **30s is not padding, and tightening it is not a safe optimisation.** A
 * deadline below the shim's measured worst case would make this module's own
 * timeout the dominant failure mode — the tool would start manufacturing the
 * failures it exists to detect, and every one of them would look exactly like
 * the defect it was built to catch. If a number here ever needs changing, the
 * thing to change first is `git` being resolved through `PATH` at all.
 */
export const DEFAULT_CHILD_BUDGET_MS = 30_000;

/**
 * Whether this error is a child that was killed at its deadline.
 *
 * The one question a `catch` around a bounded child start has to ask. A `catch`
 * that does not ask it treats "the box was busy" as "the command said no",
 * which is the fail-open this module exists to remove — so a catch block
 * enclosing a bounded start must either re-raise on this or say in a comment
 * why continuing is correct.
 *
 * Accepts `unknown` because that is what a `catch` binding is, and reads the
 * property defensively for the same reason: a thrown non-object is legal
 * JavaScript and must answer `false` rather than crash the guard that was
 * trying to be careful.
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
 * The one-line form for the 29 call sites whose `catch` predates this module.
 * Written as a helper rather than left to each site because the correct spelling
 * is `throw error` — NOT wrapping, NOT `throw new Error(...)` — and a wrapped
 * error loses the `code` the next frame up needs to make the same decision.
 * @param {unknown} error The caught value.
 * @returns {void}
 * @throws {unknown} The original value, when it is a killed child.
 */
export function rethrowIfChildTimeout(error) {
  if (isChildTimeout(error)) throw error;
}

/**
 * The deadline to hold a child to, given what the caller asked for.
 *
 * Split out as a value rather than folded into an options builder so that
 * `timeout:` appears LITERALLY at both call sites below. That is not a style
 * preference — the conformance scan this module exists to satisfy reads the
 * options object at each call, and a deadline supplied by a helper it cannot
 * see through makes the helper itself the one unfixable offender in the tree.
 * An offender that cannot be fixed is the pressure that produces an exemption
 * list, and an exemption list is what CodySwannGT/lisa#2940 ruled out. The
 * module that enforces the rule has to be able to pass it.
 * @param {object} options The caller's options.
 * @returns {number} Milliseconds before the child is killed.
 */
function deadlineFor(options) {
  return options.timeout ?? DEFAULT_CHILD_BUDGET_MS;
}

/**
 * `spawnSync` with a deadline, refusing to return a killed child's result.
 *
 * `spawnSync` does not throw on a timeout — it returns a result whose streams
 * are EMPTY and whose `status` is `null`, which is why the fail-open shape in
 * the module docblock cannot see it. This throws instead, so a caller that does
 * nothing inherits fail-closed behaviour.
 * @param {string} command The executable.
 * @param {readonly string[]} args Arguments.
 * @param {object} [options] `spawnSync` options; `timeout` overrides the default.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The result.
 * @throws {Error} When the child was killed at its deadline.
 */
export function boundedSpawnSync(command, args = [], options = {}) {
  const result = spawnSync(command, [...args], {
    ...options,
    // `SIGKILL` rather than the default `SIGTERM`: the hang this module exists
    // for is a process not servicing signals, and a `SIGTERM` a child ignores
    // turns the deadline into a suggestion.
    killSignal: "SIGKILL",
    timeout: deadlineFor(options),
  });
  if (isChildTimeout(result.error)) throw result.error;
  return result;
}

/**
 * `execFileSync` with a deadline.
 *
 * `execFileSync` already throws on a timeout, so this changes the FAILURE MODE
 * rather than adding one: without a `timeout` there is no deadline to reach and
 * the call blocks for as long as the child lives. The throw it produces carries
 * `code: "ETIMEDOUT"`, which is what {@link isChildTimeout} reads.
 * @param {string} command The executable.
 * @param {readonly string[]} args Arguments.
 * @param {object} [options] `execFileSync` options; `timeout` overrides the default.
 * @returns {string|Buffer} Whatever the child wrote to stdout.
 * @throws {Error} When the child was killed, or exited non-zero.
 */
export function boundedExecFileSync(command, args = [], options = {}) {
  return execFileSync(command, [...args], {
    ...options,
    killSignal: "SIGKILL",
    timeout: deadlineFor(options),
  });
}

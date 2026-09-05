/**
 * dependency-tree — decide whether a gate's dependency tree is resolvable, and
 * say "cannot measure" in one voice when it is not (CodySwannGT/lisa#3913).
 *
 * @remarks
 * ## The defect this exists for
 *
 * The `type-correctness` gate spawns the compiler by PATH:
 * `node node_modules/typescript/bin/tsc`. With an empty `node_modules` the
 * SPAWN still succeeds — node starts, and it is node that then cannot find the
 * module — so the gate's `if (tsc.error)` guard does not fire. node's
 * "Cannot find module" goes to stderr and does not match the gate's
 * `file(line,col): error TSxxxx:` pattern, so the parsed-diagnostics map comes
 * back EMPTY. Every quarantined file then satisfies "has no errors", and the
 * gate reports:
 *
 * ```
 * ❌ 370 quarantined file(s) now type-check and must leave the list:
 * Remove them from typecheck-quarantine.json.
 * ```
 *
 * Following that deletes 370 live quarantine entries on the word of a checker
 * that compiled nothing. The comparison was not wrong — it was correct about an
 * input it was never entitled to accept.
 *
 * ## Why "cannot measure" is a THIRD outcome, not a failure message
 *
 * This is the #3888 family: a control that could not establish its subject must
 * not render identically to one that established it and found nothing. The
 * sibling exemplar is the review gate's `UNDETERMINED` verdict in
 * `check-skipped-required-checks.mjs`, whose own comment states the rule this
 * module follows — resolving an unestablished subject to `success` "would be a
 * new instance of exactly that".
 *
 * A gate whose only surface is an exit code cannot emit a third code that
 * anything reads, so the fallback is fixed: **fail closed, with the denial as
 * the first clause.** Never pass. A reader who skims one line must come away
 * knowing the finding was NOT made, because the natural inference from silence
 * about errors is that there were none.
 *
 * ## The message contract
 *
 * {@link cannotMeasure} takes the clauses rather than a finished string so that
 * no call site can ship three of the four. Every message names:
 *
 *  1. the outcome, in a distinct word (`CANNOT MEASURE`);
 *  2. the inference a reader would otherwise draw, DENIED in words;
 *  3. why the measurement could not happen;
 *  4. what to do — including, where one exists, the destructive remedy that
 *     must NOT be followed.
 *
 * Clause 2 is the one that is easy to drop and the only one that stops a
 * destructive edit, so it is a required parameter.
 *
 * @module scripts/lib/dependency-tree
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** The install command that repairs an unresolvable tree. */
export const INSTALL_COMMAND = "bun install --frozen-lockfile";

/**
 * The distinct outcome word. Deliberately not "ERROR" or "FAILED": those are
 * what the gate prints when it DID measure and found something, which is the
 * confusion this whole module exists to prevent.
 */
export const CANNOT_MEASURE = "CANNOT MEASURE";

/**
 * Names the dependencies a gate needs that are not present under `root`.
 *
 * Presence is tested at the exact path the gate will spawn or import, not by
 * asking whether `node_modules` exists. A partially installed tree — the case
 * that produced the `knip` sibling of this defect, where `node_modules` was
 * present but two binaries were not — has a `node_modules` directory and still
 * cannot answer the question.
 *
 * @param {string} root - Directory the gate resolves dependencies against.
 * @param {ReadonlyArray<string>} relativePaths - Paths under `root` to require,
 *   each already spelled the way the gate will use it.
 * @returns {string[]} The missing paths, in the order given.
 */
export function missingDependencies(root, relativePaths) {
  return relativePaths.filter(
    relative => !existsSync(path.join(root, relative))
  );
}

/**
 * True when a child process signalled failure without producing anything the
 * caller could read as a finding.
 *
 * This is the general form of the defect, and it catches more than an empty
 * `node_modules`: a broken `tsconfig`, an out-of-memory compiler, a crash. The
 * three cases are distinguishable in principle and identical in what they
 * license — nothing.
 *
 * The one ambiguous input resolves the safe way. If a compiler ever emitted
 * real diagnostics in a format the caller's pattern did not match, this reports
 * "could not measure" rather than "no errors" — and "I could not read the
 * output" is the honest account of that too.
 *
 * A zero exit with no diagnostics is NOT this: that is a clean run, and the
 * caller is entitled to report it.
 *
 * @param {number | null} status - The child's exit status.
 * @param {number} findingCount - How many findings the caller parsed out.
 * @returns {boolean} Whether the run was vacuous.
 */
export function ranVacuously(status, findingCount) {
  return status !== 0 && findingCount === 0;
}

/**
 * Builds the operator-readable `CANNOT MEASURE` block.
 *
 * Returned rather than printed so callers can route it to stderr, a report, or
 * a test assertion without this module deciding.
 *
 * @param {object} clauses - The four required clauses.
 * @param {string} clauses.gate - The gate's own name, as it prints elsewhere.
 * @param {string} clauses.denial - What this is NOT reporting, phrased as the
 *   inference a reader would otherwise draw. Required: it is the clause that
 *   stops a destructive edit.
 * @param {string} clauses.because - Why the measurement could not happen.
 * @param {string} clauses.remedy - What the reader should do instead.
 * @returns {string} The block, newline-separated, no trailing newline.
 */
export function cannotMeasure({ gate, denial, because, remedy }) {
  return [
    `${CANNOT_MEASURE} — ${gate} did not run, and is NOT reporting ${denial}.`,
    `Why: ${because}`,
    `Do this: ${remedy}`,
  ].join("\n");
}

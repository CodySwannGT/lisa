#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run the gates declared at one moment, and say exactly what ran.
 *
 * The git hooks used to hardcode both the tool and the list of steps, which
 * meant the answer to "what does this project prove before a commit?" lived in
 * a shell script that only a shell could read. This runner asks the registry
 * instead: the project declares gates in `.lisa.config.json`, `lisa-gates.mjs`
 * resolves which ones apply at a moment, and this file executes them.
 *
 * ## Green is not proof
 *
 * The defect this subsystem exists to prevent is a check reporting satisfied
 * without having proved anything, so three things are non-negotiable here:
 *
 * - An `optional` gate that FAILS prints as FAILED. It does not block, and it
 *   is not swallowed. "Optional" governs the response, never the verdict.
 * - When a required gate fails, the cheap gates behind it still run and the
 *   COSTLY ones print as NOT RUN with their verdict called UNKNOWN. What would
 *   be new — and wrong — is letting an unrun gate look proved, or letting it
 *   look like a gate that had nothing to run.
 * - A gate that resolves to no command is UNPROVABLE, not passing. Nothing
 *   executed, so nothing was proved, whatever its level says.
 * - A FAILED gate says WHICH failure it was, and WHOSE it was. `exit 1` is the
 *   same sentence for a coverage regression and for a subprocess starved past
 *   its timeout, and when two opposite facts share a sentence the cheaper
 *   response — re-run — is the rational one for both, so the real regression is
 *   never looked at. A gate that merely SHARES the failing prover reports
 *   UNPROVABLE rather than FAILED: it blocks, and it stops claiming a
 *   measurement that never happened.
 *
 * ## A gate with parts
 *
 * A gate may declare `parts`: one command per folder, each written as a list
 * of arguments. Every part is started, judged and reported on its own, by the
 * same rules as any other gate. Two things differ, and both are about what
 * the declaration is — a committed file that names commands to run:
 *
 * - The list is started as written, with no shell at any point, so nothing
 *   in it can be read as an instruction. See `spawnArgv`.
 * - It starts in the part's folder, and only once that folder has been
 *   resolved on disk and found to be inside the repository. See
 *   `partDirectory`.
 *
 * A gate with no parts takes none of this path.
 *
 * ## A part the change does not touch
 *
 * In a repository with two parts, a change to one should not run the other's
 * check — and must not be reported as having passed it. At commit and at
 * push the runner learns which paths the change touches (`lib/changed-paths`)
 * and leaves out a part whose folder holds none of them. That part prints as
 * NOT APPLICABLE with its folder, its command is never started, and it is
 * counted among the gates that were not applicable here, never among the
 * ones that were proved.
 *
 * The mistake that matters is the other one: a part left out that the change
 * did touch is a folder nothing checked. So a part is left out only when the
 * runner is sure, and everything else runs it — a change that is not known,
 * a moment other than commit and push, a part for the whole repository, a
 * part that could not have started anyway.
 *
 * The same care is owed in the other direction, to a caller that stands a
 * check of its own down on this runner's word. A part that ran says nothing
 * about a changed path outside its folder, so a gate with parts is reported
 * as proved for a change only when the parts that ran reached every path the
 * change touches. See `provenFloor`.
 *
 * ## Exit codes are the hook's control flow
 *
 * The hooks fall back to their hardcoded steps unless this runner positively
 * reports a verdict, so "the runner could not run" must never look like "all
 * gates passed". Hence `NO_GATES` and `RUNNER_FAILED` are distinct from
 * `PROVED`, and the hook routes each one deliberately.
 *
 * ## A caller with no built-in checks
 *
 * `NO_GATES` means "run your own checks instead", and it is only an answer
 * for a caller that has some. The hooks a stack template ships do: a secret
 * scan, lint-staged, a test run. A repository on no supported project type
 * has no such hook, and a caller there that was sent away with 78 would let
 * the commit through having checked nothing.
 *
 * That caller passes `--builtins=none`, and gets a verdict every time:
 *
 * - `0` — let it through. Every required gate declared at this moment was
 *   proved; or nothing is declared at this moment; or every part declared at
 *   this moment is for a folder the change does not touch, so no command ran.
 *   The runner says which.
 * - `1` — stop it. A required gate was not proved, or the declaration is one
 *   the validator refuses.
 * - `70` — stop it. The runner could not run, so nothing was proved.
 *
 * It never gets 78. A half-written gates block is simply run, because there
 * is no built-in check for its silence to delete; and a gate the registry
 * leaves to a built-in check is reported as not proved, because nothing is
 * left to check it. Without the flag every exit code means what it always has.
 * @module lisa-run-gates
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  declaredFailure,
  DIAGNOSIS,
  diagnoseFailure,
  diagnoseHollowSuccess,
} from "./lib/gate-failure-diagnosis.mjs";
import {
  killMarkNote,
  recentKillMarks,
  recordKillMark,
} from "./lib/kill-marks.mjs";
import { boundedSpawnSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { openGatePassCache } from "./lib/gate-pass-cache.mjs";
import {
  PARTIAL_COVERAGE_SKIP_REASON,
  coverageLeftToCi,
  openSelectionReports,
} from "./lib/affected-tests.mjs";
import { BUILD_ONCE_ID, runBuildOnce } from "./lib/build-marker.mjs";
import {
  changeAt,
  pathsOutside,
  PUSH_REFS_STDIN,
  readPushRefs,
  declarationProblemAt,
  touchesFolder,
} from "./lib/changed-paths.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { runStartOfRunSweep } from "./lib/lisa-cleanup-sweep.mjs";
import {
  admissionEnabled,
  PUSH_CONTEXT,
  withAdmission,
} from "./lib/push-admission.mjs";
import { withPushGateDefaults } from "./lib/push-gate-defaults.mjs";
import {
  failingTestFiles,
  hostReading,
  recordPushTiming,
} from "./lib/push-timing.mjs";
import { worktreeDependencyProblem } from "./lib/worktree-dependencies.mjs";
import {
  interruptionReason,
  isWatchablePid,
} from "./lib/process-tree-runner.mjs";
import {
  compareCodeUnits,
  configurationProblems,
  declarationsAt,
  formatIdentityLine,
  lisaIdentity,
  momentsExecutedBy,
  parseGatesConfig,
  planDigest,
  projectScripts,
  readGates,
  resolveMoment,
  WHOLE_REPOSITORY,
} from "./lisa-gates.mjs";

// Re-exported rather than dropped. `compareCodeUnits` was this module's public
// surface before the digest helpers moved to the registry (#3160 added it,
// #3013 moved its callers), and a consumer importing it from here must keep
// working. The definition lives beside `canonical`, which is its only caller.
export { compareCodeUnits };

/**
 * What this process tells its caller. The hooks branch on every value.
 *
 * `NO_GATES` and `RUNNER_FAILED` both mean nothing was proved here, and both
 * send the hook to its hardcoded path. They are separate because one is a
 * project that has not migrated and the other is a broken tool, and an
 * operator reading a hook transcript needs to be able to tell them apart.
 *
 * A caller that passed `--builtins=none` has no hardcoded path, and is never
 * answered with `NO_GATES`: see "A caller with no built-in checks" above.
 */
export const EXIT = Object.freeze({
  /** Every required gate at this moment was proved. */
  PROVED: 0,
  /** At least one required gate failed. Stop the commit or push. */
  BLOCKED: 1,
  /**
   * Fall back to the built-in checks. No gates block in config (this project
   * has not migrated), a half-written one, or — for a caller that did not
   * pass `--coverage` — parts that did not reach every path of the change.
   */
  NO_GATES: 78,
  /** The runner itself could not run. Nothing was proved. Fall back. */
  RUNNER_FAILED: 70,
});

/**
 * Properties the built-in hook steps prove unconditionally at each moment.
 *
 * This exists because "a gates block exists" turned out to be a bad proxy for
 * "this project has migrated". A block can be half-written — and the first one
 * ever authored was: it declared `code-style` at commit but not
 * `credential-leakage`, so handing that moment to the registry would have
 * removed gitleaks from every commit in the repository, silently, while
 * reporting a clean run. Deleting a guarantee is not something a partial
 * migration should be able to do by omission.
 *
 * Listed here are only the steps the built-in path always attempts. The ones
 * that run only when the project wired them live in `CONDITIONAL_FLOOR`,
 * because "this project has no `lint:slow` script" and "this project has one
 * and the registry is silent about it" are opposite situations.
 *
 * Together the two lists are also the vocabulary of `--coverage`: a hook can
 * only stand a built-in step down against a name that appears here, so a
 * property omitted from these lists is one whose step always runs.
 *
 * `structural-rules` is on the commit list because `.lintstagedrc.json` runs
 * `ast-grep scan` on every staged file unconditionally — the same evidence that
 * made the registry declare the gate commit-legal. Leaving it off meant
 * lint-staged proved a property no list named.
 */
export const BUILTIN_FLOOR = Object.freeze({
  commit: Object.freeze([
    "code-style",
    "credential-leakage",
    "format-conformance",
    "structural-rules",
  ]),
  push: Object.freeze([
    "coverage-adequacy",
    "dependency-vulnerability",
    "test-correctness",
    "test-integration",
    // The pre-push hook has validated work items on every push since before
    // this registry existed, and it attempts that step unconditionally — it
    // resolves a path for the validator and runs it, rather than testing
    // whether one is wired. That is what puts it on the unconditional list
    // rather than in `CONDITIONAL_FLOOR`.
    "traceability",
    "type-correctness",
  ]),
});

/**
 * Floor properties whose built-in step runs only when the project wired it.
 *
 * The unconditional floor above answers "would the built-in path prove this
 * anywhere". This one answers it for THIS project, which is the question that
 * actually decides whether handing the moment over loses a guarantee. A
 * repository with a `lint:slow` script has slow lint proved on every push; if
 * its gates block is silent about `code-style-slow`, exiting 0 deletes that
 * proof and nothing replaces it. A repository without the script loses
 * nothing, because the built-in step prints "skipping" and moves on.
 *
 * Keyed by what the hook itself tests: a package script for the `$RUNNER`
 * steps, a file on disk for the `node scripts/...` ones. Read the hook, not
 * the intention — these two lists are one contract expressed twice, and the
 * only defence against drift is that each entry names the exact condition the
 * shell branches on.
 *
 * The commit-time threshold ratchet is deliberately absent: it has no registry
 * counterpart that is legal at `commit` (`threshold-monotonicity` is
 * push-onward, and the commit check compares STAGED changes rather than
 * `HEAD^`), so it cannot be handed over at all. The hook runs it outside the
 * handover instead.
 */
export const CONDITIONAL_FLOOR = Object.freeze({
  commit: Object.freeze([
    Object.freeze({
      id: "artifact-freshness",
      scripts: Object.freeze([]),
      files: Object.freeze(["scripts/check-derived-artifacts.mjs"]),
    }),
  ]),
  push: Object.freeze([
    Object.freeze({
      id: "code-style-slow",
      scripts: Object.freeze(["lint:slow"]),
      files: Object.freeze([]),
    }),
    Object.freeze({
      id: "dead-code",
      scripts: Object.freeze(["knip:check", "knip"]),
      files: Object.freeze([]),
    }),
    Object.freeze({
      id: "test-meaningfulness",
      scripts: Object.freeze(["test:mutation"]),
      files: Object.freeze([]),
    }),
  ]),
});

/**
 * One gate's resolved declaration plus the verdict this runner reached on it.
 * @typedef {object} GateOutcome
 * @property {string} id Gate id, e.g. `credential-leakage`.
 * @property {string} level `required` or `optional`.
 * @property {string} mode `run`, `await`, or `intercept`.
 * @property {string|null} awaits Signal name, for an awaited gate.
 * @property {string|null} task The task naming what proves this property.
 * @property {string|null} command The command line, runner prefix included.
 * @property {string} label The CI job name this gate posts under.
 * @property {string|null} work What a nonzero count would prove.
 * @property {string} state One of `STATE`.
 * @property {string} detail The command, the skip reason, or the failure note.
 * @property {number|null} code Exit code; null when nothing ran or was killed.
 * @property {string|null} [diagnosis] Which failure this was, from `DIAGNOSIS`.
 * @property {string[]} [evidence] Concrete lines backing the diagnosis.
 * @property {string|null} [proves] Whose property the failure belongs to, from
 *   `ATTRIBUTION`; absent unless a diagnosis attributed it.
 * @property {string|null} provedBy The gate whose run proved this one, when
 *   they share a command. Always set: `runMoment` stamps it on every outcome.
 * @property {string|null} [startedAt] When this gate's verdict began,
 *   ISO-8601; null when the run never reached it (#4591).
 * @property {number} [durationMs] Time spent on this gate; 0 when a sibling's
 *   run proved it or it was never reached (#4591).
 * @property {boolean} [cached] True when the verdict is a remembered pass for
 *   this exact content and the gate did not run (CodySwannGT/lisa#4594).
 * @property {{files: string[], truncated: boolean}} [failingTests] Test files
 *   a nonzero run's output named as failing, for the push timing report only
 *   (CodySwannGT/lisa#4896). Absent on a pass; never read into a verdict.
 * @property {string} [scope] The folder one PART of a gate covers, written
 *   from the repository root. Present only on an entry resolved from a gate's
 *   `parts`; such a gate has one entry per part, all sharing one `id`.
 * @property {string[]|null} [argv] The argument list that checks that part.
 *   Present only beside `scope`. `task` and `command` are null on a part: its
 *   command is started directly and is never joined into one line of text.
 * @property {boolean} [untouched] True on a part that was left out because
 *   the change touches nothing in its folder (CodySwannGT/lisa#4988). Its
 *   state is SKIPPED and its command never started. Absent everywhere else.
 * @property {string} [resolved] Where a part's folder really is, written from
 *   the repository root the way git writes a path; empty for the root itself.
 *   It differs from `scope` only when the declared name is a link. Present on
 *   a part whose folder was found, and read by `unreachedFloor`.
 */

/**
 * What running one moment produced.
 * @typedef {object} GateRun
 * @property {string} moment The moment that was run.
 * @property {boolean} blocked Whether a required gate went unproved, or the
 *   run was interrupted before it could reach them all.
 * @property {string|null} blockedBy The first required gate that went unproved.
 * @property {string|null} interrupted Why the run stopped early, when the
 *   caller it was proving for went away; `null` on a run that ran to the end.
 * @property {number} total Gates declared at this moment. A gate with parts
 *   counts once per part, because each part is checked and reported on its own.
 * @property {GateOutcome[]} results Every gate, in execution order.
 * @property {GateOutcome[]} passed Gates that ran and exited zero.
 * @property {GateOutcome[]} failed Gates that failed or could not be proved.
 * @property {GateOutcome[]} unprovable Gates that ran and proved nothing.
 * @property {GateOutcome[]} killed Gates whose command was terminated by a
 *   signal, so it never reached a verdict.
 * @property {GateOutcome[]} skipped Gates with nothing to run locally, and
 *   parts the change does not touch (those carry `untouched: true`).
 * @property {GateOutcome[]} notRun Gates queued behind a blocking failure.
 * @property {{paths: string[]|null}} [change] The paths this run was told the
 *   change touches. `null` when they are not known, which includes a run
 *   that never had to ask because no part for a folder was reached.
 *   `runGates` always sets it. A result put together by hand may leave it
 *   out, and is then read as a change that is not known.
 */

/** Per-gate outcomes, in the order an operator reads them. */
export const STATE = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
  UNPROVABLE: "unprovable",
  /**
   * The command was terminated by a signal, so it never reached a verdict.
   *
   * Its own member rather than a shade of FAILED, because those two words are
   * opposite facts about the same `exit 1`-shaped event: FAILED says a
   * property was measured and found wanting, and a kill says nothing was
   * measured at all. Sharing one token is what let a contention kill and a real
   * regression print the same line, with re-running the rational answer to
   * both — which is how the real one goes unexamined (CodySwannGT/lisa#3032).
   *
   * It blocks exactly as FAILED does; only the vocabulary differs.
   */
  KILLED: "killed",
  NOT_RUN: "not-run",
});

/** Column width for the state token, so the gate ids line up. */
const STATE_WIDTH = 11;

/** Column width for the gate id. */
const ID_WIDTH = 28;

/**
 * Why a resolved gate has nothing for this runner to execute.
 *
 * Both modes are real enforcement — one intercepts an action before it
 * happens, the other reads a signal posted against a pull request — but
 * neither is a command with an exit code, so neither can run here.
 * @param {GateOutcome} gate A gate from `resolveMoment`.
 * @returns {string|null} The reason, or null when the gate does run here.
 */
function skipReason(gate) {
  if (gate.mode === "intercept") {
    return "enforced by interception; no task runs at this moment";
  }
  if (gate.mode === "await") {
    return `awaits "${gate.awaits}"; no signal exists locally`;
  }
  if (gate.mode === "builtin") {
    return "delegated to the built-in facade; no local task ran or verdict was proved";
  }
  return null;
}

/**
 * Whether a resolved entry is one PART of a gate.
 *
 * A gate that declares `parts` resolves to one entry per part, each carrying
 * the folder it covers (`scope`) and the argument list that checks it
 * (`argv`). An entry with neither key is a gate as it has always been, and
 * nothing below treats it differently from before parts existed.
 *
 * EITHER key marks a part, not both. An entry carrying a folder and no
 * argument list is a part whose command is missing, and it has to be reported
 * as that — read as an ordinary gate it would say "resolves to no task" about
 * a declaration that named one.
 * @param {GateOutcome} gate A gate from `resolveMoment`.
 * @returns {boolean} True for one part of a gate.
 */
function isPart(gate) {
  return gate.argv !== undefined || gate.scope !== undefined;
}

/**
 * What an operator calls one line of the report.
 *
 * A gate's id, and for a part the folder as well: every part of a gate shares
 * the gate's id, so the id alone cannot say which folder passed and which did
 * not.
 * @param {GateOutcome} gate A resolved gate, or one of its results.
 * @returns {string} The gate id, or `<gate id> in <folder>` for a part.
 */
function nameOf(gate) {
  return isPart(gate) ? `${gate.id} in ${gate.scope}` : gate.id;
}

/**
 * A part's argument list as the report prints it.
 *
 * As a JSON list rather than joined with spaces, so the report shows where
 * each argument starts and ends: `["sh", "a b"]` and `["sh", "a", "b"]` are
 * different commands, and `; rm -rf x` inside quotes is visibly one argument
 * that nothing will act on.
 * @param {unknown} argv The part's argument list.
 * @returns {string} The list, as text.
 */
function shownArgv(argv) {
  return JSON.stringify(argv) ?? "(no command)";
}

/**
 * One aligned line per gate, so a transcript can be read at a glance.
 *
 * A gate resolved through `shippedAs` says so on its own line, naming both
 * scripts. Two scripts can now back one gate, so "what proved this" stops
 * being answerable from the gate id alone — and a reader who has to open the
 * registry to find out is back where #2916 started.
 * @param {string} state A `STATE` value, or the words `shownState` gives a
 *   part the change does not touch.
 * @param {GateOutcome} gate The resolved gate.
 * @param {string} detail Command, reason, or failure note.
 * @returns {string} The formatted line.
 */
function formatLine(state, gate, detail) {
  // The space is for a token as wide as the column, which would otherwise
  // run into the level beside it. It changes nothing for a shorter one.
  const token = `${state.toUpperCase()} `.padEnd(STATE_WIDTH);
  // A name has no fixed width: a part's carries its folder, and a gate id may
  // be longer than the column. The space keeps a long one from running into
  // the detail beside it, and changes nothing for a name that fits.
  const id = `${nameOf(gate)} `.padEnd(ID_WIDTH);
  const alias = gate.alias
    ? ` (no "${gate.alias.from}" script here; this project ships "${gate.alias.to}")`
    : "";
  return `  ${token}${gate.level.padEnd(9)}${id}${detail}${alias}`;
}

/**
 * Read an executor's answer, whichever of the two shapes it returned.
 *
 * An executor may answer with a bare exit code or with `{code, output}` and an
 * optional OS-observed signal. Both retain the actual exit status; output and
 * signal identity only EXPLAIN a verdict already reached. An executor that
 * cannot capture output — a stub, a Windows shell, a run with capture switched
 * off — therefore loses the diagnosis and nothing else.
 * @param {number|null|undefined|{code: number|null, output: string|null, signal?: string}} raw
 *   Whatever the executor returned.
 * @returns {{code: number|null, output: string|null, signal?: string}} The normalised answer.
 */
function normaliseExec(raw) {
  if (raw !== null && typeof raw === "object") {
    return {
      code: typeof raw.code === "number" ? raw.code : null,
      output: typeof raw.output === "string" ? raw.output : null,
      ...(typeof raw.signal === "string" ? { signal: raw.signal } : {}),
    };
  }
  return { code: typeof raw === "number" ? raw : null, output: null };
}

/**
 * Execute one gate and classify the result.
 *
 * A `null` or `undefined` exit code — which `spawnSync` produces when a child
 * is killed by a signal — is a failure. It is emphatically not a pass: the
 * command was terminated, so whatever it was proving went unproved.
 *
 * A failure carries WHICH failure it was. `exit 1` alone cannot distinguish a
 * coverage regression from a starved subprocess, so the two render identically
 * and an operator's only rational response to either is to re-run — which is
 * how a real regression hides behind a flake. The exit code travels with the
 * output for the same reason one step further out: a terminated command
 * (`exit 143`, `exit 137`, or no code at all) reached no verdict, and only the
 * code says so — the transcript it leaves behind is truncated and reads like
 * an ordinary failure.
 * @param {GateOutcome} gate The resolved gate.
 * @param {(command: string, gate: GateOutcome) => (number|null|object)} exec Executor.
 * @returns {{state: string, detail: string, code: number|null,
 *   diagnosis: string|null, evidence: string[]}} The outcome.
 */
/**
 * Diagnoses under which the command established nothing about any property.
 *
 * A gate reports FAILED to say "I measured this and it was wanting". Two
 * outcomes cannot support that sentence and were saying it anyway.
 *
 * `undiagnosed` is the one that was measured in the wild
 * (CodySwannGT/lisa#2961). A coverage run lost its own scratch files to a
 * second coverage run in the same directory and died on a bare `ENOENT`. The
 * classifier got it right — it printed **"no recognised failure signature"**,
 * which is an admission — and the runner then rendered that admission as
 * `FAILED required coverage-adequacy`. So the report said, in one line, both
 * "I do not know what happened" and "the coverage floor was not met". The
 * second half was invented, and it is the half an operator acts on.
 *
 * `interference` is the same event as that `undiagnosed` one, now recognised
 * and named rather than merely admitted — recognising it must not silently
 * promote it back to a measurement.
 *
 * ## Two kinds that look eligible and are not
 *
 * `uncaptured` is NOT here, and the attempt to include it is what proves the
 * distinction. Capture is on by default (`LISA_GATES_CAPTURE=0` turns it off),
 * so `uncaptured` is an explicit loss of diagnostic evidence rather than the
 * ordinary outcome. A gate that exited nonzero did measure something; the
 * runner merely did not keep the transcript. Missing evidence about a real
 * failure is not the same claim as a captured transcript that describes no
 * failure at all, which is what `undiagnosed` means.
 *
 * `killed` IS here, and it arrived last (CodySwannGT/lisa#3032). #2813 gave a
 * terminated gate the right SENTENCE — "It was terminated, NOT failed" — and
 * left it printing the FAILED token beside that sentence, so the prose and the
 * vocabulary disagreed and only the prose was right. A kill is the purest case
 * this set describes: the command never answered, so there is no measurement to
 * report. It is the one member that does not render as UNPROVABLE, because a
 * reader who needs to know the box killed the run should not have to infer it
 * from a word that also covers a sibling gate's failure — see `stateFor`.
 *
 * Nothing about blocking changes. UNPROVABLE is counted in `result.failed` and
 * sets `blockedBy` exactly as FAILED does — an unmeasured required property is
 * not a pass. The only thing that changes is that the gate stops naming a cause
 * it does not have.
 */
const MEASURED_NOTHING = new Set([
  DIAGNOSIS.UNDIAGNOSED,
  DIAGNOSIS.INTERFERENCE,
  DIAGNOSIS.KILLED,
  // A run that executed zero test files proved nothing about anybody's
  // property. Left out of this set it reports FAILED, which is a verdict on a
  // suite that never started — and the transcript it would be read off carries
  // a full 0% coverage table, so the verdict it invites is the wrong one twice.
  DIAGNOSIS.NO_TESTS_RAN,
  // The OS refused this run a process, descriptor or page. Same argument as a
  // kill one rung earlier: the machine ran out, so the transcript below the
  // refusal describes the shortage and not the code. Left out of this set it
  // would report FAILED on a specific, plausible, fictional content mismatch —
  // measured here as an assertion about the string "wor ld" after the kernel
  // declined a `setpgid`. That is the most expensive shape of this defect,
  // because the wrong verdict looks completely ordinary.
  DIAGNOSIS.RESOURCE_REFUSED,
]);

/**
 * The state a diagnosis renders as.
 *
 * Membership of `MEASURED_NOTHING` is what decides that a kind is not a
 * verdict; this function only decides which non-verdict word it gets. Drop
 * `killed` from that set and a terminated gate goes straight back to printing
 * FAILED, which is the defect — the set is load-bearing, not decorative.
 * @param {string} kind One of `DIAGNOSIS`.
 * @returns {string} A `STATE` value.
 */
function stateFor(kind) {
  if (!MEASURED_NOTHING.has(kind)) return STATE.FAILED;
  return kind === DIAGNOSIS.KILLED ? STATE.KILLED : STATE.UNPROVABLE;
}

function execute(gate, exec, declarations) {
  return judge(
    gate.command,
    normaliseExec(exec(gate.command, gate)),
    declarations
  );
}

/**
 * Start one part's argument list in its folder and classify the result.
 *
 * The judgement is {@link judge}, the one every gate gets: a part that exits 0
 * while saying it ran nothing is not proved, a killed one is not failed, and a
 * failure says which failure it was. Only the start differs — an argument
 * list handed to `execArgv` with the folder to start it in, never one line of
 * text handed to a shell.
 *
 * `notStarted` is the one answer an ordinary gate has no equivalent of. A
 * shell that cannot find a program still runs and exits 127; with no shell
 * between this runner and the program, nothing runs at all, so the executor
 * says so in words and the part reports that nothing checked it. That is
 * never a pass, and it is not a kill either: a kill asks an operator to look
 * at the machine, and this asks them to install a program or fix a name.
 * @param {GateOutcome} gate One part of a gate, already cleared to start.
 * @param {(argv: string[], context: {cwd: string, gate: GateOutcome}) => (number|null|undefined|{code: number|null, output: string|null, signal?: string, notStarted?: string})} execArgv
 *   Executor for an argument list.
 * @param {string} directory The folder to start in, from `partStart`.
 * @param {Array<{gate: string, shape: string[]}>} declarations Declared
 *   failure shapes for this part's command.
 * @returns {{state: string, detail: string, code: number|null,
 *   diagnosis: string|null, evidence: string[]}} The outcome.
 */
function executePart(gate, execArgv, directory, declarations) {
  // A copy, so no executor can change what the report goes on to print.
  const raw = execArgv([...gate.argv], { cwd: directory, gate });
  return judgePart(gate.argv, raw, declarations, directory);
}

/**
 * Classify what one part's argument list answered, without starting it.
 *
 * The second half of {@link executePart}, on its own so that something other
 * than this runner can ask the same question of an answer it obtained itself.
 * The paired-proof runner is that something (CodySwannGT/lisa#4995): it plants
 * a change, starts the part's command, and has to read the answer by exactly
 * the rules a gate is read by — exit 0 from a run that says it ran nothing is
 * not a pass, a kill is not a failure, and a failure says which failure it
 * was. Two readings of one answer would let a proof say a control works when
 * the gate itself would not have been believed.
 *
 * It decides nothing new and starts nothing. `detail` and `evidence` are
 * written for a person and may quote this machine's load; `state`, `code` and
 * `diagnosis` are what a caller should act on.
 * @param {readonly string[]} argv The argument list, as the report prints it.
 * @param {number|null|undefined|{code: number|null, output: string|null, signal?: string, notStarted?: string}} raw
 *   What an executor answered, in any shape `runGates` accepts from one.
 * @param {Array<{gate: string, shape: string[]}>} [declarations] Declared
 *   failure shapes for this command.
 * @param {string} [cwd] The folder the command ran in.
 * @returns {{state: string, detail: string, code: number|null,
 *   diagnosis: string|null, evidence: string[]}} The outcome.
 */
export function judgePart(argv, raw, declarations = [], cwd = process.cwd()) {
  const shown = shownArgv(argv);
  const notStarted =
    raw !== null && typeof raw === "object" ? raw.notStarted : undefined;
  if (typeof notStarted === "string" && notStarted !== "") {
    return {
      state: STATE.UNPROVABLE,
      detail: `${shown} — ${NOTHING_RAN}: ${notStarted}`,
      code: null,
      diagnosis: null,
      evidence: [],
    };
  }
  return judge(shown, normaliseExec(raw), declarations, cwd);
}

/**
 * Classify what one command answered. The one judgement every gate gets.
 *
 * Split from the two functions that START a command so that a gate's command
 * line and a part's argument list cannot be judged by different rules: there
 * is one place that decides what exit 0 proves, and both reach it.
 * @param {string} command The command as the report prints it.
 * @param {{code: number|null, output: string|null, signal?: string}} answer
 *   The executor's answer, from `normaliseExec`.
 * @param {Array<{gate: string, shape: string[]}>} declarations Declared
 *   failure shapes for this command.
 * @param {string} [cwd] The folder the command ran in. Read only to explain a
 *   verdict already reached — a root quoted back, a failing file named.
 * @returns {{state: string, detail: string, code: number|null,
 *   diagnosis: string|null, evidence: string[]}} The outcome.
 */
function judge(
  command,
  { code, output, signal },
  declarations,
  cwd = process.cwd()
) {
  if (code === 0) {
    // Exit 0 is ADJACENT to "the property holds"; it is not the observation.
    // A command that exited 0 while its own output says it collected zero
    // test files proved nothing, and until this read the runner returned
    // PASSED here without ever looking at the transcript — which is why every
    // zero-collection pattern in the diagnosis module was reachable only from
    // the failure branch, the one branch that could never carry this event
    // (CodySwannGT/lisa#3715).
    //
    // Silence still passes. The verdict requires the tool to have SAID it ran
    // nothing, so a gate whose command reports no count at all is untouched.
    const hollow = diagnoseHollowSuccess(output, cwd);
    if (!hollow) {
      return {
        state: STATE.PASSED,
        detail: command,
        code: 0,
        diagnosis: null,
        evidence: [],
      };
    }
    return {
      state: stateFor(hollow.kind),
      detail: `${command} (exit 0) — ${hollow.summary}`,
      code: 0,
      diagnosis: hollow.kind,
      evidence: hollow.evidence,
      proves: hollow.proves,
    };
  }
  const shown = typeof code === "number" ? code : "terminated";
  // The actual status and signal go in as well as the output: a native kill
  // retains null status, while a shell's `exit 143` is `128 + 15`. Either can
  // arrive carrying a truncated transcript that
  // reads exactly like a real gate failure — which is how one `exit 1` came to
  // have three distinct causes with re-running a rational response to all of
  // them (CodySwannGT/lisa#2897).
  const diagnosis = withDeclarations(
    diagnoseFailure(output, code, undefined, undefined, undefined, signal),
    output,
    declarations
  );
  return {
    state: stateFor(diagnosis.kind),
    detail: `${command} (exit ${shown}) — ${diagnosis.summary}`,
    code: typeof code === "number" ? code : null,
    diagnosis: diagnosis.kind,
    evidence: diagnosis.evidence,
    proves: diagnosis.proves,
    // Which test files the output names as failing, for the push timing report
    // (CodySwannGT/lisa#4896). Read only on this failure branch, so a passing
    // gate never carries a list. Diagnostics only: the parser never throws and
    // nothing above or below reads it into a verdict.
    failingTests: failingTestFiles(output, { root: cwd }),
  };
}

/**
 * Give a shape the project declared its say, but only where nothing else did.
 *
 * The shipped classifier knows a fixed set of transcript forms, and every
 * prover outside that set lands in the residual bucket wearing `UNPROVABLE` —
 * the word this fleet reads as "the box, re-run it". Enumerating other tools'
 * output in a module every consumer installs cannot converge, so a project
 * declares its own prover's measured-failure shape instead
 * (CodySwannGT/lisa#3974).
 *
 * **Consulted ONLY on `undiagnosed`, and that is the entire safety argument.**
 * A killed, refused, interfered-with or zero-test run is classified before any
 * content signature is read, so it can never reach this function — a
 * declaration cannot promote non-measurement into a failure. The guarantee is
 * structural rather than a matter of where a line was inserted, which is what
 * the constraint carried in from CodySwannGT/lisa#3946 asks for.
 *
 * **A declaration that matched nothing is REPORTED rather than dropped.** A
 * mechanism wired to a field nothing reads passes exactly the way the current
 * absence passes: silently. A typo'd shape and no shape at all must not look
 * the same to the operator who wrote one.
 * @param {object} diagnosis What the shipped classifier decided.
 * @param {string|null|undefined} output The command's combined output.
 * @param {Array<{gate: string, shape: string[]}>} declarations What the gates
 *   sharing this prover declared.
 * @returns {object} The diagnosis as it should read.
 */
function withDeclarations(diagnosis, output, declarations) {
  if (diagnosis.kind !== DIAGNOSIS.UNDIAGNOSED) return diagnosis;
  if (!Array.isArray(declarations) || declarations.length === 0) {
    return diagnosis;
  }
  const declared = declaredFailure(output, declarations);
  if (declared) return declared;
  const count = declarations.reduce(
    (total, entry) => total + (entry.shape?.length ?? 0),
    0
  );
  return {
    ...diagnosis,
    summary:
      `${diagnosis.summary}. ${count} declared failure shape(s) from ` +
      `${declarations.map(entry => entry.gate).join(", ")} were consulted ` +
      `and none matched, so the declaration did not help here`,
  };
}

/**
 * Re-attribute one command's failure to the property it actually belongs to.
 *
 * Saying WHICH failure it was leaves half the defect standing. Two gates
 * legitimately share one prover, so when that prover exits nonzero the runner
 * still reports the failure against BOTH — and one of the two properties was
 * never measured at all. A starved suite therefore still printed
 * `coverage-adequacy FAILED`, now with a sentence attached saying it was not a
 * coverage problem: better, and still a gate claiming a verdict it does not
 * have.
 *
 * So a gate that shares a failing prover with the property the transcript
 * actually indicts reports UNPROVABLE instead. It still blocks — an unmeasured
 * required property is not a pass — but it stops asserting a measurement that
 * never happened, which is what made a real coverage regression indistinguishable
 * from a busy machine.
 *
 * `siblings` is the guard that keeps this honest: an attribution may only ever
 * move a verdict onto a gate that is itself declared on this same command at
 * this same moment. A phrase in some unrelated tool's output cannot invent one.
 * @param {GateOutcome} gate The gate the verdict is being reported for.
 * @param {object} outcome The outcome the command produced.
 * @param {Set<string>} siblings Gate ids sharing this command at this moment.
 * @returns {object} The outcome as it should read for THIS gate.
 */
function attributed(gate, outcome, siblings) {
  if (outcome.state !== STATE.FAILED) return outcome;
  const owner = outcome.proves;
  if (!owner || owner === gate.id || !siblings.has(owner)) return outcome;
  return {
    ...outcome,
    state: STATE.UNPROVABLE,
    detail:
      `${outcome.detail}. That is a ${owner} failure, so ${gate.id} was ` +
      `never measured by this run`,
  };
}

/**
 * What a gate left to a built-in check says when the caller has none.
 *
 * `builtin` is the registry's word for "the hook that called this runner
 * proves this property itself, with a step of its own". That is true of the
 * hooks a stack template ships and of nothing else. Reported as not
 * applicable to a caller with no such step, the gate would read as settled
 * while nothing anywhere had checked it — so it is reported as what it is.
 */
const NO_BUILTIN_TO_DEFER_TO =
  "left to a check built in to the caller, and this caller has no built-in " +
  "checks, so nothing ran and nothing was proved. Name a command for this " +
  'gate under "parts", or declare it "off"';

/**
 * Classify a gate without running it, when there is nothing to run.
 * @param {GateOutcome} gate The resolved gate.
 * @param {boolean} [builtins] Whether the caller of this run has built-in
 *   checks of its own. See `runGates`.
 * @returns {{state: string, detail: string, code: null}|null} Outcome or null.
 */
function classifyStatic(gate, builtins = true) {
  if (!builtins && gate.mode === "builtin") {
    return {
      state: STATE.UNPROVABLE,
      detail: NO_BUILTIN_TO_DEFER_TO,
      code: null,
    };
  }
  const skip = skipReason(gate);
  if (skip) return { state: STATE.SKIPPED, detail: skip, code: null };
  // A part has no command LINE by design — it has an argument list, and
  // `partStart` decides whether that can start.
  if (!gate.command && !isPart(gate)) {
    return {
      state: STATE.UNPROVABLE,
      detail: "resolves to no task, so nothing ran and nothing was proved",
      code: null,
    };
  }
  return null;
}

/**
 * How every part that was never started begins its explanation.
 *
 * Said the same way whatever the reason, so the two facts an operator needs
 * come first and in one order: no command ran, and the folder is unchecked.
 * The reason follows the colon.
 */
const NOTHING_RAN = "nothing ran, so this part was not checked";

/** The most arguments one part's command may hold. */
const PART_ARGUMENT_LIMIT = 500;

/** The most bytes one argument of a part's command may hold. */
const PART_ARGUMENT_BYTES = 65_536;

/** The most bytes a part's whole command may hold, written as JSON. */
const PART_COMMAND_BYTES = 250_000;

/**
 * Why a value cannot be started as a part's command, or null when it can.
 *
 * `validateGates` already refuses a `command` that is not a list, and
 * `resolveMoment` refuses to resolve a block that would not validate. This is
 * the same question asked again at the last moment before a process starts,
 * because the answer is what keeps a shell out: a string has to be split into
 * a program and its arguments by something, and whatever splits it is a shell
 * or an imitation of one. So anything that is not a list of text naming a
 * program is refused here, whoever handed it over.
 *
 * The size limits sit just inside what the process supervisor accepts for a
 * literal argument list, so an oversized command is refused here in a
 * sentence rather than by the supervisor in a stack trace.
 * @param {unknown} argv What a resolved entry carries as its argument list.
 * @returns {string|null} The reason, finishing `NOTHING_RAN`, or null.
 */
function argvProblem(argv) {
  if (!Array.isArray(argv)) {
    return "its command is not a list of arguments";
  }
  if (argv.length === 0) return "its command is an empty list";
  if (argv.some(item => typeof item !== "string")) {
    return "its command holds an item that is not text";
  }
  if (argv[0].trim() === "") return "its command names no program";
  if (argv.some(item => item.includes("\0"))) {
    return "its command holds a NUL character, which no program can be handed";
  }
  if (
    argv.length > PART_ARGUMENT_LIMIT ||
    argv.some(item => Buffer.byteLength(item) > PART_ARGUMENT_BYTES) ||
    Buffer.byteLength(JSON.stringify(argv)) > PART_COMMAND_BYTES
  ) {
    return "its command is too long to start";
  }
  return null;
}

/**
 * The folder a part's command starts in, or why there is none.
 *
 * The declaration is a committed file, and so is any link it points at. A
 * scope that reads `api` is only inside the repository if what `api` IS on
 * disk is inside the repository: a link named `api` leading to another
 * directory would start the command there, with whatever that command does
 * to the folder it is started in. So the folder is resolved through every
 * link first, and the command starts in the RESOLVED folder — the one that
 * was checked — rather than in the name that was declared.
 *
 * That one comparison is the whole test. `..`, a path from the top of the
 * disk and a link all fail it for the same reason, so there is no list of
 * spellings to keep complete.
 *
 * Exported for the paired-proof runner (CodySwannGT/lisa#4995), which starts
 * a part's command in a copy of the repository and must hold the folder to
 * the same test there.
 * @param {string} root The repository root.
 * @param {unknown} scope The part's folder, written from the root.
 * @returns {{directory: string, resolved: string}|{problem: string}} The
 *   folder and its own path from the repository root, or the reason,
 *   finishing `NOTHING_RAN`.
 */
export function partDirectory(root, scope) {
  if (typeof scope !== "string" || scope === "") {
    return { problem: "it names no folder" };
  }
  const named = JSON.stringify(scope);
  let top;
  try {
    top = realpathSync(root);
  } catch {
    return { problem: "the repository folder could not be read" };
  }
  let directory;
  try {
    directory = realpathSync(resolve(top, scope));
  } catch (error) {
    const code = /** @type {{code?: unknown}} */ (error)?.code;
    return {
      problem:
        code === "ENOENT" || code === "ENOTDIR"
          ? `the folder ${named} does not exist in this repository`
          : `the folder ${named} could not be opened (${String(code)})`,
    };
  }
  const path = relative(top, directory);
  const inside =
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  if (!inside) {
    return {
      problem: `the folder ${named} leads outside this repository`,
    };
  }
  if (!isFolder(directory)) return { problem: `${named} is not a folder` };
  // Where the folder really is, written the way git writes a path. It
  // differs from the declared name only when that name is a link.
  return { directory, resolved: path.split(sep).join("/") };
}

/**
 * Whether a path is a folder that is there.
 * @param {string} path The path to ask about.
 * @returns {boolean} True for an existing folder; false for anything else,
 *   including a path that cannot be read.
 */
function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether one part's command may start, and where.
 *
 * Asked before anything else is decided about the part, for the reason a
 * gate's own skip is: these are facts about THIS part — its command is not a
 * list, its folder is not there — and a part that cannot start must say so
 * itself rather than wait behind another gate or borrow a sibling's result.
 * @param {GateOutcome} gate One part of a gate.
 * @param {string} root The repository root.
 * @returns {{directory: string, resolved: string}|{problem: string}} Where to
 *   start, or why not.
 */
function partStart(gate, root) {
  const problem = argvProblem(gate.argv);
  return problem === null ? partDirectory(root, gate.scope) : { problem };
}

/**
 * The outcome of a part that was never started.
 *
 * UNPROVABLE, not FAILED: nothing measured the folder, so nothing found it
 * wanting. It blocks exactly as a failure does — a required part nobody
 * checked is not a pass.
 * @param {string} problem The reason, from `partStart`.
 * @returns {{state: string, detail: string, code: null}} The outcome.
 */
function partNotStarted(problem) {
  return {
    state: STATE.UNPROVABLE,
    detail: `${NOTHING_RAN}: ${problem}`,
    code: null,
  };
}

/** What an operator reads in place of the state on a part left out. */
const NOT_APPLICABLE = "not applicable";

/**
 * The words a result's line starts with.
 *
 * A state's own name, except for a part the change does not touch. That part
 * is SKIPPED to everything that counts results, and says NOT APPLICABLE to
 * the person reading, because "skipped" does not say why and the reason is
 * the whole point: nothing in that folder changed.
 * @param {{state: string, untouched?: boolean}} outcome A verdict.
 * @returns {string} What `formatLine` prints as the state.
 */
function shownState(outcome) {
  return outcome.untouched === true ? NOT_APPLICABLE : outcome.state;
}

/**
 * What the runner was told about the change, read strictly.
 *
 * A list is believed only when it is a list of text. Anything else — a
 * caller that answered with nothing, a list holding something that is not a
 * path — is "not known", which runs every part.
 * @param {unknown} told What the `change` function answered.
 * @returns {{paths: string[]|null, note: string|null}} The change.
 */
function readChange(told) {
  const paths = /** @type {{paths?: unknown}|null|undefined} */ (told)?.paths;
  const note = /** @type {{note?: unknown}|null|undefined} */ (told)?.note;
  return {
    paths:
      Array.isArray(paths) && paths.every(path => typeof path === "string")
        ? paths
        : null,
    note: typeof note === "string" && note !== "" ? note : null,
  };
}

/**
 * Ask what the change touches, and treat any failure to answer as "not
 * known".
 *
 * Working out the change is there to save time, and it must never cost a
 * verdict. If the question itself breaks, the run goes on with every part,
 * and says why: stopping here would refuse every commit over a fault in the
 * narrowing, and guessing would leave a part out.
 * @param {() => unknown} change The `change` function `runGates` was given.
 * @param {string} moment The moment being run.
 * @returns {{paths: string[]|null, note: string|null}} The change.
 */
function askChange(change, moment) {
  try {
    return readChange(change());
  } catch (error) {
    // probe-direction: fail-closed — a change that could not be worked out,
    // for whatever reason, is not known, and every part runs.
    return {
      paths: null,
      note:
        `Every part runs at ${moment}: what the change touches could not ` +
        `be worked out (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}

/**
 * The verdict of a part the change does not touch, or null to run it.
 *
 * Asked only of a part that could start: one that could not says so itself,
 * whatever the change touches, so a broken declaration is not hidden until
 * somebody edits that folder.
 *
 * A part for the whole repository always applies, and is answered without
 * asking what changed at all. A folder that resolves to the repository root
 * is the same thing under another name.
 *
 * The folder is matched under both of its spellings — the one declared, and
 * the one it resolves to on disk. They differ only when the declared name is
 * a link, and a change made where the link leads is a change to that part.
 * @param {GateOutcome} gate One part of a gate.
 * @param {{directory: string, resolved: string}} start Where it would start.
 * @param {() => {paths: string[]|null, note: string|null}} change Asks what
 *   the change touches. Called at most once per run, by `runGates`.
 * @returns {{state: string, untouched: true, detail: string, code: null}|null}
 *   The verdict, or null when the part must run.
 */
function untouchedOutcome(gate, start, change) {
  if (gate.scope === WHOLE_REPOSITORY || start.resolved === "") return null;
  const { paths } = change();
  if (paths === null) return null;
  if (touchesFolder(paths, [gate.scope, start.resolved])) return null;
  return {
    state: STATE.SKIPPED,
    untouched: true,
    detail:
      `the change touches nothing inside ${JSON.stringify(gate.scope)}, so ` +
      `${shownArgv(gate.argv)} was not run. Not counted as proved`,
    code: null,
  };
}

/**
 * What a run is shared and explained under: the thing that actually ran.
 *
 * For a gate, its command line, exactly as before. For a part, its folder
 * together with its argument list — the same list in two folders is two
 * different checks, and two gates naming one list in one folder are one. The
 * leading NUL keeps a part's key apart from every command line, which cannot
 * hold one.
 * @param {GateOutcome} gate The resolved gate.
 * @returns {string|null} The key, or null when the gate runs nothing.
 */
function proverKey(gate) {
  if (!isPart(gate)) return gate.command;
  return `\0part\0${JSON.stringify([gate.scope ?? null, gate.argv ?? null])}`;
}

/**
 * Summarise a completed run in operator-readable lines.
 *
 * Deliberately never emits an unqualified "all gates passed" while an optional
 * gate is failing. A summary that hides a failure under a green headline is
 * the same defect as a check that reports success without running.
 * @param {GateRun} result The result of `runGates`.
 * @param {Array<object>} [priorKills] Marks left by EARLIER runs, captured
 *   before this run started. Passed in rather than read here so this function
 *   stays a pure rendering of its inputs, and so a run can never report its
 *   own kill back to itself as prior context.
 * @returns {string[]} Summary lines.
 */
function summarise(result, priorKills = []) {
  const lines = [];
  const truly = result.failed.filter(entry => entry.state === STATE.FAILED);
  const byLevel = level => truly.filter(entry => entry.level === level);
  const failedOptional = byLevel("optional");

  for (const entry of byLevel("required")) {
    lines.push(`❌ required gate FAILED: ${nameOf(entry)} — ${entry.detail}`);
  }
  for (const entry of failedOptional) {
    lines.push(
      `⚠️  optional gate FAILED: ${nameOf(entry)} — ${entry.detail} ` +
        `(reported, not blocking)`
    );
  }
  // A kill is NOT PROVED like the rest of `MEASURED_NOTHING`, and it says WHY
  // in the headline rather than only in the detail. The two facts a reader
  // needs are opposite responses: an unprovable gate asks them to look at the
  // sibling that failed, a killed one asks them to look at the machine. Both
  // block; neither is the word "failed".
  for (const entry of result.killed) {
    lines.push(
      `🛑 ${entry.level} gate NOT PROVED — KILLED: ${nameOf(entry)} — ${entry.detail}`
    );
  }
  // Its own headline, and deliberately not the word "failed". A property
  // nobody measured has not been found wanting, and saying it failed sends the
  // reader hunting a regression that may not exist — which is exactly what six
  // sightings of a starved suite each cost.
  for (const entry of result.unprovable) {
    lines.push(
      `❓ ${entry.level} gate NOT PROVED: ${nameOf(entry)} — ${entry.detail}`
    );
  }

  // Only alongside a result that went wrong. Attached to a clean pass it would
  // be noise on every run for an hour after any kill, and a note nobody reads
  // is a note that cannot help the one time it matters.
  if (result.failed.length > 0 || result.notRun.length > 0) {
    for (const line of killMarkNote(priorKills)) lines.push(line);
  }
  // Two different sentences on purpose. Rendering these as one "skipped"
  // bucket is what makes an early failure produce a report whose later gates
  // are silently unknown, with nothing telling the reader that they are.
  if (result.notRun.length) {
    lines.push(
      `❓ ${result.notRun.length} gate(s) UNKNOWN — never ran, verdict not ` +
        `established: ${result.notRun.map(nameOf).join(", ")}`
    );
    // `blockedBy` is a gate id, and every part of a gate shares it. The first
    // required result of that gate to go unproved is the one that stopped the
    // rest, and for a part its name says which folder that was.
    const blocker = result.results.find(
      entry =>
        entry.id === result.blockedBy &&
        entry.level === "required" &&
        result.failed.includes(entry)
    );
    const whyStopped = result.interrupted
      ? "The run was interrupted before it reached them."
      : `${blocker ? nameOf(blocker) : result.blockedBy} failed first and stopped them.`;
    lines.push(
      `   Each of those may pass or fail; this run does not say which. ${whyStopped}`
    );
  }
  if (result.blocked) {
    if (result.skipped.length) {
      lines.push(
        `⏭️  ${result.skipped.length} gate(s) NOT APPLICABLE here — their ` +
          `verdict IS established, there was nothing to run: ` +
          `${result.skipped.map(nameOf).join(", ")}`
      );
    }
    // The headline an interrupted run gets INSTEAD of the completion one
    // below. Two reports that differ only in their counts are two reports a
    // reader will conflate, and conflating them is the defect: a chain that
    // stopped because nobody was left to receive its verdict reads exactly
    // like a chain that finished, right down to the tally.
    if (result.interrupted) {
      lines.push(
        `🛑 ${result.moment}: INTERRUPTED, not completed — ` +
          `${result.interrupted}. ${result.passed.length} of ` +
          `${result.total} gate(s) were proved before it stopped; the rest ` +
          `were not proved. This is NOT a pass.`
      );
    }
    return lines;
  }

  // Every count is stated, including the ones that are zero, so the headline
  // can never imply more was proved than actually ran.
  //
  // `unprovable` and `killed` are in the line because they are REACHABLE here,
  // which is easy to miss: this branch runs only when the run is not blocked,
  // and `blocked` is set exclusively by a REQUIRED gate going unproved. An
  // OPTIONAL gate the machine killed, or one that ran and proved nothing,
  // leaves the run unblocked and lands in a bucket the headline used to omit —
  // while the lines directly above named that gate individually. The two halves
  // of one report disagreeing is worse than a headline that never promised
  // completeness, because the promise is what makes `total` minus the stated
  // numbers mean anything.
  //
  // These five are exhaustive on this path, so they sum to `total`: a required
  // FAILED/UNPROVABLE/KILLED gate would have blocked and returned above, and
  // `notRun` is populated only once something has blocked.
  const untouched = result.skipped.filter(entry => entry.untouched).length;
  const counts =
    `${result.passed.length} proved, ${failedOptional.length} failed ` +
    `(optional), ${result.unprovable.length} not proved, ` +
    `${result.killed.length} killed, ` +
    `${result.skipped.length} not applicable here`;
  lines.push(
    `${failedOptional.length ? "⚠️ " : "✅"} ${result.moment}: ${counts}, ` +
      `of ${result.total} gate(s) declared.${
        failedOptional.length ? " See the optional failure(s) above." : ""
      }${
        // The tally counts lines of this report. Without the sentence, a gate
        // with three parts reads as three gates to anyone who knows how many
        // the project declared.
        result.results.some(isPart)
          ? " Each part of a gate is counted on its own."
          : ""
      }${
        // Said in the tally itself, because the tally is what gets quoted: a
        // part left out is in the last number, and never in the first.
        untouched
          ? ` ${untouched} part(s) this change does not touch were not run, ` +
            `and are counted as not applicable, never as proved.`
          : ""
      }`
  );
  return lines;
}

/**
 * Reach one gate's verdict, and report how it was reached.
 *
 * The order of the three sources is the whole content of this function. A
 * gate's own skip is decided first, because a skip comes from `needs` — a
 * missing tool, an absent credential — which is a fact about this gate and not
 * about the command. A gate that cannot run must say so rather than inherit a
 * verdict from a sibling that could.
 *
 * A shared result is honoured next, and honoured even once the run is blocked.
 * The command genuinely ran and its answer is known, so reporting NOT-RUN there
 * would understate what was proved — the mirror image of overstating it, and
 * just as untrue.
 *
 * A part adds two questions in front of all of that. May its command start at
 * all, and where: see `partStart`. And does the change touch its folder: see
 * `untouchedOutcome`. A part left out is settled there, before the pass cache
 * and before any shared result are looked at, so it is never read from either
 * and never written to either.
 * @param {GateOutcome} gate The resolved gate.
 * @param {{proved: Map<string, object>, blockedBy: string|null, exec: Function, execArgv: Function, start: {directory: string, resolved: string}|{problem: string}|null, builtins: boolean, change: Function}} ctx
 *   Run state. `start` is `partStart`'s answer for a part, and null for a
 *   gate with no parts; the caller asks, because it records where the part's
 *   folder really is beside the verdict.
 * @returns {{outcome: object, shared: object|undefined, ran: boolean}} The verdict.
 */
function verdictFor(
  gate,
  {
    proved,
    blockedBy,
    exec,
    execArgv,
    start,
    builtins,
    siblings,
    declarations,
    cache,
    change,
  }
) {
  const own =
    classifyStatic(gate, builtins) ??
    (start !== null && "problem" in start
      ? partNotStarted(start.problem)
      : null);
  if (own) return { outcome: own, shared: undefined, ran: false };

  const leftOut = start === null ? null : untouchedOutcome(gate, start, change);
  if (leftOut) return { outcome: leftOut, shared: undefined, ran: false };

  // A remembered pass for this exact content (CodySwannGT/lisa#4594). It is a
  // known verdict, so it is honoured even once the run is blocked, exactly as
  // a shared result is. It is never shared onward: a sibling computes its own
  // key, and a sibling marked `"cache": false` must run the command itself.
  const hit = cache?.lookup(gate) ?? null;
  if (hit) {
    return {
      outcome: {
        state: STATE.PASSED,
        detail: `CACHED PASS (${hit.key.slice(0, 12)}) ${gate.command}`,
        code: 0,
        diagnosis: null,
        evidence: [],
        cached: true,
      },
      shared: undefined,
      ran: false,
    };
  }

  const key = proverKey(gate);
  const shared = key ? proved.get(key) : undefined;
  if (shared) {
    // The RAW outcome is what is shared, and each gate reads it for itself.
    // Sharing the already-attributed view would hand the second gate the first
    // gate's reading of whose failure it was, which is how one exit code came
    // to be reported as two failures in the first place.
    const view = attributed(gate, shared.outcome, siblings);
    return {
      outcome: {
        ...view,
        detail: `${view.detail} (proved by the ${shared.name} run)`,
      },
      shared,
      ran: false,
    };
  }

  // "Not run" and "not applicable" are opposite facts and must never render
  // as one another. A SKIPPED gate has a known verdict — there was nothing to
  // run here, and that is the answer. This one has NO verdict: it might pass,
  // it might fail, and this run does not say. Naming the blocker is what lets
  // a reader tell which of the two they are looking at without guessing.
  //
  // Only COSTLY gates stop, though. Short-circuiting everything is what let an
  // intermittent test failure take the work-item check and the type check with
  // it — two checks that finish in under a minute and answer questions a test
  // suite says nothing about. Those now run, so one attempt reports everything
  // that is wrong. A second full suite still does not: paying minutes for
  // information about a push that cannot land is a bad trade.
  if (blockedBy && gate.costly) {
    return {
      outcome: {
        state: STATE.NOT_RUN,
        detail:
          `verdict UNKNOWN — never ran; ${blockedBy} failed first and this ` +
          `gate is too expensive to run for information alone`,
        code: null,
      },
      shared: undefined,
      ran: false,
    };
  }
  const raw =
    start === null
      ? execute(gate, exec, declarations)
      : executePart(gate, execArgv, start.directory, declarations);
  return {
    outcome: attributed(gate, raw, siblings),
    raw,
    shared: undefined,
    ran: true,
  };
}

/**
 * Run every gate declared at one moment.
 *
 * `exec` is injected rather than imported so tests never spawn a process, and
 * so a caller can substitute a different execution substrate without this
 * file's verdict logic changing.
 * @param {object} options Run inputs.
 * @param {object} options.gates The gates block from `.lisa.config.json`.
 * @param {string} options.moment The moment to run.
 * @param {string} [options.runner] Task-runner prefix, e.g. `bun run`.
 * @param {(command: string, gate: GateOutcome) => (number|null|undefined|{code: number|null, output: string|null})} options.exec
 *   Executor. BOTH shapes, because `normaliseExec` accepts both and the shipped
 *   default executor returns the object one. Declaring only `number|null` here
 *   was not merely narrow, it was wrong about the case this runner exists to
 *   report: a command killed by a signal has a `null` code AND a captured
 *   transcript, and a number-only type can express the null while silently
 *   erasing the transcript that says what the run was doing when it died.
 *   A type that cannot describe `spawnExec` is a type no caller can trust.
 * @param {(argv: string[], context: {cwd: string, gate: GateOutcome}) => (number|null|undefined|{code: number|null, output: string|null, signal?: string, notStarted?: string})} [options.execArgv]
 *   Executor for one PART of a gate: an argument list, and the folder to start
 *   it in. Separate from `exec` because the two take different things on
 *   purpose — `exec` takes one line of text for a shell, and a part's command
 *   must never become one. Defaults to `spawnArgv`; injected by tests for the
 *   reason `exec` is. An answer carrying `notStarted` says the program could
 *   not be started at all, and why.
 * @param {string} [options.root] The repository root, which every part's
 *   folder is resolved inside. Defaults to the working directory, where the
 *   hooks start this runner.
 * @param {(line: string) => void} [options.out] Line sink; defaults to stdout.
 * @param {Record<string, string>|null} [options.scripts] The project's package
 *   scripts, from `projectScripts`. `null` means unknown, and an unknown
 *   manifest resolves exactly as it did before `shippedAs` was consulted.
 * @param {Array<object>} [options.priorKills] Marks left by EARLIER runs.
 *   Injected for the same reason `exec` is: a test states the machine's recent
 *   history instead of having to terminate a real run an hour ago. Defaults to
 *   reading them, and the default is evaluated HERE — before any gate runs —
 *   so a run cannot read back the mark it is about to write.
 * @param {(kill: {kind: string, gateId: string}) => boolean} [options.recordKill]
 *   Kill-marker writer, injectable so marker cardinality can be proved without
 *   writing to the host's shared marker directory.
 * @param {() => (string|null)} [options.interrupted] Asks, between gates and before returning,
 *   whether the run this chain serves is still there. Injectable for the same
 *   reason `exec` is: a test states that the caller went away instead of having
 *   to kill a real hook mid-chain.
 * @param {() => number} [options.clock] Epoch-ms clock used to time each gate
 *   for the push timing report (CodySwannGT/lisa#4591). Injectable so a test
 *   states durations instead of racing a real clock.
 * @param {{lookup: (gate: GateOutcome) => ({key: string}|null), remember: (gate: GateOutcome, durationMs: number|null) => void, commit: () => void}|null} [options.cache]
 *   The push-gate pass cache from `openGatePassCache`, or null for none. A
 *   lookup hit reports `CACHED PASS` without running; only full passes are
 *   handed to `remember`, and `commit` writes them once the run is over.
 * @param {{read: (command: string) => ({selection?: string, coverage?: string}|null)}|null} [options.selection]
 *   What each command reported about the tests it selected, from
 *   `openSelectionReports` (CodySwannGT/lisa#4600), or null for none. A
 *   partial selection is never remembered by the cache, and one run with
 *   coverage off reports coverage-adequacy SKIPPED.
 * @param {boolean} [options.builtins] Whether the caller of this run has
 *   built-in checks of its own to prove what the registry leaves to them.
 *   True by default, which is every hook a stack template ships. False for a
 *   caller with none (`--builtins=none`): a gate resolved to `builtin` is then
 *   reported as not proved, because nothing is left to prove it.
 * @param {boolean} [options.completeParts] Keep running costly parts after a required part fails.
 * @param {() => ({paths: string[]|null, note: string|null})} [options.change]
 *   Says which paths the change touches (CodySwannGT/lisa#4988), as
 *   `changeAt` in `lib/changed-paths` answers it. `paths: null` means "not
 *   known", and is the default: every part runs. Called at most once, and
 *   only when the moment has a part for a folder, so a gates block with no
 *   parts never asks. `note` is printed once, before the first such part.
 * @returns {GateRun} What every declared gate at this moment produced.
 */
export function runGates({
  gates,
  moment,
  runner = "npm run",
  exec,
  execArgv = spawnArgv,
  root = process.cwd(),
  out = line => console.log(line),
  scripts = null,
  priorKills = recentKillMarks(),
  recordKill = recordKillMark,
  interrupted = runInterruption,
  clock = Date.now,
  cache = null,
  selection = null,
  builtins = true,
  completeParts = false,
  change = () => ({ paths: null, note: null }),
}) {
  const resolved = resolveMoment({ gates, moment, runner, scripts });
  // What the change touches, asked for when the first part for a folder is
  // reached and never again. Said once, where it is first used, so the
  // reader of a NOT APPLICABLE line has already been told what the change is.
  let known = null;
  const changeOnce = () => {
    if (known === null) {
      known = askChange(change, moment);
      if (known.note !== null) out(`  🔎 ${known.note}`);
    }
    return known;
  };
  const results = [];
  // The id of the first required gate to go unproved, not merely a boolean:
  // every gate queued behind it has to be able to say WHAT stopped it, or its
  // line is indistinguishable from a gate that had nothing to run.
  let blockedBy = null;
  // The same gate as an operator reads it: for a part, with its folder.
  let blocker = null;

  // Which gates name each command, built before anything runs. Attribution
  // needs the answer on the FIRST execution: gates run alphabetically, so the
  // gate that executes a shared prover is usually not the gate whose property
  // the failure belongs to — `coverage-adequacy` runs `test:cov` and
  // `test-correctness` is the one the timeout indicts.
  const sharers = new Map();
  // Declared failure shapes, keyed the same way and for the same reason: one
  // command runs once, and the shape that explains its output may have been
  // declared by a gate other than the one that happened to run it.
  const declaredShapes = new Map();
  for (const gate of resolved) {
    const key = proverKey(gate);
    if (!key) continue;
    sharers.set(key, (sharers.get(key) ?? new Set()).add(gate.id));
    if (!Array.isArray(gate.failureShape) || gate.failureShape.length === 0) {
      continue;
    }
    declaredShapes.set(key, [
      ...(declaredShapes.get(key) ?? []),
      { gate: gate.id, shape: gate.failureShape },
    ]);
  }

  // One command proves every gate that names it, so it runs once.
  //
  // Two gates legitimately share a prover: a coverage-instrumented suite proves
  // `test-correctness` by passing and `coverage-adequacy` by clearing its
  // threshold. Running it twice cannot prove more than running it once, and it
  // is not merely wasteful — measured here, the second run of an identical
  // `test:cov` failed seconds after the first passed. A red that means nothing
  // costs the register the same trust a false pass does, because it teaches
  // whoever reads it to retry rather than look.
  const proved = new Map();

  // Each verdict is printed as it is reached, not batched at the end: a push
  // gate can run for minutes, and an operator watching a hook needs to know
  // which gate is being proved right now, not only what the tally was.
  // Set once, by the first gate boundary at which the run's caller is gone.
  // Asked between gates rather than only at the start, because the interrupt
  // this exists for arrives DURING the chain — that is the whole shape of the
  // incident: a hook killed while the push gates were minutes into running.
  let interruption = null;

  for (const gate of resolved) {
    interruption ??= interrupted();
    if (interruption !== null) {
      // NOT_RUN, not SKIPPED: a skipped gate has a verdict — there was nothing
      // to run — and these have none. The run stopped before reaching them and
      // says so, rather than letting an operator read a short report as a
      // complete one.
      const detail =
        `verdict UNKNOWN — never ran; the run was interrupted ` +
        `(${interruption}) before reaching this gate`;
      results.push({
        ...gate,
        state: STATE.NOT_RUN,
        detail,
        code: null,
        diagnosis: null,
        evidence: [],
        provedBy: null,
        startedAt: null,
        durationMs: 0,
      });
      out(formatLine(STATE.NOT_RUN, gate, detail));
      continue;
    }
    const began = clock();
    const key = proverKey(gate);
    const start = isPart(gate) ? partStart(gate, root) : null;
    const verdict = verdictFor(gate, {
      proved,
      blockedBy: completeParts && isPart(gate) ? null : blocker,
      exec,
      execArgv,
      start,
      builtins,
      siblings: sharers.get(key) ?? new Set(),
      declarations: declaredShapes.get(key) ?? [],
      cache,
      change: changeOnce,
    });
    const { shared, ran, raw } = verdict;
    // What the command said it selected (CodySwannGT/lisa#4600). A partial
    // selection is never remembered as a pass, and with coverage switched off
    // coverage-adequacy reports SKIPPED: its property was not measured here,
    // and CI's full run enforces it before merge.
    const report =
      gate.command && !verdict.outcome.cached
        ? (selection?.read(gate.command) ?? null)
        : null;
    const outcome = coverageLeftToCi(gate, report)
      ? {
          state: STATE.SKIPPED,
          detail: `${PARTIAL_COVERAGE_SKIP_REASON} (${gate.command})`,
          code: null,
          diagnosis: null,
          evidence: [],
        }
      : verdict.outcome;
    // One end reading per gate: the timing report and the pass cache share it.
    const elapsedMs = Math.max(0, clock() - began);
    const durationMs = ran ? elapsedMs : shared?.durationMs;

    // Only what this iteration actually executed is shareable, and `ran` says
    // so explicitly rather than being inferred from the exit code. `execute`
    // reports `code: null` for a command killed by a signal, so an exit-code
    // test would treat a terminated run as never having happened and send the
    // next gate to run it again — re-running a whole suite an operator has
    // just interrupted.
    if (ran && key) {
      proved.set(key, {
        id: gate.id,
        name: nameOf(gate),
        outcome: raw ?? outcome,
        durationMs,
      });
    }
    // Only a FULL pass is remembered: this gate's own verdict passed, and so
    // did the run that produced it — never a pass read off a shared prover
    // whose own outcome was anything else. Written after the run, by `commit`.
    const source = ran ? raw : shared?.outcome;
    if (
      cache &&
      report?.selection !== "partial" &&
      outcome.state === STATE.PASSED &&
      !outcome.cached &&
      source?.state === STATE.PASSED
    ) {
      cache.remember(gate, durationMs ?? null);
    }

    // A gate proved by a sibling's run takes no time of its own.
    results.push({
      ...gate,
      ...outcome,
      // Where the part's folder really is, kept beside its verdict: whether
      // the parts that ran reached the whole change is worked out from the
      // rows afterwards (`unreachedFloor`), under both of a folder's names.
      ...(start !== null && "resolved" in start
        ? { resolved: start.resolved }
        : {}),
      provedBy: shared?.id ?? null,
      startedAt: new Date(began).toISOString(),
      durationMs: shared ? 0 : elapsedMs,
    });
    out(formatLine(shownState(outcome), gate, outcome.detail));
    for (const line of outcome.evidence ?? []) out(`${" ".repeat(6)}↳ ${line}`);
    const unproved =
      outcome.state === STATE.FAILED ||
      outcome.state === STATE.UNPROVABLE ||
      outcome.state === STATE.KILLED;
    // The strictest level wins when gates share a prover. Letting a required
    // gate inherit only the pass, or letting a failure count only against the
    // optional gate that ran first, would be the original defect again: a
    // required gate satisfied by a run that failed.
    if (unproved && gate.level === "required" && !blockedBy) {
      blockedBy = gate.id;
      blocker = nameOf(gate);
    }
  }

  // The caller may disappear while the FINAL gate executes. There is then no
  // next iteration to observe it, and an optional gate cannot block on its own.
  // Record the interruption before this result can claim completion.
  interruption ??= interrupted();
  cache?.commit();

  const bucket = state => results.filter(entry => entry.state === state);
  const result = {
    moment,
    // An interrupted run blocks for the same reason a failed one does, and it
    // is important that it blocks WITHOUT a `blockedBy`: no gate failed here.
    // Borrowing a gate id to explain the stop would send an operator hunting a
    // regression that does not exist.
    blocked: blockedBy !== null || interruption !== null,
    blockedBy,
    interrupted: interruption,
    total: resolved.length,
    results,
    passed: bucket(STATE.PASSED),
    // A killed gate is counted among the ones this run did not prove, for the
    // same reason an unprovable one is: a required property nobody measured is
    // not a pass. The new bucket renames the outcome; it does not excuse it.
    failed: [
      ...bucket(STATE.FAILED),
      ...bucket(STATE.UNPROVABLE),
      ...bucket(STATE.KILLED),
    ],
    unprovable: bucket(STATE.UNPROVABLE),
    killed: bucket(STATE.KILLED),
    skipped: bucket(STATE.SKIPPED),
    notRun: bucket(STATE.NOT_RUN),
    // What this run was told the change touches, kept for whoever decides
    // afterwards what the run covered. Never asked is "not known": a run
    // with no part for a folder had no reason to find out.
    change: { paths: known?.paths ?? null },
  };
  // Left for a LATER run, because this one already knows. The note only ever
  // helps a different run whose own output carries no trace of the machine.
  for (const entry of result.killed.filter(entry => entry.provedBy === null)) {
    recordKill({ kind: STATE.KILLED, gateId: entry.id });
  }
  for (const line of summarise(result, priorKills)) out(line);
  const cached = result.passed.filter(entry => entry.cached).length;
  if (cached) {
    out(
      `   ${cached} of those proved by a remembered pass for this exact tree.`
    );
  }
  return result;
}

/**
 * Floor properties this moment's gates block says nothing at all about.
 *
 * Presence is what is checked, not level: declaring `"off"` is a decision on
 * the record and satisfies the floor. What the floor catches is silence — a
 * property that stops being proved because nobody noticed it was missing.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment being run.
 * @param {string[]} [options.wired] Conditional floor ids this project wired,
 *   from `wiredConditionalFloor`. Empty by default so the comparison stays
 *   pure: what the project has installed is a separate reading of the disk.
 * @returns {string[]} Undeclared floor gate ids.
 */
export function undeclaredFloor({ gates, moment, wired = [] }) {
  const floor = [...(BUILTIN_FLOOR[moment] ?? []), ...wired];
  return floor.filter(id => gates?.[id]?.[moment] === undefined);
}

/**
 * Floor properties this moment's gates block DOES declare — its exact
 * complement.
 *
 * Presence, not level, for the same reason: `"off"` is a decision on the
 * record. A property declared off is one the project has said it does not want
 * proved, and the built-in step standing down is that decision taking effect;
 * silence is the case where nobody decided anything, and there the step runs.
 *
 * DECLARED IS NOT PROVED, and this function answers only the first. What
 * `--coverage` writes out is `provenFloor`, which narrows this by what the run
 * actually established. Calling this one the coverage answer is the defect
 * `provenFloor` exists to fix.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment being run.
 * @param {string[]} [options.wired] Conditional floor ids this project wired.
 * @returns {string[]} Declared floor gate ids.
 */
export function coveredFloor({ gates, moment, wired = [] }) {
  const floor = [...(BUILTIN_FLOOR[moment] ?? []), ...wired];
  return floor.filter(id => gates?.[id]?.[moment] !== undefined);
}

/**
 * Per-gate states in which the registry established nothing about a property.
 *
 * Every one of these is a leg that did NOT prove its gate: FAILED measured the
 * property and found it wanting, UNPROVABLE and KILLED never measured it at
 * all, and NOT_RUN never started. None of them can carry a built-in step's
 * stand-down, and the whole point of listing them by name is that "the leg ran"
 * and "the leg succeeded" are different claims.
 */
const UNPROVED_STATES = new Set([
  STATE.FAILED,
  STATE.UNPROVABLE,
  STATE.KILLED,
  STATE.NOT_RUN,
]);

/**
 * Floor properties this run actually PROVED — the answer `--coverage` writes.
 *
 * ## Why this is not `coveredFloor`
 *
 * `--coverage` is read by a shell hook that stands its own built-in step down
 * against every name in the file. Writing the DECLARED set there says "this
 * property is somebody's job" when the hook reads it as "this property is
 * done", and those diverge the moment a leg errors.
 *
 * Measured, on a real push: an OPTIONAL gate ran, exited nonzero, and was
 * classified UNPROVABLE. `blocked` is set only by a REQUIRED gate going
 * unproved, so the run was not blocked and the runner exited 0 — while the
 * coverage file, written before the gate ever ran, already named it. The hook
 * saw exit 0 and a matching line, printed "Covered by the type-correctness
 * gate; the built-in type check stands down", and allowed the push. The type
 * check ran at NEITHER layer and the exit code was success. A declared gate
 * became a quieter way of turning a check off than declaring it `off`, which is
 * the one thing this subsystem exists to refuse.
 *
 * ## What still counts as covered
 *
 * A gate declared `off` never reaches `resolveMoment` (which drops `off`
 * unless asked for it), so it is in `declared`, absent from `result.results`,
 * and stays covered. That is deliberate and unchanged: `off` is a decision on
 * the record, and the built-in standing down is that decision taking effect.
 *
 * A SKIPPED gate keeps its coverage too — its verdict IS established, there was
 * nothing to run here. (`await` mode is the arguable member of that bucket:
 * `unconfiguredAt` in lisa-gates.mjs reads an awaited gate as proving nothing
 * locally, so the two files disagree about it. That divergence predates this
 * function and is deliberately left alone here — it is a design question about
 * whether a CI signal may retire a local step, not the errored-leg defect.)
 *
 * ## A gate with parts is covered only when they reached the whole change
 *
 * The hook stands its check down for the WHOLE commit or push, and a part
 * looks at one folder. So a gate with parts is named here only when every
 * path the change touches is inside the folder of a part that ran. A change
 * to `api/a.go` and `tools/b.js`, with parts for `api` and `web`, runs the
 * `api` part and leaves `tools/b.js` to nobody: the caller's built-in check
 * is the only thing left that can look at it, so the gate is withheld and
 * that check runs. The same holds when no part ran at all, and when the
 * change is not known and no part covers the whole repository
 * (CodySwannGT/lisa#4988). See `unreachedFloor`, which says why for each.
 *
 * Fail-safe on the input: no result means no run, and no run proves nothing.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment being run.
 * @param {string[]} [options.wired] Conditional floor ids this project wired.
 * @param {GateRun|null} [options.result] What `runGates` produced.
 * @returns {string[]} Floor gate ids this run may stand a built-in step down on.
 */
export function provenFloor({ gates, moment, wired = [], result = null }) {
  const declared = coveredFloor({ gates, moment, wired });
  if (!result) return [];
  // Delegation leaves the built-in responsible for running the check; adding
  // it to the coverage file would tell that same hook to stand down.
  const unproved = new Set(
    (result.results ?? [])
      .filter(
        entry => entry.mode === "builtin" || UNPROVED_STATES.has(entry.state)
      )
      .map(entry => entry.id)
  );
  const unreached = new Set(
    unreachedFloor({ gates, moment, wired, result }).map(entry => entry.id)
  );
  return declared.filter(id => !unproved.has(id) && !unreached.has(id));
}

/** How every reason `unreachedFloor` gives ends: what the caller does next. */
const BUILT_IN_STILL_RUNS = "so the built-in check for it still runs.";

/** The most changed paths one reason names before it counts the rest. */
const PATHS_NAMED = 3;

/**
 * Changed paths as an operator reads them in one line: the first few, each
 * quoted so a space or an odd character in a name cannot be misread, and a
 * count of the rest.
 * @param {string[]} paths Changed paths; at least one.
 * @returns {string} The paths, for the middle of a sentence.
 */
function namedPaths(paths) {
  const named = paths
    .slice(0, PATHS_NAMED)
    .map(path => JSON.stringify(path))
    .join(", ");
  const rest = paths.length - PATHS_NAMED;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * Why the parts of one gate did not reach the whole change, or null when
 * they did.
 *
 * Three answers keep the caller's built-in check, and each is the same fact
 * seen from a different side — some path of this change was looked at by no
 * part:
 *
 * - No part ran. The change touches none of the gate's folders.
 * - A changed path is inside no part that ran.
 * - The change is not known, and no part that ran covers the whole
 *   repository. Every part ran, and nothing says their folders are all of
 *   the change: a commit that edits `.lisa.config.json` is "not known", and
 *   that file is outside every folder a part can name except `.`.
 *
 * A part for the whole repository that ran reaches every path there is, so
 * with one the answer is null whatever the change touches, known or not.
 *
 * A path is covered only when it is a part's folder or lies inside it —
 * `pathsOutside`, read strictly and compared exactly (`API` is not `api`),
 * and under both names a linked folder has.
 * A row that does not say where its folder really is (one a caller wrote by
 * hand) is matched under its declared name alone, which can only keep a
 * built-in check that could have stood down.
 * @param {string} id The gate id.
 * @param {GateOutcome[]} parts The gate's rows, one per part.
 * @param {string[]|null} paths The changed paths, or null when not known.
 * @returns {string|null} The reason, finishing `BUILT_IN_STILL_RUNS`, or null.
 */
function unreachedReason(id, parts, paths) {
  const ran = parts.filter(part => part.untouched !== true);
  if (ran.length === 0) {
    return `No part of ${id} applies to this change, ${BUILT_IN_STILL_RUNS}`;
  }
  const whole = ran.some(
    part => part.scope === WHOLE_REPOSITORY || part.resolved === ""
  );
  if (whole) return null;
  if (paths === null) {
    return (
      `What this change touches is not known and ${id} has no part for the ` +
      `whole repository, ${BUILT_IN_STILL_RUNS}`
    );
  }
  const folders = ran.flatMap(part =>
    [part.scope, part.resolved].filter(folder => typeof folder === "string")
  );
  const outside = pathsOutside(paths, folders);
  return outside.length === 0
    ? null
    : `${id} has no part for ${outside.length} path(s) this change touches ` +
        `(${namedPaths(outside)}), ${BUILT_IN_STILL_RUNS}`;
}

/**
 * Floor properties whose parts did not reach every path of this change, and
 * why.
 *
 * Each of these is declared and was not found wanting by the parts that ran,
 * and still proved nothing about some path the change touches. `provenFloor`
 * withholds them, and `main` prints each reason so the operator knows why a
 * built-in check still ran. A gate with no parts is never listed: its one
 * command is the project's check for the whole repository.
 *
 * A gate that failed or went unproved may be listed too. `provenFloor`
 * withholds it on either count, and `main` blocks before it prints these.
 * @param {object} options Inputs.
 * @param {object} options.gates The gates block.
 * @param {string} options.moment The moment being run.
 * @param {string[]} [options.wired] Conditional floor ids this project wired.
 * @param {GateRun|null} [options.result] What `runGates` produced. Read for
 *   its rows and for `change.paths`; a result with no `change` is read as a
 *   change that is not known.
 * @returns {Array<{id: string, reason: string}>} One entry per floor gate
 *   whose built-in check is kept, in floor order.
 */
export function unreachedFloor({ gates, moment, wired = [], result = null }) {
  const results = result?.results ?? [];
  const told = result?.change?.paths;
  const paths =
    Array.isArray(told) && told.every(path => typeof path === "string")
      ? told
      : null;
  return coveredFloor({ gates, moment, wired }).flatMap(id => {
    const parts = results.filter(entry => entry.id === id && isPart(entry));
    if (parts.length === 0) return [];
    const reason = unreachedReason(id, parts, paths);
    return reason === null ? [] : [{ id, reason }];
  });
}

/**
 * Which conditional floor steps this project has actually wired.
 *
 * An unreadable `package.json` counts every scripted entry as wired. The
 * question being answered is "may this moment be handed to the registry", and
 * the answer under uncertainty has to be no — guessing "not wired" would hand
 * over a moment whose built-in steps might have been proving something.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment being run.
 * @param {string} [options.cwd] Project root.
 * @returns {string[]} Conditional floor gate ids in force here.
 */
export function wiredConditionalFloor({ moment, cwd = process.cwd() }) {
  const scripts = readPackageScripts(cwd);
  return (CONDITIONAL_FLOOR[moment] ?? [])
    .filter(
      entry =>
        entry.files.some(file => existsSync(join(cwd, file))) ||
        entry.scripts.some(
          name => scripts === null || Object.hasOwn(scripts, name)
        )
    )
    .map(entry => entry.id);
}

/**
 * The `scripts` block of a project's `package.json`.
 * @param {string} cwd Project root.
 * @returns {Record<string, string>|null} The scripts, or null when unreadable.
 */
function readPackageScripts(cwd) {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"))?.scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * Hang-detector deadline for one gate command, in milliseconds.
 *
 * Two hours, and deliberately not the shared default. The child here is the
 * PROJECT's own gate command — `test:unit`, `test:integration`, a mutation run
 * — which legitimately takes minutes and occasionally much longer on a loaded
 * machine. A deadline sized for a `git` call would make this module's own
 * timeout the ordinary outcome of running the test suite, which is the failure
 * mode CodySwannGT/lisa#2980 exists to prevent, committed by its own fix.
 *
 * So this is a ceiling on "has stopped making progress", not a budget for "how
 * long should this take". A gate still running after two hours is not going to
 * finish, and every CI job that would host one caps out well below it.
 *
 * `code: null` routes into the KILLED diagnosis, which prints `NOT PROVED —
 * KILLED` and counts the gate among those this run did not prove (#3032). That
 * verdict was right; REACHING it was the part that was wrong. The executors
 * below read `child.error` on the RETURNED result, which is plain `spawnSync`'s
 * shape — `boundedSpawnSync` reports a kill by throwing instead, so the branch
 * that produced `code: null` never ran for a kill and the throw surfaced as
 * "Gate runner crashed". A crashed runner and a killed gate ask an operator for
 * opposite things, so the one outcome this file exists to name was the one it
 * stopped naming.
 */
const GATE_COMMAND_BUDGET_MS = 2 * 60 * 60 * 1000;

/** Extra ceiling for the supervisor to reap descendants after its deadline. */
const PROCESS_TREE_REAP_BUDGET_MS = 10_000;

/** The asynchronous supervisor used behind this synchronous gate API. */
const PROCESS_TREE_RUNNER = fileURLToPath(
  new URL("./lib/process-tree-runner.mjs", import.meta.url)
);

/**
 * Who started this run, captured before anything can reparent it.
 *
 * A git hook, usually. Read once at load rather than at each use, because the
 * whole question this answers is whether the value has CHANGED — and a value
 * re-read at comparison time can only ever equal itself.
 */
const LAUNCH_PARENT_PID = process.ppid;

/**
 * Why this run should stop early, if it should.
 *
 * The runner spends nearly all of its life blocked inside a synchronous child,
 * where a JavaScript signal handler cannot run — registering one there would
 * suppress the default termination and leave the run alive for the rest of the
 * chain, which is worse than having none. So the interrupt path is built the
 * other way round: the supervisor (which IS asynchronous) is told which pids
 * the run depends on and exits when one dies, the synchronous child returns,
 * and this check between gates is what stops the chain rather than letting it
 * proceed to the next gate for a caller that is gone.
 * @returns {string|null} An operator-readable reason, or null to keep going.
 */
function runInterruption() {
  return interruptionReason({
    launchParentPid: LAUNCH_PARENT_PID,
    currentParentPid: process.ppid,
  });
}

/**
 * Run a shell command under a process-tree deadline.
 * @param {string} command Shell source.
 * @param {object} options Child options passed to the supervisor.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
 */
function runProcessTree(command, options = {}) {
  const timeout = options.timeout ?? GATE_COMMAND_BUDGET_MS;
  const { shell: _shell, capture = false, ...childOptions } = options;
  // The supervisor already ends itself when THIS process dies; naming the
  // process above it is what covers the measured incident, where the hook was
  // killed and the runner — not the supervisor — was the orphan that kept the
  // whole chain executing for a caller that no longer existed.
  const watch = isWatchablePid(LAUNCH_PARENT_PID)
    ? [`--watch-pid=${LAUNCH_PARENT_PID}`]
    : [];
  return boundedSpawnSync(
    process.execPath,
    [
      PROCESS_TREE_RUNNER,
      `--timeout-ms=${timeout}`,
      ...watch,
      ...(capture ? ["--capture-fd=3"] : []),
      "--",
      command,
    ],
    {
      ...childOptions,
      timeout: timeout + PROCESS_TREE_REAP_BUDGET_MS,
    }
  );
}

/**
 * Convert a killed child into this file's no-verdict answer, or re-raise.
 *
 * One helper rather than the same three lines at each executor, because the
 * two halves have to stay welded together: returning the no-verdict answer for
 * a killed child is what makes the KILLED diagnosis reachable, and re-raising
 * everything else is what stops an unrecognised fault being reported as a
 * measurement. Split them across call sites and one of the two eventually drifts.
 * @param {unknown} error A value caught around a bounded child start.
 * @returns {{code: null, output: null}} The no-verdict answer, for a kill.
 * @throws {unknown} The original value, when it is not a killed child.
 */
function killedOrRethrow(error) {
  if (isChildTimeout(error)) return { code: null, output: null };
  throw error;
}

/**
 * Run the command in a shell with stdio inherited, capturing nothing.
 *
 * This is the original executor, kept verbatim as the fallback, so that
 * everything about capture is additive: if capture is unavailable or refused,
 * the exit code is produced by exactly the code path that produced it before.
 * @param {string} command The command line to run.
 * @returns {{code: number|null, output: null, signal?: string}} Exit code; null when killed.
 */
function plainExec(command) {
  try {
    const child = runProcessTree(command, {
      stdio: "inherit",
      timeout: GATE_COMMAND_BUDGET_MS,
    });
    // Still reachable: a non-timeout `spawnSync` failure arrives on the result,
    // and it means nothing ran, which is the same "no verdict" answer.
    if (child.error) return { code: null, output: null };
    return {
      code: child.status,
      output: null,
      ...(child.signal ? { signal: child.signal } : {}),
    };
  } catch (error) {
    return killedOrRethrow(error);
  }
}

/**
 * Run a gate with live output and a supervisor-owned diagnostic tail.
 *
 * The extra pipe belongs only to the supervisor and its caller: the command
 * inherits stdin and two output pipes, never the diagnostic descriptor. No
 * child-writable status record participates in the verdict. Capture failures
 * retain the supervised OS result and never execute the command a second time.
 * Windows retains its existing native-job/plain route. Capture remains opt-out
 * for commands that require inherited terminal handles.
 * @param {string} command Shell source to run once.
 * @returns {{code: number|null, output: string|null, signal?: string}} OS status and diagnostic tail.
 */
export function spawnExec(command) {
  if (process.env.LISA_GATES_CAPTURE === "0" || process.platform === "win32") {
    return plainExec(command);
  }
  try {
    const child = runProcessTree(command, {
      capture: true,
      stdio: ["inherit", "inherit", "inherit", "pipe"],
      timeout: GATE_COMMAND_BUDGET_MS,
    });
    if (child.error) return { code: null, output: null };
    const captured = child.output?.[3];
    return {
      code: child.status,
      ...(child.signal ? { signal: child.signal } : {}),
      output:
        captured === null || captured === undefined ? null : String(captured),
    };
  } catch (error) {
    return killedOrRethrow(error);
  }
}

/**
 * Hang-detector deadline for one part's command, in milliseconds.
 *
 * Thirty minutes, where a gate's command line gets two hours. The process
 * supervisor accepts a literal argument list only with a deadline of thirty
 * minutes or less, and a part's command goes through that mode because it is
 * the one that starts a program with no shell. Like `GATE_COMMAND_BUDGET_MS`
 * this is a ceiling on "has stopped making progress", not a budget: a part
 * still running at the deadline is reported KILLED, never failed and never
 * passed.
 */
const PART_COMMAND_BUDGET_MS = 30 * 60 * 1000;

/** The most output a quiet start with no supervisor collects, in bytes. */
const QUIET_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Where a program is looked for when the environment sets no `PATH`. */
const DEFAULT_SEARCH_PATH = "/usr/bin:/bin";

/**
 * Whether a path names a file this user may run.
 * @param {string} path An absolute path.
 * @returns {boolean} True for a regular file with the execute permission.
 */
function isRunnableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why the system would find no program to start, on Linux and macOS.
 *
 * The same search the system makes: a name holding a `/` is a path from the
 * folder the command starts in, and any other name is looked for in each
 * folder of `PATH`, in order.
 *
 * Asked BEFORE starting, because of where the answer would otherwise come
 * from. A shell that cannot find a program still runs, prints `command not
 * found` and exits 127. With no shell, a missing program means nothing runs,
 * and the supervisor can only report that as its own failure — a stack trace
 * and exit 1, which reads as the program having run and failed. Asking first
 * turns that into one sentence naming the program.
 *
 * It only ever makes the report clearer. A program this misses is reported as
 * not found and blocks; a program it wrongly finds fails to start under the
 * supervisor and blocks there. Neither is a pass.
 * @param {string} program The first item of a part's argument list.
 * @param {string} cwd The folder the command starts in.
 * @param {string} [searchPath] The command environment’s executable search path.
 * @returns {string|null} Why the program cannot be started, finishing
 *   `NOTHING_RAN`, or null when a runnable file answers to that name.
 */
function programProblem(program, cwd, searchPath = DEFAULT_SEARCH_PATH) {
  if (!program.includes("/")) {
    const found = searchPath
      .split(delimiter)
      .some(folder => isRunnableFile(resolve(cwd, folder, program)));
    return found ? null : programMissing(program);
  }
  const path = resolve(cwd, program);
  if (isRunnableFile(path)) return null;
  // There, and not runnable, is a different fix from not there: the file
  // needs its execute permission, not installing.
  return existsSync(path)
    ? `${JSON.stringify(program)} is there but may not be run as a program. ` +
        `Give the file its execute permission, or name the program that ` +
        `runs it as the first item of this part's command`
    : programMissing(program);
}

/**
 * The sentence for a program that is not there to start.
 * @param {string} program The first item of a part's argument list.
 * @returns {string} The reason, finishing `NOTHING_RAN`.
 */
function programMissing(program) {
  return (
    `the program ${JSON.stringify(program)} was not found. Install it, or ` +
    `correct the first item of this part's command in .lisa.config.json`
  );
}

/**
 * Start an argument list under the process supervisor's literal mode.
 *
 * The same supervisor every gate command runs under, so a part keeps what a
 * gate has: output shown as it is printed, a captured tail to diagnose from,
 * a deadline that takes the whole process tree with it, and a stop when the
 * hook that started this run goes away. `--direct-argv` is the mode that
 * hands the list to the system as written; there is no `/bin/sh -c` on this
 * path, and `shell: false` says so for the one hop this file owns.
 *
 * A quiet start shows nothing while the command runs: the command reads from
 * nothing and what it prints goes only to the captured tail. Only the
 * supervisor's own messages still reach this process's error output.
 * @param {readonly string[]} argv The program and its arguments.
 * @param {string} cwd The folder to start in.
 * @param {{capture: boolean, quiet: boolean, budgetMs: number, env?: NodeJS.ProcessEnv}} how How to supervise and capture the command.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
 */
function superviseArgv(argv, cwd, { capture, quiet, budgetMs, env }) {
  const watch = isWatchablePid(LAUNCH_PARENT_PID)
    ? [`--watch-pid=${LAUNCH_PARENT_PID}`]
    : [];
  const shown = quiet ? "ignore" : "inherit";
  return boundedSpawnSync(
    process.execPath,
    [
      PROCESS_TREE_RUNNER,
      `--timeout-ms=${budgetMs}`,
      ...watch,
      ...(capture ? ["--capture-fd=3"] : []),
      "--direct-argv",
      "--",
      ...argv,
    ],
    {
      cwd,
      shell: false,
      stdio: capture ? [shown, shown, "inherit", "pipe"] : "inherit",
      timeout: budgetMs + PROCESS_TREE_REAP_BUDGET_MS,
      ...(env === undefined ? {} : { env }),
    }
  );
}

/**
 * The deadline one start of a part's command is held to, in milliseconds.
 *
 * A gate never passes one and gets {@link PART_COMMAND_BUDGET_MS}. A proof
 * passes the limit its declaration gives one half (CodySwannGT/lisa#4995).
 * The supervisor's literal mode accepts a whole number of milliseconds up to
 * thirty minutes and nothing else, so anything else is refused here in a
 * sentence instead of by the supervisor in a stack trace that would read as
 * the command having run and failed.
 * @param {unknown} timeoutMs What the caller asked for, if anything.
 * @returns {number} The deadline.
 * @throws {TypeError} When a limit was given and is not one the supervisor
 *   accepts.
 */
function partBudget(timeoutMs) {
  if (timeoutMs === undefined) return PART_COMMAND_BUDGET_MS;
  if (
    Number.isInteger(timeoutMs) &&
    timeoutMs >= 1 &&
    timeoutMs <= PART_COMMAND_BUDGET_MS
  ) {
    return timeoutMs;
  }
  throw new TypeError(
    `A part's command was not started: its time limit is ` +
      `${JSON.stringify(timeoutMs)}, and a limit is a whole number of ` +
      `milliseconds from 1 to ${PART_COMMAND_BUDGET_MS}.`
  );
}

/**
 * Start an argument list with no supervisor in between.
 *
 * The route for Windows, where the supervisor has no literal mode. The
 * program is started directly with its output inherited, so nothing is
 * captured — the same thing Windows gets for a gate's command line — and a
 * failure is reported from its exit code alone.
 *
 * Here the system itself says when a program is not there (`ENOENT`), so
 * nothing is looked up first.
 *
 * A quiet start is the one case that keeps the output here: the command
 * reads from nothing and what it prints is collected instead of shown.
 * @param {readonly string[]} argv The program and its arguments.
 * @param {string} cwd The folder to start in.
 * @param {{quiet: boolean, budgetMs: number, env?: NodeJS.ProcessEnv}} how Whether to collect the
 *   output instead of showing it, and the deadline.
 * @returns {{code: number|null, output: string|null, signal?: string, notStarted?: string}}
 *   Exit code; null with `notStarted` when the program could not be started.
 * @throws {Error} When the program was killed at its deadline.
 */
function startArgv(argv, cwd, { quiet, budgetMs, env }) {
  const [program, ...rest] = argv;
  const child = boundedSpawnSync(program, rest, {
    cwd,
    shell: false,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: budgetMs,
    ...(env === undefined ? {} : { env }),
    // Only a quiet start collects anything, and a check that prints a great
    // deal must still be read rather than cut off as if it could not start.
    ...(quiet ? { maxBuffer: QUIET_OUTPUT_BYTES } : {}),
  });
  if (child.error) {
    const code = /** @type {{code?: unknown}} */ (child.error).code;
    return {
      code: null,
      output: null,
      notStarted:
        code === "ENOENT"
          ? programMissing(program)
          : `the program ${JSON.stringify(program)} could not be started ` +
            `(${String(code ?? child.error.message)})`,
    };
  }
  return {
    code: child.status,
    output: quiet ? `${child.stdout ?? ""}${child.stderr ?? ""}` : null,
    ...(child.signal ? { signal: child.signal } : {}),
  };
}

/**
 * Start one part's argument list in its folder, with no shell.
 *
 * The default `execArgv` of `runGates`, and the counterpart of `spawnExec`.
 * The two differ in exactly the way the declaration does: `spawnExec` is
 * given one line of text and hands it to a shell, and this is given a list
 * and hands each item to the program as one argument. Nothing reads `;`,
 * `&&`, `$(…)`, a quote or a space as anything but a character.
 *
 * It starts in `cwd` and nowhere else, so `cwd` is required: a part's command
 * must never run in whatever folder the runner happened to be started in.
 *
 * Gate commands inherit this process's environment. Proof preparation can
 * supply a copy without repository-selection variables from Git hooks.
 *
 * ## What it refuses, and how
 *
 * A command that is not a list of text is a programming error by this point —
 * validation and `runGates` have both already refused it — so it THROWS
 * rather than answering, and nothing is started. Everything that can go wrong
 * with a well-formed list is an answer instead: `{code: null}` with
 * `notStarted` for a folder or a program that is not there, and `{code:
 * null}` alone for a command killed at its deadline.
 *
 * ## What a proof asks for that a gate does not
 *
 * A gate passes neither `timeoutMs` nor `quiet`, and nothing above changes
 * for it. The paired-proof runner (CodySwannGT/lisa#4995) passes both.
 *
 * `timeoutMs` is the limit its declaration gives one half of a proof. A
 * command still running at that limit is stopped with its whole process
 * tree, exactly as at the gate's own deadline, and the answer says so with
 * `timedOut: true` — the one thing an exit code cannot say, and the
 * difference between "this check is too slow for its limit" and "this
 * machine killed it". The key is only ever present, and only ever true, on a
 * start that was given a limit and was stopped no earlier than it.
 *
 * `quiet` shows nothing while the command runs. A proof's report is one
 * document, and a command printing into the middle of it would make that
 * document unreadable by the program it was written for. The command reads
 * from nothing, and what it prints is kept for the answer whatever
 * `LISA_GATES_CAPTURE` says, because the output is what the proof is read
 * from.
 * @param {readonly string[]} argv The program, then its arguments.
 * @param {object} options How to start it.
 * @param {string} options.cwd The folder to start in.
 * @param {string} [options.platform] The platform, for the route Windows
 *   takes. Injectable so that route can be run where it is not the default.
 * @param {number} [options.timeoutMs] The deadline, in whole milliseconds
 *   from 1 to thirty minutes. Thirty minutes when left out.
 * @param {boolean} [options.quiet] Show nothing while the command runs, and
 *   always keep what it printed.
 * @param {NodeJS.ProcessEnv} [options.env] Environment for this start.
 * @returns {{code: number|null, output: string|null, signal?: string, notStarted?: string, timedOut?: true}}
 *   OS status and diagnostic tail, or why nothing started.
 * @throws {TypeError} When `argv` is not a list of text naming a program,
 *   `cwd` is not given, or `timeoutMs` is not a limit the supervisor accepts.
 */
export function spawnArgv(
  argv,
  { cwd, platform = process.platform, timeoutMs, quiet = false, env } = {}
) {
  const problem = argvProblem(argv);
  if (problem !== null) {
    throw new TypeError(
      `A part's command was not started: ${problem}. A command is a list ` +
        `with one item per argument, the program first, and is never split ` +
        `from one string.`
    );
  }
  if (typeof cwd !== "string" || cwd === "") {
    throw new TypeError(
      "A part's command was not started: no folder to start it in was given."
    );
  }
  const budgetMs = partBudget(timeoutMs);
  // Asked here as well as in `partDirectory`, for a caller that is not
  // `runGates`: the system reports a missing folder as the PROGRAM not being
  // found, which would send an operator to install something they have.
  if (!isFolder(cwd)) {
    return {
      code: null,
      output: null,
      notStarted: `the folder ${JSON.stringify(cwd)} does not exist`,
    };
  }
  const limited = timeoutMs !== undefined;
  const began = performance.now();
  // Read off a clock that cannot be set back, and only to name a stop that
  // has already happened: the supervisor ends a tree at its deadline with the
  // same signal anything else on the machine would use, so the elapsed time
  // is the only thing that tells the two apart.
  const atDeadline = answer =>
    limited && answer.code === null && performance.now() - began >= budgetMs
      ? { ...answer, timedOut: true }
      : answer;
  if (platform === "win32") {
    try {
      return startArgv(argv, cwd, { quiet, budgetMs, env });
    } catch (error) {
      // A gate keeps what it always had here. Only a start that was given a
      // limit of its own is answered instead.
      if (!limited) throw error;
      return atDeadline(killedOrRethrow(error));
    }
  }
  const searchPath = env === undefined ? process.env.PATH : env.PATH;
  const notStarted = programProblem(argv[0], cwd, searchPath);
  if (notStarted !== null) return { code: null, output: null, notStarted };
  const capture = quiet || process.env.LISA_GATES_CAPTURE !== "0";
  try {
    const child = superviseArgv(argv, cwd, { capture, quiet, budgetMs, env });
    // A non-timeout `spawnSync` failure arrives on the result, and it means
    // the supervisor itself never ran: nothing checked this part.
    if (child.error) return { code: null, output: null };
    const captured = capture ? child.output?.[3] : null;
    return atDeadline({
      code: child.status,
      ...(child.signal ? { signal: child.signal } : {}),
      output:
        captured === null || captured === undefined ? null : String(captured),
    });
  } catch (error) {
    return atDeadline(killedOrRethrow(error));
  }
}

/**
 * The one schema token, which a reader REFUSES to best-effort parse past.
 *
 * A reader that parsed any JSON it was handed would credit a file that happens
 * to have a `gates` array, which is how evidence of one thing becomes evidence
 * of another. This token is also what a caller greps for to find out whether
 * the runner it resolved is old enough to ignore `--evidence` entirely.
 */
export const EVIDENCE_SCHEMA = "lisa.gate-evidence/v1";

/**
 * What this run was able to say about the moment as a whole.
 *
 * Every one of these is written to disk, INCLUDING the ones that prove
 * nothing. That is the point: a reader must be able to tell "ran, and this
 * project declares nothing here" from "never ran", and it cannot do that from
 * a file's absence, because absence is also what a crashed runner leaves.
 */
export const EVIDENCE_VERDICT = Object.freeze({
  /** Every required gate at this moment passed. */
  PROVED: "proved",
  /** A required gate went unproved. */
  BLOCKED: "blocked",
  /** The configuration was invalid, so nothing was executed. */
  REFUSED: "refused",
  /** The project has no gates block; the registry governs nothing here. */
  NO_GATES: "no-gates",
  /**
   * The caller's built-in steps still run: the block is half-written, or the
   * parts that ran did not reach every path of the change and the caller
   * cannot keep one step on its own. In the second case the rows of what did
   * run are recorded beside it.
   */
  FELL_BACK: "fell-back",
  /** The runner could not run. Nothing was proved. */
  RUNNER_FAILED: "runner-failed",
});

/**
 * A runner state read as one of evidence's three values.
 *
 * Only PASSED becomes `pass`. FAILED becomes `fail`. Everything else —
 * unprovable, killed, skipped, queued behind a blocker — becomes `unknown`,
 * which is neither an accusation nor a credit: nothing measured the property,
 * so the honest record says nobody knows. Collapsing any of them into `pass`
 * is the defect the whole subsystem exists to refuse, and collapsing them into
 * `fail` would blame a project for a gap in observation.
 */
const EVIDENCE_STATUS_FOR = Object.freeze({
  [STATE.PASSED]: "pass",
  [STATE.FAILED]: "fail",
  [STATE.UNPROVABLE]: "unknown",
  [STATE.KILLED]: "unknown",
  [STATE.SKIPPED]: "unknown",
  [STATE.NOT_RUN]: "unknown",
});

/**
 * One revision from git, or null when git cannot answer.
 *
 * Null rather than a throw: a project without git — a container, an unpacked
 * tarball — still records everything else, and a subject field that says "not
 * known" is honest. What it must never do is guess.
 * @param {string} spec A rev-parse argument, e.g. `HEAD`.
 * @returns {string|null} The resolved object name.
 */
function gitRev(spec) {
  try {
    const child = boundedSpawnSync("git", ["rev-parse", spec], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // probe-direction: neutral — the value is a subject field in the run record.
    // No gate reads it; an unresolved revision is printed as unknown.
    if (child.error || child.status !== 0) return null;
    return String(child.stdout ?? "").trim() || null;
  } catch {
    // probe-direction: neutral — same field, same reason: a killed `git` is
    // recorded as an unknown revision and gates no verdict.
    // A killed `git` is not an answer about the tree, and this module's own
    // doctrine is that an unknown answer is recorded as unknown.
    return null;
  }
}

/**
 * WHAT this evidence is about.
 *
 * `tree` is the identity and `commit` is evidentiary: two commits share a tree
 * after a rebase, and the tree is what the gates actually examined.
 * @returns {{repository: string|null, tree: string|null, commit: string|null, ref: string|null}} The subject binding.
 */
function evidenceSubject() {
  return {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    tree: gitRev("HEAD^{tree}"),
    commit: process.env.GITHUB_SHA ?? gitRev("HEAD"),
    ref: process.env.GITHUB_REF ?? null,
  };
}

/**
 * One gate's outcome, as small as a reader needs.
 *
 * The envelope used to carry `work`, `measures`, `prover` and freshness fields
 * for a release-reuse checker that nothing called; every one of them was null
 * or restated the exit code, so they were removed with the checker
 * (CodySwannGT/lisa#4794). `status` stays three-valued: only PASSED becomes
 * `pass`, FAILED becomes `fail`, and everything else is `unknown`.
 *
 * One PART of a gate adds `scope`, the folder it covers. A gate with parts
 * records one row per part, all under one `gate`, and without the folder a
 * reader could not tell the row that failed from the row that passed. A gate
 * with no parts records exactly the four keys it always has.
 *
 * A part the change does not touch adds `applicable: false`. Its `status` is
 * `unknown`, as it is for everything that was not measured, so a reader that
 * knows only the three statuses still cannot take it for a pass; the extra
 * key is what tells it apart from a part that ran and proved nothing.
 * @param {GateOutcome} outcome One resolved gate and its verdict.
 * @returns {{gate: string, status: string, level: string, label: string, scope?: string|null, applicable?: false}} The gate's record.
 */
function gateEvidence(outcome) {
  return {
    gate: outcome.id,
    status: EVIDENCE_STATUS_FOR[outcome.state] ?? "unknown",
    level: outcome.level,
    label: outcome.label ?? outcome.id,
    ...(isPart(outcome) ? { scope: outcome.scope ?? null } : {}),
    ...(outcome.untouched === true ? { applicable: false } : {}),
  };
}

/**
 * The whole document one run of one moment records.
 *
 * `observed_at` is the run's START. `verdict` makes the zero-gate case legible
 * on disk: `"no-gates"` beside an empty `gates` array says which of "ran and
 * declared nothing" or "recorded nothing" this is. `contract.gates_digest`
 * names the declared rule set the run was held to.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment that was run.
 * @param {object|null} [options.gates] The gates block that was executed.
 * @param {string} options.verdict One of `EVIDENCE_VERDICT`.
 * @param {GateRun|null} [options.result] What `runGates` produced, if it ran.
 * @param {string} [options.runner] The task-runner prefix.
 * @param {Record<string,string>|null} [options.scripts] Project scripts.
 * @param {string} options.observedAt When the run began, ISO-8601.
 * @returns {{schema: string, verdict: string, subject: {repository: string|null, tree: string|null, commit: string|null, ref: string|null}, contract: {moment: string, gates_digest: string|null}, observed_at: string, gates: Array<{gate: string, status: string, level: string, label: string}>}} The evidence envelope.
 */
export function evidenceDocument({
  moment,
  gates = null,
  verdict,
  result = null,
  runner = undefined,
  scripts = null,
  observedAt,
}) {
  return {
    schema: EVIDENCE_SCHEMA,
    verdict,
    subject: evidenceSubject(),
    contract: {
      moment,
      gates_digest: planDigest({ gates, moment, runner, scripts }),
    },
    observed_at: observedAt,
    gates: (result?.results ?? []).map(gateEvidence),
  };
}

/**
 * Write the envelope where the caller asked for it.
 *
 * The return value is load-bearing rather than advisory: a caller that ignored
 * it would let a run which recorded NOTHING exit clean, and a missing record
 * that looks like a clean record is the failure this whole file refuses.
 * @param {string} path File to write.
 * @param {object} document The envelope.
 * @returns {boolean} Whether it was written.
 */
function writeEvidence(path, document) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return true;
  } catch (err) {
    console.error(`⚠️  Could not record gate evidence: ${err.message}`);
    console.error(
      "   Nothing about this run was recorded, so this is NOT a pass."
    );
    return false;
  }
}

/**
 * Read a `--name=<value>` flag from the argument list.
 * @param {string[]} argv Arguments after the script name.
 * @param {string} name Flag name, without dashes.
 * @returns {string|null} The value, or null when the flag is absent.
 */
function readFlag(argv, name) {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** How the command line is written. */
const USAGE =
  "usage: lisa-run-gates.mjs --moment=<moment> [--coverage=<file>] " +
  "[--evidence=<file>] [--builtins=none] [--push-refs=<file>|-] [--parts=all] [--gate=<id>]";

/** The gate id a standalone pull-request job is responsible for. */
const GATE_FLAG = "gate";

/**
 * The flag a push hook uses to hand over what git told it is being pushed.
 *
 * Its value is a file holding the hook's standard input exactly as git wrote
 * it — one `<local ref> <local object> <remote ref> <remote object>` line per
 * ref — or `-` to have this runner read its own standard input. Read only at
 * push. Without it (and without the file the shipped push hook names in
 * `LISA_PUSHED_REFS_FILE`) the runner does not know what is being pushed, and
 * runs every part.
 *
 * With `-`, standard input is read to its end before any gate starts, so a
 * gate's command then finds it empty. A caller whose gates read the pushed
 * refs themselves hands over a file instead.
 */
const PUSH_REFS_FLAG = "push-refs";

/** The flag that runs every part, whatever the change touches. */
const PARTS_FLAG = "parts";

/** The one value that flag takes. */
const ALL_PARTS = "all";

/**
 * Why the `--parts` flag cannot be honoured as given, or null when it can.
 *
 * Refused rather than guessed at, for the reason `--builtins` is: a caller
 * that wrote `--parts=api` meant something, and running a different set of
 * parts than it asked for is not a favour.
 * @param {string|null} value The flag's value, or null when it was not given.
 * @returns {string|null} The problem, in a sentence, or null.
 */
function partsFlagProblem(value) {
  if (value === null || value === ALL_PARTS) return null;
  return (
    `--${PARTS_FLAG}=${JSON.stringify(value)} is not something this runner ` +
    `understands. The only value is --${PARTS_FLAG}=${ALL_PARTS}, which runs ` +
    `every part whatever the change touches.`
  );
}

/** The flag a caller uses to say what checks of its own it has. */
const BUILTINS_FLAG = "builtins";

/** The one value that flag takes: the caller has no checks of its own. */
const NO_BUILTINS = "none";

/**
 * Why the `--builtins` flag cannot be honoured as given, or null when it can.
 *
 * `--coverage` and `--builtins=none` are refused together because they say
 * opposite things about the caller. The first asks which of its built-in
 * checks it may skip; the second says it has none. Honouring either one would
 * mean ignoring the other, and the caller would not learn which.
 * @param {string|null} value The flag's value, or null when it was not given.
 * @param {string|null} coveragePath The `--coverage` file, if one was given.
 * @returns {string|null} The problem, in a sentence, or null.
 */
function builtinsFlagProblem(value, coveragePath) {
  if (value === null) return null;
  if (value !== NO_BUILTINS) {
    return (
      `--${BUILTINS_FLAG}=${JSON.stringify(value)} is not something this ` +
      `runner understands. The only value is --${BUILTINS_FLAG}=${NO_BUILTINS}, ` +
      `for a caller that has no built-in checks of its own.`
    );
  }
  if (coveragePath) {
    return (
      `--coverage and --${BUILTINS_FLAG}=${NO_BUILTINS} cannot be used ` +
      `together: the first asks which built-in checks to skip, and the ` +
      `second says there are none.`
    );
  }
  return null;
}

/**
 * Write the covered ids where the calling hook can read them.
 *
 * One id per line and nothing else — no diagnostics, no blank-line padding —
 * because the reader is `grep -Fqx` in a shell, and anything else in this file
 * is something a hook could mistake for a property it may stand down.
 * @param {string} path File to write.
 * @param {string[]} ids Covered gate ids.
 * @returns {boolean} Whether the file was written.
 */
function writeCoverage(path, ids) {
  try {
    writeFileSync(path, ids.length ? `${ids.join("\n")}\n` : "");
    return true;
  } catch (err) {
    console.error(`⚠️  Could not record gate coverage: ${err.message}`);
    console.error("   The built-in checks will all run.");
    return false;
  }
}

/**
 * How an operator re-checks the configuration, spelled for THIS checkout.
 *
 * Derived from this module's own location rather than written as a literal:
 * the two scripts always sit side by side, but the directory they sit in
 * differs between a consumer project (`scripts/`) and Lisa itself
 * (`all/copy-overwrite/scripts/`). A refusal that tells someone to run a path
 * that does not exist here is a refusal they cannot act on.
 * @returns {string} A copy-pasteable command.
 */
function validateCommand() {
  const validator = fileURLToPath(new URL("lisa-gates.mjs", import.meta.url));
  const here = relative(process.cwd(), validator);
  return `node ${here.startsWith("..") ? validator : here} validate`;
}

/**
 * Refuse the run, and say what is wrong in words an operator can act on.
 *
 * A bare non-zero exit is not enough. The person this reaches is often not the
 * person who wrote the declaration — the hooks run it on every commit — so the
 * refusal names the file, quotes each problem, and gives the one command that
 * says when the problem is gone.
 * @param {string} moment The moment that was asked for.
 * @param {string[]} problems Blocking problems, from `configurationProblems`.
 * @param {(line: string) => void} out Line sink.
 */
function reportRefusal(moment, problems, out) {
  const many = problems.length !== 1;
  out("");
  out(`🚫 Nothing ran at "${moment}": the gate configuration is INVALID.`);
  out("");
  out(
    `   .lisa.config.json declares ${many ? "gates" : "a gate"} that cannot ` +
      `work as written. Running ${many ? "them" : "it"} anyway would report ` +
      `"proved" for a configuration Lisa's own validator refuses, and a green ` +
      `that means nothing is worse than a red.`
  );
  out("");
  for (const problem of problems) out(`   ❌ ${problem}`);
  out("");
  out("   To fix it:");
  out(
    `     1. Open .lisa.config.json and correct the ${many ? "declarations" : "declaration"} named above.`
  );
  out(`     2. Run \`${validateCommand()}\` until it prints`);
  out(`        "gates and policy: configuration is valid".`);
  out("     3. Try again.");
  out("");
  out("   Nothing was proved at this moment. This is NOT a pass.");
}

/**
 * CLI entry point. Every exit path is one of `EXIT`.
 * @param {string[]} [argv] Arguments after the script name.
 * @returns {number} The process exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const moment = readFlag(argv, "moment");
  const coveragePath = readFlag(argv, "coverage");
  const evidencePath = readFlag(argv, "evidence");
  // Taken before anything runs. See `evidenceDocument`: a start stamp makes a
  // freshness bound err toward `unknown` rather than toward crediting a stale
  // observation, which is the only direction a gate may err in.
  const startedAtMs = Date.now();
  const observedAt = new Date(startedAtMs).toISOString();
  // Host load at the START of the run, for the push timing report (#4591).
  const startReading = hostReading();
  if (!moment) {
    console.error(USAGE);
    return EXIT.RUNNER_FAILED;
  }
  // Read before anything runs, and refused rather than guessed at. This flag
  // decides whether "go and run your own checks" is an answer the caller can
  // act on, so a value this runner does not know must not quietly become
  // either answer.
  const builtinsFlag = argv.includes(`--${BUILTINS_FLAG}`)
    ? ""
    : readFlag(argv, BUILTINS_FLAG);
  const partsFlag = argv.includes(`--${PARTS_FLAG}`)
    ? ""
    : readFlag(argv, PARTS_FLAG);
  const onlyGate = argv.includes(`--${GATE_FLAG}`)
    ? ""
    : readFlag(argv, GATE_FLAG);
  const standalone = builtinsFlag === NO_BUILTINS;
  const gateFlagProblem =
    onlyGate !== null &&
    (onlyGate === "" || !standalone || moment !== "pull-request")
      ? "Use --gate=<id> with --moment=pull-request and --builtins=none."
      : null;
  const flagProblem =
    builtinsFlagProblem(builtinsFlag, coveragePath) ??
    partsFlagProblem(partsFlag) ??
    gateFlagProblem;
  if (flagProblem) {
    console.error(`⚠️  ${flagProblem}`);
    console.error(USAGE);
    console.error("   Nothing ran, so nothing was proved. This is NOT a pass.");
    return EXIT.RUNNER_FAILED;
  }
  // Standard input is read NOW, before anything else is started. Every gate
  // command inherits it, and git writes the pushed refs there exactly once:
  // read lazily, whichever of the runner and a gate got there first would
  // leave the other nothing, and the answer would depend on the order the
  // gates happen to run in.
  const pushRefsFlag = readFlag(argv, PUSH_REFS_FLAG);
  const stdinRefs =
    moment === "push" && pushRefsFlag === PUSH_REFS_STDIN
      ? readPushRefs(PUSH_REFS_STDIN)
      : undefined;

  // PRINTED BEFORE ANY GATE RUNS, so it is present whether they pass, fail,
  // are optional, or never run at all. Every early return below is a report an
  // operator may quote later, and a quoted report that cannot be dated is the
  // defect this line exists to close: the local hook runs the version this
  // project PINNED, while CI runs a floating ref, so two reports about "the
  // gate" are routinely claims about different code.
  const identity = lisaIdentity();
  console.log(formatIdentityLine(identity));

  /**
   * Record this run, and refuse to report a verdict we could not record.
   *
   * Every exit path below goes through here, including the ones that prove
   * nothing, because a reader must be able to tell "ran and declared nothing"
   * from "never ran" — and a file's absence says both.
   *
   * A write failure cannot weaken an existing refusal. BLOCKED stays BLOCKED;
   * every other result becomes RUNNER_FAILED because the requested record was
   * not written and therefore cannot be consumed as evidence.
   * @param {number} code The exit code this path would return.
   * @param {string} verdict One of `EVIDENCE_VERDICT`.
   * @param {object} [parts] The block that ran and what it produced.
   * @param {object|null} [parts.gates] The gates block.
   * @param {GateRun|null} [parts.result] What `runGates` produced.
   * @param {string} [parts.runner] The task-runner prefix.
   * @param {Record<string,string>|null} [parts.scripts] Project scripts.
   * @returns {number} The exit code, upgraded on a recording failure.
   */
  const settle = (code, verdict, parts = {}) => {
    if (!evidencePath) return code;
    const written = writeEvidence(
      evidencePath,
      evidenceDocument({
        gates: parts.gates ?? null,
        moment,
        observedAt,
        result: parts.result ?? null,
        runner: parts.runner,
        scripts: parts.scripts ?? null,
        verdict,
      })
    );
    if (written) return code;
    return code === EXIT.BLOCKED ? EXIT.BLOCKED : EXIT.RUNNER_FAILED;
  };

  const dependencyProblem = worktreeDependencyProblem();
  if (dependencyProblem) {
    console.error(dependencyProblem);
    if (coveragePath) writeCoverage(coveragePath, []);
    return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.BLOCKED);
  }

  let config;
  try {
    config = readGates();
  } catch (err) {
    console.error(
      `⚠️  Gate runner could not read configuration: ${err.message}`
    );
    console.error("   Nothing was proved by the gate registry at this moment.");
    return settle(EXIT.RUNNER_FAILED, EVIDENCE_VERDICT.RUNNER_FAILED);
  }

  const declarationProblem = standalone
    ? declarationProblemAt({
        moment,
        root: process.cwd(),
        pushRefs: pushRefsFlag,
        ...(stdinRefs === undefined ? {} : { read: () => stdinRefs }),
        declares(text) {
          if (text === null) return false;
          try {
            return Object.keys(parseGatesConfig(text).gates).length > 0;
          } catch {
            // A malformed declaration cannot supply checks for the change.
            return false;
          }
        },
      })
    : null;
  if (declarationProblem !== null) {
    console.error(declarationProblem);
    return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.BLOCKED);
  }

  // The gates BLOCK is the migration switch. Its absence means this project
  // has not adopted the registry, so the caller must run its hardcoded steps.
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (coveragePath) writeCoverage(coveragePath, []);
    if (onlyGate !== null) {
      reportRefusal(
        moment,
        [`No gate ${JSON.stringify(onlyGate)} is declared.`],
        line => console.error(line)
      );
      return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.REFUSED);
    }
    // A caller with no built-in checks has no hardcoded steps to run instead,
    // so 78 would be an instruction it cannot follow. What is true is that
    // nothing is declared and so nothing was checked: the same answer a gates
    // block that is silent at this moment gets further down, said out loud.
    if (standalone) {
      console.log(
        `ℹ️  No gates are declared in .lisa.config.json, so nothing was ` +
          `checked at ${moment}.`
      );
      return settle(EXIT.PROVED, EVIDENCE_VERDICT.NO_GATES);
    }
    return settle(EXIT.NO_GATES, EVIDENCE_VERDICT.NO_GATES);
  }

  // FAIL CLOSED ON A CONFIGURATION THE VALIDATOR REFUSES.
  //
  // `lisa-gates.mjs validate` used to call a declaration blocking while this
  // file executed that same declaration and printed `1 proved` — one tree, one
  // config, two opposite verdicts, and which one an operator got depended on
  // which command they happened to run (CodySwannGT/lisa#3042). The instance
  // that was measured failed in the safe direction (a deploy-only gate ran at
  // pull-request, so something ran that should not have), but nothing about the
  // divergence made that the direction: a declaration `validate` accepts and
  // the runner declines to execute is a silent skip reporting green, which is
  // the defect this whole subsystem exists to refuse.
  //
  // The rules are NOT restated here. `configurationProblems` is the one reading
  // of legality and `validate` is its other caller, so a rule added there binds
  // both or neither.
  //
  // Scoped to THIS moment, through `declarationsAt`, which narrows the input
  // rather than the rules. A gate misdeclared at `pre-deploy` is a real defect,
  // and it is not a reason to refuse every commit in the repository — but it is
  // also not something to keep quiet about, so what does not bind here is
  // reported below instead of dropped.
  const scripts = projectScripts();
  const executedMoments = momentsExecutedBy();
  const problemsIn = declared =>
    configurationProblems({
      gates: declared,
      policy: config.policy,
      scripts,
      executedMoments,
    }).blocking;
  const blocking = problemsIn(declarationsAt({ gates: config.gates, moment }));
  if (blocking.length) {
    reportRefusal(moment, blocking, line => console.error(line));
    return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.REFUSED, {
      gates: config.gates,
      runner: config.runner,
      scripts,
    });
  }
  const elsewhere = problemsIn(config.gates).filter(
    problem => !blocking.includes(problem)
  );
  if (elsewhere.length) {
    console.log(
      `⚠️  ${elsewhere.length} blocking configuration problem(s) in ` +
        `.lisa.config.json apply at other moments, so this run continued. ` +
        `They will be refused where they DO apply — run \`${validateCommand()}\` ` +
        `to see them.`
    );
  }
  const gatesToRun =
    onlyGate === null ? config.gates : { [onlyGate]: config.gates[onlyGate] };
  if (
    onlyGate !== null &&
    (!Object.hasOwn(config.gates, onlyGate) ||
      !resolveMoment({
        gates: gatesToRun,
        moment,
        runner: config.runner,
        scripts,
      }).some(gate => gate.mode === "run"))
  ) {
    reportRefusal(
      moment,
      [
        `Gate ${JSON.stringify(onlyGate)} has no runnable declaration at this moment.`,
      ],
      line => console.error(line)
    );
    return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.REFUSED, {
      gates: config.gates,
      runner: config.runner,
      scripts,
    });
  }

  // The stack's push-gate defaults (CodySwannGT/lisa#4611): a TypeScript host
  // gets the pass cache, admission and affected tests without declaring them,
  // and anything it does declare, `false` included, wins.
  const pushConfig = withPushGateDefaults(config.config, process.cwd());

  // The floor is the list of properties the caller's built-in checks prove.
  // A caller with none has no floor: there is nothing for a half-written
  // block to delete by omission, and nothing to fall back to if it did.
  const wired = standalone ? [] : wiredConditionalFloor({ moment });
  const missing = standalone
    ? []
    : undeclaredFloor({ gates: config.gates, moment, wired });

  // One cleanup sweep per push (CodySwannGT/lisa#4597), before the first gate
  // and before the built-in fallback below, which runs tests too. It never
  // fails the run: whatever goes wrong is printed and the gates run.
  // Opened before the sweep, and only at push. Off unless the project set
  // `pushGate.cache: true`, and then silent and inert (CodySwannGT/lisa#4594).
  const cache =
    moment === "push"
      ? openGatePassCache({
          config: pushConfig,
          gates: config.gates,
          moment,
          out: line => console.log(line),
        })
      : null;
  if (moment === "push") {
    try {
      runStartOfRunSweep();
    } catch (err) {
      console.log(
        `🧹 cleanup sweep did not finish (${err.message}); continuing`
      );
    }
  }

  // `--coverage` is how a caller says "I skip my built-in steps ONE AT A TIME,
  // against the names in this file". Such a caller does not need the moment
  // withheld from it: a property it never sees named keeps its own step, so a
  // half-written block loses nothing and the project gets the gates it did
  // declare. Without the flag the caller is an older hook whose only lever is
  // all-or-nothing, and for that one the moment is still withheld below.
  if (coveragePath) {
    if (missing.length) {
      console.log(
        `ℹ️  The gates block says nothing about ${missing.join(", ")} at ` +
          `${moment}; the built-in check for ${missing.length === 1 ? "it" : "each of them"} still runs.`
      );
    }
  } else if (missing.length) {
    // A half-written block is an unmigrated project, not a migrated one with
    // fewer guarantees. Fall back rather than let omission delete a property,
    // and name what is missing so finishing the migration is a mechanical edit.
    console.log(
      `ℹ️  The gates block says nothing about ${missing.join(", ")} at ` +
        `${moment}, and the built-in checks prove ${missing.length === 1 ? "it" : "them"}.`
    );
    console.log(
      `   Running the built-in checks so nothing stops being proved. Declare ` +
        `${missing.length === 1 ? "that gate" : "those gates"} at "${moment}" ` +
        `(a level of "off" counts as a decision) to hand this moment to the ` +
        `registry.`
    );
    return settle(EXIT.NO_GATES, EVIDENCE_VERDICT.FELL_BACK, {
      gates: config.gates,
      runner: config.runner,
      scripts,
    });
  }

  // Heavy push steps go through headroom admission when the project opted in
  // with `pushGate.admission` (CodySwannGT/lisa#4596). Off, `exec` is
  // `spawnExec` itself and every step starts immediately as before.
  let exec = spawnExec;
  if (moment === "push") {
    // Inherited by every gate, so `lisa admit` and `lisa-test-run` apply the
    // short in-push wait bound rather than the standalone one.
    process.env.LISA_ADMISSION_CONTEXT = PUSH_CONTEXT;
    try {
      exec = withAdmission(spawnExec, {
        enabled: admissionEnabled(pushConfig),
      });
    } catch (err) {
      console.error(`🚫 Nothing ran at "push": ${err.message}`);
      console.error(
        "   Fix pushGate in .lisa.config.json. This is NOT a pass."
      );
      return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.REFUSED, {
        gates: config.gates,
        runner: config.runner,
        scripts,
      });
    }
  }

  // Build once, before the first push gate, when the project opted in with
  // `pushGate.buildOnce` (CodySwannGT/lisa#4595). `buildOnceStep` is the entry
  // for the push timing report; null means the push builds exactly as before.
  let buildOnceStep = null;
  if (moment === "push") {
    try {
      buildOnceStep = runBuildOnce({
        config: pushConfig,
        runner: config.runner,
        scripts,
        exec: command => exec(command, { id: BUILD_ONCE_ID }),
      });
    } catch (err) {
      console.error(`🚫 Nothing ran at "push": ${err.message}`);
      console.error(
        "   Fix pushGate in .lisa.config.json. This is NOT a pass."
      );
      return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.REFUSED, {
        gates: config.gates,
        runner: config.runner,
        scripts,
      });
    }
    if (buildOnceStep) {
      const seconds = (buildOnceStep.durationMs / 1000).toFixed(1);
      if (buildOnceStep.state !== STATE.PASSED) {
        console.error(
          `❌ build-once: \`${buildOnceStep.command}\` failed (exit ` +
            `${buildOnceStep.code}) after ${seconds}s; no push gate ran.`
        );
        return settle(EXIT.BLOCKED, EVIDENCE_VERDICT.BLOCKED, {
          gates: config.gates,
          runner: config.runner,
          scripts,
        });
      }
      console.log(
        `🔨 build-once: \`${buildOnceStep.command}\` built in ${seconds}s; ` +
          `later steps skip their build while the tree matches.`
      );
    }
  }

  console.log(`🚦 Gates at ${moment}:`);
  // At push a test command may narrow itself to the affected tests
  // (CodySwannGT/lisa#4600) and says so through this channel.
  const selection = moment === "push" ? openSelectionReports() : null;
  const result = runGates({
    gates: gatesToRun,
    moment,
    runner: config.runner,
    // Selection reporting wraps the admission-aware `exec`, so a narrowed
    // test command is still admitted like any other heavy step.
    exec: selection
      ? (command, gate) => {
          selection.before(command);
          return exec(command, gate);
        }
      : exec,
    cache,
    selection,
    builtins: !standalone,
    completeParts: onlyGate !== null,
    // What the change touches is read HERE and handed down, for the reason
    // the manifest is: `runGates` stays a function of its inputs. It is asked
    // only if this moment has a part for a folder, so a gates block with no
    // parts starts no git and prints nothing new.
    change: () =>
      partsFlag === ALL_PARTS
        ? {
            paths: null,
            note: `Every part runs at ${moment}: --${PARTS_FLAG}=${ALL_PARTS} was given.`,
          }
        : changeAt({
            moment,
            root: process.cwd(),
            pushRefs: pushRefsFlag,
            ...(stdinRefs === undefined ? {} : { read: () => stdinRefs }),
          }),
    // The manifest is read HERE and handed down, rather than read inside the
    // resolver, so that `runGates` stays a pure function of its inputs and
    // every test above can state what this project ships instead of writing a
    // package.json to disk to find out. Read once, above, so the validity
    // check and the run cannot disagree about what this project ships.
    scripts,
  });
  selection?.close();
  // A gates block that declares nothing at this moment is a deliberate
  // statement, not an unmigrated project: the registry governs the moment and
  // says there is nothing to prove. Say so rather than silently passing.
  if (result.total === 0) {
    console.log(`   (the gates block declares nothing at ${moment})`);
  }
  // Per-gate push timing report (CodySwannGT/lisa#4591). A measurement only:
  // it never throws and never changes the exit code below.
  if (moment === "push" && result.total > 0) {
    recordPushTiming({
      moment,
      startedAtMs,
      start: startReading,
      result,
      preGates: buildOnceStep ? [buildOnceStep] : [],
    });
  }

  // WRITTEN AFTER THE RUN, because it reports the run. Written before it, the
  // file said what the project DECLARED, and the hook that reads it stands its
  // built-in steps down against every name in there — so a leg that ran and
  // errored retired the fallback that would have caught the error. See
  // `provenFloor`. A write failure keeps its old meaning: the record the caller
  // asked for does not exist, so no verdict may be reported off it.
  //
  // A gate whose parts did not reach every path of the change is withheld
  // from that file, and the operator is told which and why. Asked only of a
  // caller with built-in checks to keep, and said only on a run that is about
  // to report success: a blocked run stops the commit whatever this says.
  const unreached =
    standalone || result.blocked
      ? []
      : unreachedFloor({ gates: config.gates, moment, wired, result });
  for (const { reason } of unreached) console.log(`ℹ️  ${reason}`);
  // A caller that did not pass `--coverage` cannot keep ONE built-in check:
  // exit 0 makes it skip them all. So the answer it gets is the one a
  // half-written block gets, for the same reason — some path of this change
  // would otherwise be checked by nothing. The parts that ran stay on the
  // record; only the verdict says the caller's own checks still have to run.
  if (!coveragePath && unreached.length) {
    console.log(
      `   This caller did not pass --coverage, so it cannot keep one ` +
        `built-in check on its own: every built-in check runs.`
    );
    return settle(EXIT.NO_GATES, EVIDENCE_VERDICT.FELL_BACK, {
      gates: config.gates,
      result,
      runner: config.runner,
      scripts,
    });
  }
  if (
    coveragePath &&
    !writeCoverage(
      coveragePath,
      provenFloor({ gates: config.gates, moment, wired, result })
    )
  ) {
    return settle(EXIT.RUNNER_FAILED, EVIDENCE_VERDICT.RUNNER_FAILED, {
      gates: config.gates,
      result,
      runner: config.runner,
      scripts,
    });
  }
  return settle(
    result.blocked ? EXIT.BLOCKED : EXIT.PROVED,
    result.blocked ? EVIDENCE_VERDICT.BLOCKED : EVIDENCE_VERDICT.PROVED,
    { gates: gatesToRun, result, runner: config.runner, scripts }
  );
}

// Through the shared helper, not a hand-rolled comparison: a guard that
// answers "no" for an entry point reached through a symlink — which is every
// git worktree, and every /tmp path on macOS — makes this module load, run
// nothing, and exit 0, which the hooks read as "every required gate was
// proved" and skip every built-in check on. The most dangerous shape of the
// defect this subsystem exists to stop, in the file that decides whether the
// others run.
if (invokedAsScript(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`⚠️  Gate runner crashed: ${err.message}`);
    process.exit(EXIT.RUNNER_FAILED);
  }
}

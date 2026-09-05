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
 * ## Exit codes are the hook's control flow
 *
 * The hooks fall back to their hardcoded steps unless this runner positively
 * reports a verdict, so "the runner could not run" must never look like "all
 * gates passed". Hence `NO_GATES` and `RUNNER_FAILED` are distinct from
 * `PROVED`, and the hook routes each one deliberately.
 * @module lisa-run-gates
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DIAGNOSIS,
  diagnoseFailure,
  ranNoTests,
} from "./lib/gate-failure-diagnosis.mjs";
import {
  killMarkNote,
  recentKillMarks,
  recordKillMark,
} from "./lib/kill-marks.mjs";
import { boundedSpawnSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  compareCodeUnits,
  configurationProblems,
  declarationsAt,
  digest,
  formatIdentityLine,
  lisaIdentity,
  momentsExecutedBy,
  planDigest,
  projectScripts,
  readGates,
  resolveMoment,
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
 */
export const EXIT = Object.freeze({
  /** Every required gate at this moment was proved. */
  PROVED: 0,
  /** At least one required gate failed. Stop the commit or push. */
  BLOCKED: 1,
  /** No gates block in config: this project has not migrated. Fall back. */
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
 */

/**
 * What running one moment produced.
 * @typedef {object} GateRun
 * @property {string} moment The moment that was run.
 * @property {boolean} blocked Whether a required gate went unproved.
 * @property {string|null} blockedBy The first required gate that went unproved.
 * @property {number} total Gates declared at this moment.
 * @property {GateOutcome[]} results Every gate, in execution order.
 * @property {GateOutcome[]} passed Gates that ran and exited zero.
 * @property {GateOutcome[]} failed Gates that failed or could not be proved.
 * @property {GateOutcome[]} unprovable Gates that ran and proved nothing.
 * @property {GateOutcome[]} killed Gates whose command was terminated by a
 *   signal, so it never reached a verdict.
 * @property {GateOutcome[]} skipped Gates with nothing to run locally.
 * @property {GateOutcome[]} notRun Gates queued behind a blocking failure.
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
  return null;
}

/**
 * One aligned line per gate, so a transcript can be read at a glance.
 *
 * A gate resolved through `shippedAs` says so on its own line, naming both
 * scripts. Two scripts can now back one gate, so "what proved this" stops
 * being answerable from the gate id alone — and a reader who has to open the
 * registry to find out is back where #2916 started.
 * @param {string} state A `STATE` value.
 * @param {GateOutcome} gate The resolved gate.
 * @param {string} detail Command, reason, or failure note.
 * @returns {string} The formatted line.
 */
function formatLine(state, gate, detail) {
  const token = `${state.toUpperCase()}`.padEnd(STATE_WIDTH);
  const id = gate.id.padEnd(ID_WIDTH);
  const alias = gate.alias
    ? ` (no "${gate.alias.from}" script here; this project ships "${gate.alias.to}")`
    : "";
  return `  ${token}${gate.level.padEnd(9)}${id}${detail}${alias}`;
}

/**
 * Read an executor's answer, whichever of the two shapes it returned.
 *
 * An executor may answer with a bare exit code or with `{code, output}`. Both
 * are supported on purpose: the exit code is the whole verdict, and the output
 * is only ever used to EXPLAIN a verdict already reached. An executor that
 * cannot capture output — a stub, a Windows shell, a run with capture switched
 * off — therefore loses the diagnosis and nothing else.
 * @param {number|null|undefined|{code: number|null, output: string|null}} raw
 *   Whatever the executor returned.
 * @returns {{code: number|null, output: string|null}} The normalised answer.
 */
function normaliseExec(raw) {
  if (raw !== null && typeof raw === "object") {
    return {
      code: typeof raw.code === "number" ? raw.code : null,
      output: typeof raw.output === "string" ? raw.output : null,
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
 * @param {function(string, GateOutcome): (number|null|object)} exec Executor.
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

function execute(gate, exec) {
  const { code, output } = normaliseExec(exec(gate.command, gate));
  if (code === 0) {
    // A zero exit is not by itself a measurement. A runner invoked with
    // `--passWithNoTests` — still shipped in the integration scripts of three
    // package templates — collects nothing and exits 0, so the whole diagnosis
    // below is unreachable on the one path that needs it and the gate records
    // PASSED for a suite that ran nothing (CodySwannGT/lisa#3715).
    //
    // Deliberately narrow. This does NOT fire on "collected zero"; it fires
    // only when the runner POSITIVELY SAYS it ran nothing and reached no
    // verdict. A gate whose output carries no such statement — every non-test
    // gate — still passes, which is what keeps the blast radius off them. And
    // an interactive filtered run is not a gate invocation: a project that
    // declared this gate declared that work exists for it.
    if (ranNoTests(output)) {
      return {
        state: STATE.UNPROVABLE,
        detail:
          `${gate.command} (exit 0) — the runner reported it executed ZERO ` +
          `test files, so this run measured nothing. A zero exit here is the ` +
          `runner being told not to mind an empty collection, not evidence ` +
          `the property holds`,
        code: 0,
        diagnosis: DIAGNOSIS.NO_TESTS_RAN,
        evidence: [],
      };
    }
    return {
      state: STATE.PASSED,
      detail: gate.command,
      code: 0,
      diagnosis: null,
      evidence: [],
    };
  }
  const shown = typeof code === "number" ? code : "terminated";
  // The code goes in as well as the output, and it is the half that matters
  // most: a kill is legible ONLY in the exit code. `exit 143` is `128 + 15`,
  // and on a saturated box it arrives carrying a truncated transcript that
  // reads exactly like a real gate failure — which is how one `exit 1` came to
  // have three distinct causes with re-running a rational response to all of
  // them (CodySwannGT/lisa#2897).
  const diagnosis = diagnoseFailure(output, code);
  return {
    state: stateFor(diagnosis.kind),
    detail: `${gate.command} (exit ${shown}) — ${diagnosis.summary}`,
    code: typeof code === "number" ? code : null,
    diagnosis: diagnosis.kind,
    evidence: diagnosis.evidence,
    proves: diagnosis.proves,
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
 * Classify a gate without running it, when there is nothing to run.
 * @param {GateOutcome} gate The resolved gate.
 * @returns {{state: string, detail: string, code: null}|null} Outcome or null.
 */
function classifyStatic(gate) {
  const skip = skipReason(gate);
  if (skip) return { state: STATE.SKIPPED, detail: skip, code: null };
  if (!gate.command) {
    return {
      state: STATE.UNPROVABLE,
      detail: "resolves to no task, so nothing ran and nothing was proved",
      code: null,
    };
  }
  return null;
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
    lines.push(`❌ required gate FAILED: ${entry.id} — ${entry.detail}`);
  }
  for (const entry of failedOptional) {
    lines.push(
      `⚠️  optional gate FAILED: ${entry.id} — ${entry.detail} ` +
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
      `🛑 ${entry.level} gate NOT PROVED — KILLED: ${entry.id} — ${entry.detail}`
    );
  }
  // Its own headline, and deliberately not the word "failed". A property
  // nobody measured has not been found wanting, and saying it failed sends the
  // reader hunting a regression that may not exist — which is exactly what six
  // sightings of a starved suite each cost.
  for (const entry of result.unprovable) {
    lines.push(
      `❓ ${entry.level} gate NOT PROVED: ${entry.id} — ${entry.detail}`
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
        `established: ${result.notRun.map(entry => entry.id).join(", ")}`
    );
    lines.push(
      `   Each of those may pass or fail; this run does not say which. ` +
        `${result.blockedBy} failed first and stopped them.`
    );
  }
  if (result.blocked) {
    if (result.skipped.length) {
      lines.push(
        `⏭️  ${result.skipped.length} gate(s) NOT APPLICABLE here — their ` +
          `verdict IS established, there was nothing to run: ` +
          `${result.skipped.map(entry => entry.id).join(", ")}`
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
  const counts =
    `${result.passed.length} proved, ${failedOptional.length} failed ` +
    `(optional), ${result.unprovable.length} not proved, ` +
    `${result.killed.length} killed, ` +
    `${result.skipped.length} not applicable here`;
  lines.push(
    `${failedOptional.length ? "⚠️ " : "✅"} ${result.moment}: ${counts}, ` +
      `of ${result.total} gate(s) declared.${
        failedOptional.length ? " See the optional failure(s) above." : ""
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
 * @param {GateOutcome} gate The resolved gate.
 * @param {{proved: Map<string, object>, blockedBy: string|null, exec: Function}} ctx Run state.
 * @returns {{outcome: object, shared: object|undefined, ran: boolean}} The verdict.
 */
function verdictFor(gate, { proved, blockedBy, exec, siblings }) {
  const own = classifyStatic(gate);
  if (own) return { outcome: own, shared: undefined, ran: false };

  const shared = gate.command ? proved.get(gate.command) : undefined;
  if (shared) {
    // The RAW outcome is what is shared, and each gate reads it for itself.
    // Sharing the already-attributed view would hand the second gate the first
    // gate's reading of whose failure it was, which is how one exit code came
    // to be reported as two failures in the first place.
    const view = attributed(gate, shared.outcome, siblings);
    return {
      outcome: {
        ...view,
        detail: `${view.detail} (proved by the ${shared.id} run)`,
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
  const raw = execute(gate, exec);
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
 * @param {function(string, GateOutcome): (number|null|undefined|{code: number|null, output: string|null})} options.exec
 *   Executor. BOTH shapes, because `normaliseExec` accepts both and the shipped
 *   default executor returns the object one. Declaring only `number|null` here
 *   was not merely narrow, it was wrong about the case this runner exists to
 *   report: a command killed by a signal has a `null` code AND a captured
 *   transcript, and a number-only type can express the null while silently
 *   erasing the transcript that says what the run was doing when it died.
 *   A type that cannot describe `spawnExec` is a type no caller can trust.
 * @param {function(string): void} [options.out] Line sink; defaults to stdout.
 * @param {Record<string, string>|null} [options.scripts] The project's package
 *   scripts, from `projectScripts`. `null` means unknown, and an unknown
 *   manifest resolves exactly as it did before `shippedAs` was consulted.
 * @param {Array<object>} [options.priorKills] Marks left by EARLIER runs.
 *   Injected for the same reason `exec` is: a test states the machine's recent
 *   history instead of having to terminate a real run an hour ago. Defaults to
 *   reading them, and the default is evaluated HERE — before any gate runs —
 *   so a run cannot read back the mark it is about to write.
 * @param {function({kind: string, gateId: string}): boolean} [options.recordKill]
 *   Kill-marker writer, injectable so marker cardinality can be proved without
 *   writing to the host's shared marker directory.
 * @returns {GateRun} What every declared gate at this moment produced.
 */
export function runGates({
  gates,
  moment,
  runner = "npm run",
  exec,
  out = line => console.log(line),
  scripts = null,
  priorKills = recentKillMarks(),
  recordKill = recordKillMark,
}) {
  const resolved = resolveMoment({ gates, moment, runner, scripts });
  const results = [];
  // The id of the first required gate to go unproved, not merely a boolean:
  // every gate queued behind it has to be able to say WHAT stopped it, or its
  // line is indistinguishable from a gate that had nothing to run.
  let blockedBy = null;

  // Which gates name each command, built before anything runs. Attribution
  // needs the answer on the FIRST execution: gates run alphabetically, so the
  // gate that executes a shared prover is usually not the gate whose property
  // the failure belongs to — `coverage-adequacy` runs `test:cov` and
  // `test-correctness` is the one the timeout indicts.
  const sharers = new Map();
  for (const gate of resolved) {
    if (!gate.command) continue;
    sharers.set(
      gate.command,
      (sharers.get(gate.command) ?? new Set()).add(gate.id)
    );
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
  for (const gate of resolved) {
    const { outcome, shared, ran, raw } = verdictFor(gate, {
      proved,
      blockedBy,
      exec,
      siblings: sharers.get(gate.command) ?? new Set(),
    });

    // Only what this iteration actually executed is shareable, and `ran` says
    // so explicitly rather than being inferred from the exit code. `execute`
    // reports `code: null` for a command killed by a signal, so an exit-code
    // test would treat a terminated run as never having happened and send the
    // next gate to run it again — re-running a whole suite an operator has
    // just interrupted.
    if (ran && gate.command) {
      proved.set(gate.command, { id: gate.id, outcome: raw ?? outcome });
    }

    results.push({ ...gate, ...outcome, provedBy: shared?.id ?? null });
    out(formatLine(outcome.state, gate, outcome.detail));
    for (const line of outcome.evidence ?? []) out(`${" ".repeat(6)}↳ ${line}`);
    const unproved =
      outcome.state === STATE.FAILED ||
      outcome.state === STATE.UNPROVABLE ||
      outcome.state === STATE.KILLED;
    // The strictest level wins when gates share a prover. Letting a required
    // gate inherit only the pass, or letting a failure count only against the
    // optional gate that ran first, would be the original defect again: a
    // required gate satisfied by a run that failed.
    if (unproved && gate.level === "required" && !blockedBy)
      blockedBy = gate.id;
  }

  const bucket = state => results.filter(entry => entry.state === state);
  const result = {
    moment,
    blocked: blockedBy !== null,
    blockedBy,
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
  };
  // Left for a LATER run, because this one already knows. The note only ever
  // helps a different run whose own output carries no trace of the machine.
  for (const entry of result.killed.filter(entry => entry.provedBy === null)) {
    recordKill({ kind: STATE.KILLED, gateId: entry.id });
  }
  for (const line of summarise(result, priorKills)) out(line);
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
  const unproved = new Set(
    (result.results ?? [])
      .filter(entry => UNPROVED_STATES.has(entry.state))
      .map(entry => entry.id)
  );
  return declared.filter(id => !unproved.has(id));
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
 * How much of a gate's output is kept for diagnosis. A suite of 14,000 tests
 * prints megabytes; the signatures that matter are all near the end.
 */
const CAPTURE_TAIL_BYTES = 512 * 1024;

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
 * Run a shell command under a process-tree deadline.
 * @param {string} command Shell source.
 * @param {object} options Child options passed to the supervisor.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
 */
function runProcessTree(command, options = {}) {
  const timeout = options.timeout ?? GATE_COMMAND_BUDGET_MS;
  const { shell: _shell, ...childOptions } = options;
  return boundedSpawnSync(
    process.execPath,
    [PROCESS_TREE_RUNNER, `--timeout-ms=${timeout}`, "--", command],
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
 * @returns {{code: number|null, output: null}} Exit code; null when killed.
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
    return { code: child.status, output: null };
  } catch (error) {
    return killedOrRethrow(error);
  }
}

/**
 * Whether this machine can tee a gate's output without changing its verdict.
 *
 * Probed rather than assumed: on a shell without `tee` — Windows `cmd`, a
 * stripped container — the wrapper below would produce no status file, and the
 * runner would report every gate as terminated. A capability the runner cannot
 * confirm is one it does not use.
 * @returns {boolean} Whether to take the capturing path.
 */
function captureAvailable() {
  if (process.env.LISA_GATES_CAPTURE === "0") return false;
  // The one child in this file that is NOT a project gate command, so it takes
  // the shared default rather than the two-hour ceiling: `command -v tee`
  // answers immediately or the shell is broken.
  try {
    const probe = boundedSpawnSync("sh", ["-c", "command -v tee"], {
      stdio: "ignore",
    });
    return !probe.error && probe.status === 0;
  } catch (error) {
    // A probe killed at its deadline has not confirmed anything, and this
    // function's whole contract is that an unconfirmed capability goes unused.
    // Letting the throw escape would convert "cannot tell" into a crash, and
    // the fallback path it guards answers the question perfectly well.
    if (isChildTimeout(error)) return false;
    throw error;
  }
}

/**
 * Read back what the wrapper recorded, keeping only the tail of the log.
 * @param {string} statusPath File the wrapper wrote the exit code into.
 * @param {string} logPath File the wrapper tee'd the output into.
 * @returns {{code: number|null, output: string|null}} The recorded answer.
 */
function readCaptured(statusPath, logPath) {
  let output = null;
  try {
    output = readFileSync(logPath, "utf8").slice(-CAPTURE_TAIL_BYTES);
  } catch {
    output = null;
  }
  try {
    const code = Number.parseInt(readFileSync(statusPath, "utf8").trim(), 10);
    // Fail closed. An unreadable status is not a zero: the one thing this
    // runner may never do is turn "I do not know" into "it passed".
    return { code: Number.isInteger(code) ? code : null, output };
  } catch {
    return { code: null, output };
  }
}

/**
 * The default executor: run the command in a shell, streaming AND recording.
 *
 * stdio is inherited so a failing gate's own output reaches the operator
 * unaltered and as it happens — a push gate runs for minutes and an operator
 * needs to watch it, not receive it in a lump at the end. `tee` is what lets
 * both be true: the operator sees the stream, and the runner keeps a copy to
 * say WHICH failure it was rather than only that there was one.
 *
 * The price is that the command's stdout is a pipe rather than a terminal, so
 * tools that colourise or animate for a TTY print their plain form. That is a
 * deliberate trade: a plain, diagnosable failure beats a coloured, mute one.
 * `LISA_GATES_CAPTURE=0` buys the colour back at the cost of the diagnosis.
 *
 * The exit code comes from a status file written INSIDE the pipeline, never
 * from the pipeline itself — a pipeline reports `tee`'s status, which is
 * almost always zero, and reading it would report every failing gate as
 * passing. That is the single most dangerous mistake available here.
 * @param {string} command The command line to run.
 * @returns {{code: number|null, output: string|null}} Exit code and output.
 */
export function spawnExec(command) {
  if (!captureAvailable()) return plainExec(command);
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), "lisa-gate-run-"));
  } catch {
    return plainExec(command);
  }
  const logPath = join(dir, "output.log");
  const statusPath = join(dir, "status");
  // Newline-separated inside a group, so a command ending in a trailing
  // comment or redirection still has `echo` run as its own statement.
  // Paths travel as data, never as shell source. A TMPDIR containing a quote,
  // newline, dollar sign, or command substitution must not be able to break
  // this wrapper or execute content merely because mkdtemp inherited it.
  const script = `{\n${command}\necho $? > "$LISA_GATE_STATUS_PATH"\n} 2>&1 | tee "$LISA_GATE_LOG_PATH"\n`;
  try {
    const child = runProcessTree(script, {
      env: {
        ...process.env,
        LISA_GATE_LOG_PATH: logPath,
        LISA_GATE_STATUS_PATH: statusPath,
      },
      stdio: "inherit",
      timeout: GATE_COMMAND_BUDGET_MS,
    });
    if (child.error) return { code: null, output: null };
    return readCaptured(statusPath, logPath);
  } catch (error) {
    return killedOrRethrow(error);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * The one schema token, which a reader REFUSES to best-effort parse past.
 *
 * A reader that parsed any JSON it was handed would credit a file that happens
 * to have a `gates` array, which is how evidence of one thing becomes evidence
 * of another. This token is also what a caller greps for to find out whether
 * the runner it resolved is old enough to ignore `--evidence` entirely.
 *
 * Shared verbatim with the release verifier in CodySwannGT/lisa#3013. Two
 * producers — this one at the deploy moments, that one at `pull-request` — and
 * ONE schema, because two evidence formats for one property is this
 * repository's recurring defect. The verifier keys on `contract.moment` and
 * refuses to satisfy a `pre-deploy:*` gate with a `pull-request` envelope
 * regardless of tree match, so the two producers never compete.
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
  /** The block is half-written, so the caller's built-in steps still run. */
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
    if (child.error || child.status !== 0) return null;
    return String(child.stdout ?? "").trim() || null;
  } catch {
    // A killed `git` is not an answer about the tree, and this module's own
    // doctrine is that an unknown answer is recorded as unknown.
    return null;
  }
}

/**
 * WHAT this evidence is about: the tree, and nothing that varies with it.
 *
 * `tree` is the identity; `commit` is evidentiary only. Both are recorded
 * deliberately, because two commits legitimately share a tree after a rebase
 * and that is exactly the case where reusing the evidence is sound — a reader
 * keyed on the commit would rerun everything a rebase touched for no reason,
 * and one keyed on nothing at all would credit a tree that never shipped.
 * @returns {object} The subject binding.
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
 * Digest the inputs the caller stated, or refuse to claim unreadable input.
 * @returns {string|null} The stable digest, or null when none was established.
 */
function inputsDigest() {
  const inputs = process.env.LISA_GATE_EVIDENCE_INPUTS ?? null;
  if (!inputs) return null;
  try {
    return digest(JSON.parse(inputs));
  } catch {
    // A caller that stated unreadable inputs established nothing about them.
    // Null makes a verifier rerun; throwing here would replace the gate's real
    // verdict with an uncaught exit and prevent the evidence write entirely.
    return null;
  }
}

/**
 * UNDER WHICH CONTRACT it was proved — the half a tree hash cannot carry.
 *
 * `workflow_ref` and `workflow_sha` are not redundant with `subject.tree`, and
 * this is the load-bearing argument for keeping them: consumers call the
 * reusable workflow at `@main`, so its contents can change with NO change to
 * the caller's tree. Tree identity alone would let evidence produced by an
 * older, weaker workflow satisfy a stricter one.
 *
 * `inputs_digest` covers the same hole one level down — the same workflow at
 * the same sha proves different things when handed a different
 * `working_directory` or `install_dependencies`. The caller states its own
 * normalised inputs, because only the caller knows them; unstated means null,
 * which a verifier reads as "not established" rather than "no inputs".
 * @param {object} options Inputs.
 * @param {string} options.moment The moment that was run.
 * @param {object|null} options.gates The gates block that was executed.
 * @param {string} [options.runner] The task-runner prefix.
 * @param {Record<string,string>|null} [options.scripts] Project scripts.
 * @param {object} options.identity Lisa artifact identity captured at run start.
 * @returns {object} The contract binding.
 */
function evidenceContract({ moment, gates, runner, scripts = null, identity }) {
  return {
    moment,
    runner: runner ?? null,
    gates_digest: planDigest({ gates, moment, runner, scripts }),
    // SPREAD, not three hand-copied fields. The printed header and this
    // document have to be the same claim: a reader comparing a pasted gate
    // line against a stored envelope and finding them disagree learns nothing
    // except that Lisa has two answers. `surface` and `artifacts` ride along,
    // and they are the half that says WHICH COPY of the enforcement script
    // produced the verdict — a fact a workflow ref cannot carry, because the
    // wrapper's identity and the enforcement's identity are independent when
    // the enforcement is a file living in the consuming repository.
    ...identity,
    inputs_digest: inputsDigest(),
  };
}

/**
 * A caller chain the CALLER derived, or null. Never a literal written here.
 *
 * Depth is a property of how a consumer wired its workflows, not of the gates
 * block: a pull-request path posts one level and a release path posts two, and
 * a consumer's release job is not even named uniformly across the fleet. The
 * only truthful derivation is `postedCallerChains` over a completed run's
 * check-run names, which needs API scope this runner does not have — so a
 * caller that CAN read them states the answer here, and everything else
 * records null. A verifier treats a null chain as ineligible and reruns, which
 * is the safe direction; a guessed literal would not be.
 * @returns {string[]|null} The chain, shallowest element first.
 */
function callerChain() {
  const stated = process.env.LISA_GATE_EVIDENCE_CALLER_CHAIN ?? null;
  if (!stated) return null;
  try {
    const parsed = JSON.parse(stated);
    return Array.isArray(parsed) && parsed.every(el => typeof el === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * WHO produced it, so an auditor can go and read the run.
 *
 * `reused_gates` is emitted from day one, empty, even though nothing reuses
 * yet. An absent field and an empty one must not be the same thing to a
 * reader: adding it later would leave every envelope written before the
 * addition indistinguishable from one that reused everything. It exists to
 * close circular reuse — a run that reuses evidence and then emits its own
 * envelope could otherwise be reused in turn, and the chain of proof bottoms
 * out on nothing. A verifier refuses any envelope with a non-empty
 * `reused_gates` as a source. Primary proof only.
 * @returns {object} The originating run, with nulls off CI.
 */
function evidenceProducer() {
  const id = process.env.GITHUB_RUN_ID ?? null;
  const server = process.env.GITHUB_SERVER_URL ?? null;
  const repository = process.env.GITHUB_REPOSITORY ?? null;
  return {
    run_id: id,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    run_url:
      id && server && repository
        ? `${server}/${repository}/actions/runs/${id}`
        : null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    actor: process.env.GITHUB_ACTOR ?? null,
    caller_chain: callerChain(),
    // This runner never reuses. It executes every gate it records, so the list
    // is empty by construction rather than by omission.
    reused_gates: [],
  };
}

/**
 * One gate's outcome: `EVIDENCE_FIELDS` verbatim, plus exactly two additions.
 *
 * All seven `EVIDENCE_FIELDS` keys are spelled exactly as that module declares
 * them, so `readEvidence` reads a row with no adapter. The two additions are
 * the release verifier's requirements and this producer's too:
 *
 * - `level` — without a per-row level, a required gate can be "covered" by
 *   evidence that was OPTIONAL when it ran, which is a silent downgrade. Here
 *   it is also the only thing that tells a reader whether a failing gate was
 *   allowed to fail.
 * - `label` — the registry label, which ties the row to the branch-protection
 *   context `contextsFor` derives, so an audit can name the context and not
 *   only the gate id.
 *
 * Nothing else. `task` and `command` deliberately do NOT get their own row
 * keys: they are inside `contract.gates_digest`, and a second copy on the row
 * is a second place to drift. The command still appears once, as
 * `prover.tool`, which is an `EVIDENCE_FIELDS` key.
 *
 * `prover.version` is null rather than `"unknown"` when unresolvable. A string
 * that looks like a version and is a placeholder is worse than an absent
 * field, because a placeholder defeats the check that reads it.
 *
 * NARROWED for #3013, and the narrowing matters. This comment used to say
 * flatly that the verifier treats a null-version row as uncoverable. Read
 * literally that makes NOTHING reusable, because the pull-request producer
 * cannot resolve a version for every hand-written job. The rule is right for
 * the case it was written about and too broad for the rest, so `reusePlan` in
 * lisa-gates.mjs applies it by reuse class: for a TIME-SENSITIVE gate the
 * prover is an external scanner whose version decides what it can find, and a
 * null version is disqualifying; for a DETERMINISTIC gate the binding that
 * matters is `subject.tree` + `contract.gates_digest` + `contract.workflow_sha`,
 * all non-null by construction, and a null `prover.version` weakens nothing.
 *
 * `work` is null and stays null until a prover-output parser exists. That is
 * not a shortcut: `readEvidence` demotes a `pass` with no work count to
 * `unknown` for any gate whose registry entry names one, so the conservative
 * value fails SAFE. A fabricated count would fail the other way.
 * @param {GateOutcome} outcome One resolved gate and its verdict.
 * @param {string} observedAt When the run that produced it began.
 * @returns {object} The gate's evidence record.
 */
function gateEvidence(outcome, observedAt) {
  return {
    gate: outcome.id,
    status: EVIDENCE_STATUS_FOR[outcome.state] ?? "unknown",
    work: null,
    measures: {
      exit_code: outcome.code ?? null,
      state: outcome.state,
      detail: outcome.detail ?? null,
      diagnosis: outcome.diagnosis ?? null,
    },
    prover: { tool: outcome.command ?? null, version: null },
    observed_at: observedAt,
    max_age_minutes: null,
    level: outcome.level,
    label: outcome.label ?? outcome.id,
  };
}

/**
 * The whole document one run of one moment records.
 *
 * `observed_at` is the run's START, not its end, and that is the conservative
 * direction on purpose: a freshness bound computed against it can only ever
 * judge the evidence OLDER than it truly is, so a bound errs toward `unknown`
 * rather than toward crediting a stale observation.
 * `verdict` is this producer's one addition to the shared header, and it is
 * what makes the zero-gate case legible ON DISK rather than only as an exit
 * code. An envelope recording nothing and an envelope recording a clean run
 * must not be byte-similar: `"no-gates"` beside an empty `gates` array says
 * which one this is, where a bare empty array would read as either.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment that was run.
 * @param {object|null} [options.gates] The gates block that was executed.
 * @param {string} options.verdict One of `EVIDENCE_VERDICT`.
 * @param {GateRun|null} [options.result] What `runGates` produced, if it ran.
 * @param {string} [options.runner] The task-runner prefix.
 * @param {Record<string,string>|null} [options.scripts] Project scripts.
 * @param {string} options.observedAt When the run began, ISO-8601.
 * @param {object} [options.identity] Lisa identity captured for this run.
 * @returns {object} The evidence envelope.
 */
export function evidenceDocument({
  moment,
  gates = null,
  verdict,
  result = null,
  runner = undefined,
  scripts = null,
  observedAt,
  identity = lisaIdentity(),
}) {
  const observations = (result?.results ?? []).map(outcome =>
    gateEvidence(outcome, observedAt)
  );
  return {
    schema: EVIDENCE_SCHEMA,
    verdict,
    subject: evidenceSubject(),
    contract: evidenceContract({ gates, moment, runner, scripts, identity }),
    producer: evidenceProducer(),
    observed_at: observedAt,
    gates: observations,
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
 * @param {function(string): void} out Line sink.
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
 * @returns {number} The process exit code.
 */
function main() {
  const argv = process.argv.slice(2);
  const moment = readFlag(argv, "moment");
  const coveragePath = readFlag(argv, "coverage");
  const evidencePath = readFlag(argv, "evidence");
  // Taken before anything runs. See `evidenceDocument`: a start stamp makes a
  // freshness bound err toward `unknown` rather than toward crediting a stale
  // observation, which is the only direction a gate may err in.
  const observedAt = new Date().toISOString();
  if (!moment) {
    console.error(
      "usage: lisa-run-gates.mjs --moment=<moment> [--coverage=<file>] " +
        "[--evidence=<file>]"
    );
    return EXIT.RUNNER_FAILED;
  }

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
        identity,
      })
    );
    if (written) return code;
    return code === EXIT.BLOCKED ? EXIT.BLOCKED : EXIT.RUNNER_FAILED;
  };

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

  // The gates BLOCK is the migration switch. Its absence means this project
  // has not adopted the registry, so the caller must run its hardcoded steps.
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (coveragePath) writeCoverage(coveragePath, []);
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

  const wired = wiredConditionalFloor({ moment });
  const missing = undeclaredFloor({ gates: config.gates, moment, wired });

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

  console.log(`🚦 Gates at ${moment}:`);
  const result = runGates({
    gates: config.gates,
    moment,
    runner: config.runner,
    exec: spawnExec,
    // The manifest is read HERE and handed down, rather than read inside the
    // resolver, so that `runGates` stays a pure function of its inputs and
    // every test above can state what this project ships instead of writing a
    // package.json to disk to find out. Read once, above, so the validity
    // check and the run cannot disagree about what this project ships.
    scripts,
  });
  // A gates block that declares nothing at this moment is a deliberate
  // statement, not an unmigrated project: the registry governs the moment and
  // says there is nothing to prove. Say so rather than silently passing.
  if (result.total === 0) {
    console.log(`   (the gates block declares nothing at ${moment})`);
  }

  // WRITTEN AFTER THE RUN, because it reports the run. Written before it, the
  // file said what the project DECLARED, and the hook that reads it stands its
  // built-in steps down against every name in there — so a leg that ran and
  // errored retired the fallback that would have caught the error. See
  // `provenFloor`. A write failure keeps its old meaning: the record the caller
  // asked for does not exist, so no verdict may be reported off it.
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
    { gates: config.gates, result, runner: config.runner, scripts }
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

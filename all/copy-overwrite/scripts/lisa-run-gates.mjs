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

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diagnoseFailure } from "./lib/gate-failure-diagnosis.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { projectScripts, readGates, resolveMoment } from "./lisa-gates.mjs";

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
 * @property {GateOutcome[]} skipped Gates with nothing to run locally.
 * @property {GateOutcome[]} notRun Gates queued behind a blocking failure.
 */

/** Per-gate outcomes, in the order an operator reads them. */
export const STATE = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
  UNPROVABLE: "unprovable",
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
function execute(gate, exec) {
  const { code, output } = normaliseExec(exec(gate.command, gate));
  if (code === 0) {
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
    state: STATE.FAILED,
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
 * @returns {string[]} Summary lines.
 */
function summarise(result) {
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
  // Its own headline, and deliberately not the word "failed". A property
  // nobody measured has not been found wanting, and saying it failed sends the
  // reader hunting a regression that may not exist — which is exactly what six
  // sightings of a starved suite each cost.
  for (const entry of result.unprovable) {
    lines.push(
      `❓ ${entry.level} gate NOT PROVED: ${entry.id} — ${entry.detail}`
    );
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
  const counts =
    `${result.passed.length} proved, ${failedOptional.length} failed ` +
    `(optional), ${result.skipped.length} not applicable here`;
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
 * @param {function(string, GateOutcome): (number|null)} options.exec Executor.
 * @param {function(string): void} [options.out] Line sink; defaults to stdout.
 * @param {Record<string, string>|null} [options.scripts] The project's package
 *   scripts, from `projectScripts`. `null` means unknown, and an unknown
 *   manifest resolves exactly as it did before `shippedAs` was consulted.
 * @returns {GateRun} What every declared gate at this moment produced.
 */
export function runGates({
  gates,
  moment,
  runner = "npm run",
  exec,
  out = line => console.log(line),
  scripts = null,
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
      outcome.state === STATE.FAILED || outcome.state === STATE.UNPROVABLE;
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
    failed: [...bucket(STATE.FAILED), ...bucket(STATE.UNPROVABLE)],
    unprovable: bucket(STATE.UNPROVABLE),
    skipped: bucket(STATE.SKIPPED),
    notRun: bucket(STATE.NOT_RUN),
  };
  for (const line of summarise(result)) out(line);
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
 * complement, and the answer `--coverage` writes out.
 *
 * Presence, not level, for the same reason: `"off"` is a decision on the
 * record. A property declared off is one the project has said it does not want
 * proved, and the built-in step standing down is that decision taking effect;
 * silence is the case where nobody decided anything, and there the step runs.
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
 * Run the command in a shell with stdio inherited, capturing nothing.
 *
 * This is the original executor, kept verbatim as the fallback, so that
 * everything about capture is additive: if capture is unavailable or refused,
 * the exit code is produced by exactly the code path that produced it before.
 * @param {string} command The command line to run.
 * @returns {{code: number|null, output: null}} Exit code; null when killed.
 */
function plainExec(command) {
  const child = spawnSync(command, { shell: true, stdio: "inherit" });
  if (child.error) return { code: null, output: null };
  return { code: child.status, output: null };
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
  const probe = spawnSync("sh", ["-c", "command -v tee"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
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
function spawnExec(command) {
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
  const script = `{\n${command}\necho $? > '${statusPath}'\n} 2>&1 | tee '${logPath}'\n`;
  try {
    const child = spawnSync("sh", ["-c", script], { stdio: "inherit" });
    if (child.error) return { code: null, output: null };
    return readCaptured(statusPath, logPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
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
 * CLI entry point. Every exit path is one of `EXIT`.
 * @returns {number} The process exit code.
 */
function main() {
  const argv = process.argv.slice(2);
  const moment = readFlag(argv, "moment");
  const coveragePath = readFlag(argv, "coverage");
  if (!moment) {
    console.error(
      "usage: lisa-run-gates.mjs --moment=<moment> [--coverage=<file>]"
    );
    return EXIT.RUNNER_FAILED;
  }

  let config;
  try {
    config = readGates();
  } catch (err) {
    console.error(
      `⚠️  Gate runner could not read configuration: ${err.message}`
    );
    console.error("   Nothing was proved by the gate registry at this moment.");
    return EXIT.RUNNER_FAILED;
  }

  // The gates BLOCK is the migration switch. Its absence means this project
  // has not adopted the registry, so the caller must run its hardcoded steps.
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (coveragePath) writeCoverage(coveragePath, []);
    return EXIT.NO_GATES;
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
    if (
      !writeCoverage(
        coveragePath,
        coveredFloor({ gates: config.gates, moment, wired })
      )
    ) {
      return EXIT.RUNNER_FAILED;
    }
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
    return EXIT.NO_GATES;
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
    // package.json to disk to find out.
    scripts: projectScripts(),
  });
  // A gates block that declares nothing at this moment is a deliberate
  // statement, not an unmigrated project: the registry governs the moment and
  // says there is nothing to prove. Say so rather than silently passing.
  if (result.total === 0) {
    console.log(`   (the gates block declares nothing at ${moment})`);
  }
  return result.blocked ? EXIT.BLOCKED : EXIT.PROVED;
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

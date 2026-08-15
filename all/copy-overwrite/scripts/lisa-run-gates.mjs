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
 * - When a required gate fails we stop, and every gate after it prints as
 *   NOT RUN. Fail-fast is what the hardcoded hooks always did; what would be
 *   new — and wrong — is letting an unrun gate look proved.
 * - A gate that resolves to no command is UNPROVABLE, not passing. Nothing
 *   executed, so nothing was proved, whatever its level says.
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

import { readGates, resolveMoment } from "./lisa-gates.mjs";

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
 * Listed here are only the steps the built-in path always attempts. The
 * conditional ones (`lint:slow`, `knip`, `test:mutation`, the threshold
 * ratchet) self-skip when unconfigured, so their absence from a gates block is
 * not evidence of anything.
 */
export const BUILTIN_FLOOR = Object.freeze({
  commit: Object.freeze([
    "code-style",
    "credential-leakage",
    "format-conformance",
  ]),
  push: Object.freeze([
    "coverage-adequacy",
    "dependency-vulnerability",
    "test-correctness",
    "test-integration",
    "type-correctness",
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
 */

/**
 * What running one moment produced.
 * @typedef {object} GateRun
 * @property {string} moment The moment that was run.
 * @property {boolean} blocked Whether a required gate went unproved.
 * @property {number} total Gates declared at this moment.
 * @property {GateOutcome[]} results Every gate, in execution order.
 * @property {GateOutcome[]} passed Gates that ran and exited zero.
 * @property {GateOutcome[]} failed Gates that failed or could not be proved.
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
 * @param {string} state A `STATE` value.
 * @param {GateOutcome} gate The resolved gate.
 * @param {string} detail Command, reason, or failure note.
 * @returns {string} The formatted line.
 */
function formatLine(state, gate, detail) {
  const token = `${state.toUpperCase()}`.padEnd(STATE_WIDTH);
  const id = gate.id.padEnd(ID_WIDTH);
  return `  ${token}${gate.level.padEnd(9)}${id}${detail}`;
}

/**
 * Execute one gate and classify the result.
 *
 * A `null` or `undefined` exit code — which `spawnSync` produces when a child
 * is killed by a signal — is a failure. It is emphatically not a pass: the
 * command was terminated, so whatever it was proving went unproved.
 * @param {GateOutcome} gate The resolved gate.
 * @param {function(string, GateOutcome): (number|null)} exec Command executor.
 * @returns {{state: string, detail: string, code: number|null}} The outcome.
 */
function execute(gate, exec) {
  const code = exec(gate.command, gate);
  if (code === 0) {
    return { state: STATE.PASSED, detail: gate.command, code: 0 };
  }
  const shown = typeof code === "number" ? code : "terminated";
  return {
    state: STATE.FAILED,
    detail: `${gate.command} (exit ${shown})`,
    code: typeof code === "number" ? code : null,
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
  const byLevel = level => result.failed.filter(entry => entry.level === level);
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
  if (result.notRun.length) {
    lines.push(
      `⏭️  ${result.notRun.length} gate(s) NOT RUN after the blocking failure: ` +
        `${result.notRun.map(entry => entry.id).join(", ")}`
    );
  }
  if (result.blocked) return lines;

  // Every count is stated, including the ones that are zero, so the headline
  // can never imply more was proved than actually ran.
  const counts =
    `${result.passed.length} proved, ${failedOptional.length} failed ` +
    `(optional), ${result.skipped.length} not provable here`;
  lines.push(
    `${failedOptional.length ? "⚠️ " : "✅"} ${result.moment}: ${counts}, ` +
      `of ${result.total} gate(s) declared.` +
      (failedOptional.length ? " See the optional failure(s) above." : "")
  );
  return lines;
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
 * @returns {GateRun} What every declared gate at this moment produced.
 */
export function runGates({
  gates,
  moment,
  runner = "npm run",
  exec,
  out = line => console.log(line),
}) {
  const resolved = resolveMoment({ gates, moment, runner });
  const results = [];
  let blocked = false;

  // Each verdict is printed as it is reached, not batched at the end: a push
  // gate can run for minutes, and an operator watching a hook needs to know
  // which gate is being proved right now, not only what the tally was.
  for (const gate of resolved) {
    const outcome = blocked
      ? { state: STATE.NOT_RUN, detail: "not run", code: null }
      : (classifyStatic(gate) ?? execute(gate, exec));
    results.push({ ...gate, ...outcome });
    out(formatLine(outcome.state, gate, outcome.detail));
    const unproved =
      outcome.state === STATE.FAILED || outcome.state === STATE.UNPROVABLE;
    if (unproved && gate.level === "required") blocked = true;
  }

  const bucket = state => results.filter(entry => entry.state === state);
  const result = {
    moment,
    blocked,
    total: resolved.length,
    results,
    passed: bucket(STATE.PASSED),
    failed: [...bucket(STATE.FAILED), ...bucket(STATE.UNPROVABLE)],
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
 * @returns {string[]} Undeclared floor gate ids, sorted.
 */
export function undeclaredFloor({ gates, moment }) {
  const floor = BUILTIN_FLOOR[moment] ?? [];
  return floor.filter(id => gates?.[id]?.[moment] === undefined);
}

/**
 * The default executor: run the command in a shell, inheriting stdio.
 *
 * stdio is inherited so a failing gate's own output reaches the operator
 * unaltered. Swallowing it and reprinting a summary is how a failure becomes
 * unactionable.
 * @param {string} command The command line to run.
 * @returns {number|null} Exit code, or null when killed by a signal.
 */
function spawnExec(command) {
  const child = spawnSync(command, { shell: true, stdio: "inherit" });
  if (child.error) return null;
  return child.status;
}

/**
 * Read `--moment=<value>` from the argument list.
 * @param {string[]} argv Arguments after the script name.
 * @returns {string|null} The moment, or null when absent.
 */
function readMoment(argv) {
  const hit = argv.find(arg => arg.startsWith("--moment="));
  return hit ? hit.slice("--moment=".length) : null;
}

/**
 * CLI entry point. Every exit path is one of `EXIT`.
 * @returns {number} The process exit code.
 */
function main() {
  const moment = readMoment(process.argv.slice(2));
  if (!moment) {
    console.error("usage: lisa-run-gates.mjs --moment=<moment>");
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
    return EXIT.NO_GATES;
  }

  // A half-written block is an unmigrated project, not a migrated one with
  // fewer guarantees. Fall back rather than let omission delete a property,
  // and name what is missing so finishing the migration is a mechanical edit.
  const missing = undeclaredFloor({ gates: config.gates, moment });
  if (missing.length) {
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
  });
  // A gates block that declares nothing at this moment is a deliberate
  // statement, not an unmigrated project: the registry governs the moment and
  // says there is nothing to prove. Say so rather than silently passing.
  if (result.total === 0) {
    console.log(`   (the gates block declares nothing at ${moment})`);
  }
  return result.blocked ? EXIT.BLOCKED : EXIT.PROVED;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`⚠️  Gate runner crashed: ${err.message}`);
    process.exit(EXIT.RUNNER_FAILED);
  }
}

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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
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

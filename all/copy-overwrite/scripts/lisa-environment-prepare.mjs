#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-environment-prepare — the caller the `environment:*` facade never had.
 *
 * Lisa already defines the facade and ships gates that prove a project's reset
 * guard REFUSES. It shipped nothing that actually resets an environment before
 * a suite, so every consumer hand-wired its own: measured 2026-08-19, one
 * frontend resets after its browser suite via `if: always()`, the same repo's
 * native suite resets not at all, and a second repo's shape could not be
 * verified. A native suite had therefore been accumulating data nightly.
 *
 * This module owns three things and deliberately no more:
 *
 * 1. **Sequencing.** Reset before reseed, always, regardless of the order a
 *    caller lists them. They are not commutative: reseeding and then emptying
 *    leaves an empty environment that reports as prepared.
 * 2. **Failure semantics.** A verb the caller ASKED FOR and that the project
 *    does not declare is a failure, never a skip. This is the whole point. A
 *    suite that runs against an environment nobody reset, and reports green,
 *    is the defect the facade work existed to prevent, and it is exactly what
 *    a tolerant "the script wasn't there, carry on" would reintroduce.
 * 3. **Refusing production before invoking anything.**
 *
 * What it does NOT own is what the verbs do. Per the facade contract §3 the
 * verbs are an interface, not a mechanism; a project may implement them with a
 * local script today and a scoped Lambda tomorrow without this file changing.
 *
 * ## On the production refusal, and what it is worth
 *
 * The check here is a CALLER-SIDE refusal on the environment name it was
 * handed. It is not identity verification and must not be read as any: this
 * process has no connection to the target and no way to learn that a name
 * reading `dev` addresses a production database through a tunnel or a copied
 * env file. That gap is closed by layers this file cannot reach — the reset
 * capability not being deployed to production at all, an execution role that
 * cannot invoke it there, the implementation asserting its own resolved stage,
 * and the implementation asserting the database it actually connected to.
 *
 * So this refusal is the cheap outer layer of several, and its value is that
 * it is the one that fires before a single process starts. It is written
 * against the shipped `lisa-destructive-guard` classifier rather than a fresh
 * regex so that "what counts as production" has ONE definition in Lisa — the
 * guard already treats `prod`, `prd` and `live` as production and treats an
 * identity it cannot read exactly as it treats production.
 *
 * @module scripts/lisa-environment-prepare
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { classifyEnvironment } from "./lisa-destructive-guard.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { readGates } from "./lisa-gates.mjs";

/**
 * The facade's verbs, in the only order they may run.
 *
 * Order is a property of the module rather than of the caller's argument list,
 * because a caller that lists them the other way round has made a mistake this
 * module can simply not honour.
 */
export const FACADE_VERBS = Object.freeze(["reset", "reseed"]);

/**
 * Every reason a preparation can refuse or fail.
 *
 * Machine-readable and stable: reports and workflow steps branch on these, and
 * the facade contract §4 obligation 5 requires a refusal to carry the guard's
 * own vocabulary so it is demonstrably a refusal rather than a crash on the
 * way to one.
 */
export const PREPARE_REASONS = Object.freeze([
  "environment_env_required",
  "environment_target_forbidden",
  "environment_verb_unknown",
  "environment_verb_missing",
  "environment_verb_failed",
]);

/**
 * The task name a verb resolves to.
 * @param {string} verb One of {@link FACADE_VERBS}.
 * @returns {string} The npm script name, e.g. `environment:reset`.
 */
function taskFor(verb) {
  return `environment:${verb}`;
}

/**
 * The command line for a verb.
 *
 * The bare `--` is load-bearing and not stylistic. Measured on 2026-08-19:
 * `npm run <task> --env=dev` reaches the script with NO arguments at all,
 * while `bun run <task> --env=dev` forwards it — so the form without `--` is
 * correct on one runner and silently argument-less on the other. Both runners
 * forward correctly with `--`, so that is the only portable form.
 *
 * An argument-less verb is not a quiet success either: the facade contract §2
 * requires the implementation to refuse a missing `--env`. The failure would
 * therefore be loud rather than dangerous. It would also be baffling, which is
 * reason enough to get the form right here.
 * @param {string} runner Task-runner prefix, e.g. `bun run`.
 * @param {string} verb One of {@link FACADE_VERBS}.
 * @param {string} env The target environment name.
 * @returns {string} The full command line.
 */
function commandFor(runner, verb, env) {
  return `${runner} ${taskFor(verb)} -- --env=${env}`;
}

/**
 * The default executor: run in a shell, inheriting stdio.
 *
 * stdio is inherited so a failing reset's own output reaches the operator
 * unaltered — a summary reprinted by this module would be strictly less useful
 * than what the project's own tooling already said.
 * @param {string} command The command line to run.
 * @returns {number|null} Exit code, or null when the child was killed.
 */
function spawnExec(command) {
  const child = spawnSync(command, { shell: true, stdio: "inherit" });
  if (child.error) return null;
  return child.status;
}

/**
 * Prepare an environment by running the requested facade verbs in order.
 *
 * Every refusal happens BEFORE the first invocation. That ordering is
 * deliberate: a run that resets and then discovers the reseed is missing has
 * emptied a shared environment and left it empty, which is a worse state than
 * the one it started in and one no later step can undo.
 * @param {object} options Options.
 * @param {string} [options.env] Target environment name. Mandatory.
 * @param {readonly string[]} [options.verbs] Verbs the caller requires.
 * @param {Record<string, string>} [options.scripts] The project's npm scripts.
 * @param {string} [options.runner] Task-runner prefix, e.g. `bun run`.
 * @param {(command: string) => number|null} [options.exec] Executor.
 * @returns {{ok: boolean, reason: string|null, message: string, ran: string[]}} Outcome.
 */
export function prepareEnvironment({
  env,
  verbs = FACADE_VERBS,
  scripts = {},
  runner = "npm run",
  exec = spawnExec,
}) {
  const target = typeof env === "string" ? env.trim() : "";
  if (!target) {
    return {
      ok: false,
      reason: "environment_env_required",
      message:
        "--env is required and has no default. A default that is safe in one repo is the production default in another, so there is no value to fall back to.",
      ran: [],
    };
  }

  const unknown = verbs.filter(verb => !FACADE_VERBS.includes(verb));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: "environment_verb_unknown",
      message: `unknown verb(s): ${unknown.join(", ")}. The facade defines exactly ${FACADE_VERBS.join(" and ")}.`,
      ran: [],
    };
  }

  // Ambiguity resolves to refusal: `classifyEnvironment` reports `unresolved`
  // for anything it cannot read, and this treats that identically to
  // production. "I could not tell" must never be the cheaper answer.
  if (classifyEnvironment(target) !== "non-production") {
    return {
      ok: false,
      reason: "environment_target_forbidden",
      message: `"${target}" is refused as a destructive target. Production is refused with no override, and an environment identity that cannot be classified fails closed exactly as production does.`,
      ran: [],
    };
  }

  // Resolve every requested verb before running any of them.
  const ordered = FACADE_VERBS.filter(verb => verbs.includes(verb));
  const missing = ordered.filter(verb => !scripts[taskFor(verb)]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "environment_verb_missing",
      message: `the caller requires ${missing.map(taskFor).join(" and ")}, which this project does not declare. A required verb that is absent is a failure, not a skip — a suite running against an environment nobody prepared proves nothing. Declare the script, or stop requiring the verb.`,
      ran: [],
    };
  }

  const ran = [];
  for (const verb of ordered) {
    const command = commandFor(runner, verb, target);
    ran.push(command);
    const status = exec(command);
    // A null status is spawnSync's report of a child killed by a signal. Any
    // reading other than "failed" lets an OOM-killed reset clear the suite.
    if (status !== 0) {
      return {
        ok: false,
        reason: "environment_verb_failed",
        message: `${taskFor(verb)} ${status === null ? "was killed before it finished" : `exited ${status}`}. Nothing after it ran: a reseed layered onto a failed reset produces fixture data on top of whatever the last run left behind.`,
        ran,
      };
    }
  }

  return {
    ok: true,
    reason: null,
    message: `prepared ${target}: ${ordered.map(taskFor).join(", ")}`,
    ran,
  };
}

/**
 * Read a `--name=<value>` flag from the argument list.
 * @param {readonly string[]} argv Arguments after the script name.
 * @param {string} name Flag name, without dashes.
 * @returns {string|null} The value, or null when absent.
 */
function readFlag(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

/**
 * The `scripts` block of the project's `package.json`.
 * @param {string} cwd Project root.
 * @returns {Record<string, string>} The scripts, empty when unreadable.
 */
function readPackageScripts(cwd) {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"))?.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * CLI entry point.
 * @param {readonly string[]} [argv] Arguments after the script name.
 * @param {string} [cwd] Project root.
 * @returns {number} Process exit code.
 */
export function runCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const env = readFlag(argv, "env");
  const verbsFlag = readFlag(argv, "verbs");
  const verbs = verbsFlag
    ? verbsFlag
        .split(",")
        .map(verb => verb.trim())
        .filter(Boolean)
    : FACADE_VERBS;

  let runner = "npm run";
  try {
    runner = readGates(cwd).runner;
  } catch {
    // A config this module cannot read is not a reason to guess a runner and
    // press on; but it is also not this module's error to report. The default
    // matches the gate runner's own fallback so the two never disagree.
  }

  const result = prepareEnvironment({
    env,
    verbs,
    scripts: readPackageScripts(cwd),
    runner,
  });

  if (result.ok) {
    console.log(`✅ ${result.message}`);
    return 0;
  }
  console.error(`❌ environment preparation refused: ${result.reason}`);
  console.error(`   ${result.message}`);
  return 1;
}

// Realpath-based, for the reason spelled out at the foot of lisa-gates.mjs: a
// string comparison of module URLs answers "no" through a symlinked checkout,
// a git worktree, or a macOS /tmp path, and this file would then load, run
// nothing, and exit 0 — a preparation that never happened, reported as done.
if (invokedAsScript(import.meta.url)) {
  process.exit(runCli());
}

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
 * 1. **Lifecycle completeness and sequencing.** Every preparation invokes
 *    reset and then reseed. They are not commutative: reseeding and then
 *    emptying leaves an empty environment that reports as prepared. A project
 *    that needs no fixture data still declares an explicit no-op reseed so the
 *    lifecycle remains observable and uniform; omitting the verb is not the
 *    same decision.
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

import { classifyEnvironment } from "./lisa-destructive-guard.mjs";
import { boundedSpawnSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
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
  "environment_name_malformed",
  "environment_runner_malformed",
  "environment_target_forbidden",
  "environment_verb_unknown",
  "environment_lifecycle_incomplete",
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
 * A usable environment name.
 *
 * An allowlist of shapes, not a denylist of dangerous characters, and that is
 * the whole point — a denylist is a list of the attacks someone thought of.
 * This admits `dev`, `staging`, `us-prod-1`, `preview_2`; it admits nothing
 * carrying a space, a quote, a semicolon, a backtick, or `$(`.
 *
 * Without it, `classifyEnvironment` is not sufficient protection even though it
 * is the right classifier: it splits on non-alphanumerics and inspects the
 * SEGMENTS, so `dev; rm -rf /` yields `dev`, `rm`, `rf` — none of which look
 * like production — and the value passes the refusal. Measured before this
 * existed, `--env='dev; touch /tmp/x'` produced the command
 * `bun run environment:reset -- --env=dev; touch /tmp/x`. The injected half
 * could name production, so the omission defeated the production guard using
 * the very input that guard exists to check.
 */
const ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * A usable task-runner prefix.
 *
 * Same reasoning, applied to the other value that reaches the child process.
 * It comes from `.lisa.config.json`, which is a less likely attacker channel
 * than a workflow input — but "less likely" is not a property worth relying on
 * when the check costs one regular expression. Mirrors the plain-command
 * validation `quality.yml` already applies to a resolved gate command.
 */
const RUNNER_PREFIX = /^[A-Za-z0-9][A-Za-z0-9 ._@:/-]*$/u;

/**
 * How a refused task runner is named back to the operator.
 *
 * A non-string is described by its type rather than interpolated: `[object
 * Object]` in a refusal message tells a reader nothing about what their config
 * actually holds, and the value is untrusted config in the first place.
 * @param {unknown} runner The configured runner value.
 * @returns {string} A phrase that fits "the configured task runner ___ is not…".
 */
function describeRunner(runner) {
  if (typeof runner === "string") return `"${runner}"`;
  if (runner === null) return "is null, which";
  if (Array.isArray(runner)) return "is an array, which";
  return `is a ${typeof runner}, which`;
}

/**
 * The argument vector for a verb.
 *
 * A vector rather than a command line, and executed WITHOUT a shell, so no
 * amount of punctuation in any element can become syntax. The name validation
 * above already makes that unreachable; this makes it impossible rather than
 * merely blocked, which is the correct arrangement for the destructive path.
 *
 * The bare `--` is load-bearing and not stylistic. Measured on 2026-08-19:
 * `npm run <task> --env=dev` reaches the script with NO arguments at all,
 * while `bun run <task> --env=dev` forwards it — so the form without `--` is
 * correct on one runner and silently argument-less on the other. Both runners
 * forward correctly with `--`, so that is the only portable form.
 * @param {string} runner Task-runner prefix, e.g. `bun run`.
 * @param {string} verb One of {@link FACADE_VERBS}.
 * @param {string} env The target environment name.
 * @returns {string[]} The argument vector, executable without a shell.
 */
function argvFor(runner, verb, env) {
  return [...runner.trim().split(/\s+/u), taskFor(verb), "--", `--env=${env}`];
}

/**
 * Hang-detector deadline for one environment verb, in milliseconds.
 *
 * Twenty minutes, and the number is a ceiling rather than an expectation. A
 * reset that drops and rebuilds a database, or a reseed that writes fixture
 * data, is measured in minutes on a busy machine; anything past this is a
 * process that has stopped making progress, and waiting longer converts a
 * detectable hang into an operator staring at an inherited stdio that has gone
 * quiet.
 */
const ENVIRONMENT_VERB_BUDGET_MS = 20 * 60 * 1000;

/**
 * The default executor: run the vector directly, inheriting stdio.
 *
 * No `shell: true`. stdio is inherited so a failing reset's own output reaches
 * the operator unaltered — a summary reprinted by this module would be strictly
 * less useful than what the project's own tooling already said.
 *
 * The deadline is deliberately NOT the shared default. The child here is the
 * PROJECT's own environment tooling — a database reset, a reseed — which
 * legitimately runs for minutes, so a default sized for a `git` call would make
 * this module's own timeout the ordinary outcome. It is a hang detector, not a
 * budget: a reset still running after this long is not going to finish.
 *
 * The killed-child verdict downstream is right — the caller reports "was killed
 * before it finished. Nothing after it ran", which is correct because a reseed
 * layered onto a failed reset produces fixture data on top of whatever the last
 * run left behind. Reaching it is what this has to get right.
 *
 * `boundedSpawnSync` reports a kill by THROWING, deliberately, so that a call
 * site which does nothing inherits fail-closed behaviour. This one did
 * something: it read `child.error` on the RETURNED result, which is the shape
 * plain `spawnSync` produces and the shape the helper exists to remove. That
 * branch was therefore unreachable for a kill, and the throw went past
 * `prepareEnvironment` entirely — so the deadline produced a stack trace rather
 * than the refusal the caller already knew how to print.
 *
 * The `catch` is narrow on purpose. Only a killed child converts to a verdict;
 * anything else is re-raised, because a fault this module cannot name is not
 * evidence about the environment and must not be reported as one.
 * @param {string[]} argv The argument vector.
 * @returns {number|null} Exit code, or null when the child was killed.
 */
function spawnExec(argv) {
  const [file, ...args] = argv;
  try {
    const child = boundedSpawnSync(file, args, {
      stdio: "inherit",
      timeout: ENVIRONMENT_VERB_BUDGET_MS,
    });
    // Not dead code: a non-timeout `spawnSync` failure — `ENOENT` for a runner
    // that is not installed — still arrives on the result rather than as a
    // throw, and it means the verb did not run, which is the same verdict.
    if (child.error) return null;
    return child.status;
  } catch (error) {
    if (isChildTimeout(error)) return null;
    throw error;
  }
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
 * @param {readonly string[]} [options.verbs] Lifecycle verbs. Both are required;
 * a caller may retain this compatibility input, but it cannot select a subset.
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

  // Shape BEFORE meaning. A name that cannot be a name is refused as
  // malformed rather than classified, because classification of a malformed
  // value is where the injection lived: the classifier reads alphanumeric
  // segments and is blind to the punctuation between them.
  if (!ENVIRONMENT_NAME.test(target)) {
    return {
      ok: false,
      reason: "environment_name_malformed",
      message: `"${target}" is not a usable environment name. Names must start with a letter or digit and contain only letters, digits, dot, underscore and hyphen. Anything else is refused before it is classified, because a value carrying shell punctuation can look non-production segment by segment while naming production in the part that gets executed.`,
      ran: [],
    };
  }

  // TYPE FIRST, then shape. `RegExp.prototype.test` coerces its argument, so
  // `RUNNER_PREFIX.test(true)` tests the string `"true"` and passes — the
  // pattern reads as a type check and is not one. This value is not
  // hypothetical: it comes from `readGates(cwd).runner`, which destructures the
  // host's `.lisa.config.json` with a string default and returns whatever the
  // file actually held. The refusal that belongs here instead surfaced one line
  // later as `runner.trim is not a function` from `argvFor`.
  if (typeof runner !== "string" || !RUNNER_PREFIX.test(runner)) {
    return {
      ok: false,
      reason: "environment_runner_malformed",
      message: `the configured task runner ${describeRunner(runner)} is not a plain command. Set gates.runner in .lisa.config.json to something like "bun run".`,
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

  const omitted = FACADE_VERBS.filter(verb => !verbs.includes(verb));
  if (omitted.length > 0) {
    return {
      ok: false,
      reason: "environment_lifecycle_incomplete",
      message: `environment preparation always requires ${FACADE_VERBS.join(" then ")}; omitted ${omitted.join(", ")}. A reseed that has no fixture data to write must still be declared and invoked as an explicit no-op, so every environment follows one observable lifecycle.`,
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
  const ordered = FACADE_VERBS;
  const missing = ordered.filter(verb => !scripts[taskFor(verb)]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "environment_verb_missing",
      message: `the lifecycle requires ${missing.map(taskFor).join(" and ")}, which this project does not declare. A required verb that is absent is a failure, not a skip — a suite running against an environment nobody prepared proves nothing. Declare the script; when no fixture data is needed, environment:reseed may be an explicit no-op that reports that outcome.`,
      ran: [],
    };
  }

  const ran = [];
  for (const verb of ordered) {
    const argv = argvFor(runner, verb, target);
    ran.push(argv.join(" "));
    const status = exec(argv);
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
  const verbs =
    verbsFlag === null && !argv.includes("--verbs")
      ? FACADE_VERBS
      : (verbsFlag ?? "")
          .split(",")
          .map(verb => verb.trim())
          .filter(Boolean);

  let runner = "npm run";
  try {
    runner = readGates(cwd).runner;
  } catch {
    // An unreadable config falls back to the same default the gate runner
    // uses, so the two never disagree about how to invoke a task. The comment
    // that stood here claimed this was "not a reason to guess a runner and
    // press on", which is the opposite of what the code does — it does press
    // on, deliberately. Pressing on is safe because the fallback is a plain
    // `npm run`: a project whose scripts are not reachable that way fails at
    // the verb, with its own error, rather than here with a guess about why.
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

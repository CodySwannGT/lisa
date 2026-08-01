#!/usr/bin/env node
/**
 * Send one unit of work to a remote execution surface, then get out of the way.
 *
 * `executionEnv` is **routing and nothing else**. The remote runs the identical
 * skill from the identical repository; only the machine differs. Keeping that
 * line bright is what stops the parameter from growing into a second
 * implementation that has to be kept in sync with the first.
 *
 * Dispatch is fire-and-record. `codex cloud exec` submits a task and returns —
 * measured at three and four seconds in two production runs whose tasks opened
 * pull requests roughly six minutes later, long after the dispatcher had exited.
 * So this records durable identifiers and stops. It does not poll, and it holds
 * nothing open: the operator's machine is a launcher, not the substrate, and
 * closing the lid must be harmless.
 *
 * Usage:
 *   dispatch.mjs 'executionEnv=codex-cloud SE-45434' --skill lisa-implement
 * @module dispatch
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Surfaces this dispatcher knows how to reach. `local` means "do not dispatch". */
export const EXECUTION_ENVS = new Set(["local", "codex-cloud"]);

/** Where dispatched work is recorded so a later session can find it. */
const LEDGER = join(".lisa", "remote-dispatch.json");

/**
 * Split `key=value` parameters from the rest of an invocation.
 *
 * The remainder is passed through untouched. It is the caller's payload — a
 * ticket key, a description — and this program has no business interpreting it.
 * @param {string} input Raw argument string.
 * @returns {{params: Record<string, string>, rest: string}} Parsed invocation.
 */
export function parseInvocation(input) {
  const params = {};
  const rest = [];
  for (const token of String(input ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(token);
    if (match) params[match[1]] = match[2];
    else rest.push(token);
  }
  return { params, rest: rest.join(" ") };
}

/**
 * Resolve the requested execution surface, rejecting anything unknown.
 *
 * Rejecting explicitly matters more than it looks. A silently ignored
 * `executionEnv` would run the work locally while the operator believes it went
 * remote, and nothing downstream would contradict that belief.
 * @param {Record<string, string>} params Parsed parameters.
 * @returns {string} A member of {@link EXECUTION_ENVS}.
 */
export function resolveExecutionEnv(params) {
  const requested = params.executionEnv ?? "local";
  if (!EXECUTION_ENVS.has(requested)) {
    throw new Error(
      `unknown executionEnv "${requested}".\n` +
        `Supported: ${[...EXECUTION_ENVS].join(", ")}.`
    );
  }
  return requested;
}

/**
 * Read the surface binding for a remote environment.
 * @param {string} surface Execution surface.
 * @param {string} [cwd] Directory to look in.
 * @returns {object} The surface's configuration block.
 */
export function readSurfaceConfig(surface, cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) throw new Error(".lisa.config.json is missing");
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  const block = cfg.remoteEnv?.surfaces?.[surface];
  if (!block) {
    throw new Error(
      `no remoteEnv.surfaces["${surface}"] in .lisa.config.json.\n` +
        `Run /lisa:setup:remote-env ${surface} before dispatching to it.`
    );
  }
  return block;
}

/**
 * Refuse to dispatch into an environment that is not demonstrably ready.
 *
 * Every check here has a message naming the setup step that fixes it. The
 * alternative is a Cloud task that dies confusingly ten minutes later, in a log
 * the operator has to go looking for.
 * @param {object} block Surface configuration.
 * @param {string} surface Execution surface.
 */
export function assertPreconditions(block, surface) {
  const missing = [];
  if (!block.environmentId) missing.push("environmentId");
  if (!block.repository) missing.push("repository");
  if (missing.length) {
    throw new Error(
      `remoteEnv.surfaces["${surface}"] is missing: ${missing.join(", ")}.\n` +
        `Run /lisa:setup:remote-env ${surface} to provision and record it.`
    );
  }
}

/**
 * Find the task identifier in whatever the CLI printed.
 *
 * The identifier is the only durable handle on work that outlives this process,
 * so failing to capture it is treated as a failed dispatch even when the command
 * itself succeeded. An untracked remote task is worse than none: nothing can
 * reconcile it, and a retry would duplicate it.
 * @param {string|undefined} output Combined CLI output.
 * @returns {string|null} The task identifier, or null when absent.
 */
export function extractTaskId(output) {
  const match = /\btask_[A-Za-z0-9]+_[0-9a-f]{8,}\b/.exec(String(output ?? ""));
  return match ? match[0] : null;
}

/**
 * Build the argument vector for a Codex Cloud dispatch.
 *
 * `--branch` is always explicit. It defaults to the *current* branch, and a
 * dispatcher's incidental checkout state must never decide where work runs.
 *
 * Model is passed through `-c` because the subcommand has no `--model` flag.
 * `attempts` is best-of-N and multiplies remote consumption, so it is stated
 * rather than left to an implicit default.
 * @param {object} block Surface configuration.
 * @param {string} prompt The thin skill invocation.
 * @returns {string[]} Arguments for `codex`.
 */
export function buildCodexArgs(block, prompt) {
  const args = ["cloud", "exec", "--env", block.environmentId];
  args.push("--branch", block.branch ?? "main");
  if (block.model) args.push("-c", `model=${JSON.stringify(block.model)}`);
  if (block.attempts) args.push("--attempts", String(block.attempts));
  args.push(prompt);
  return args;
}

/**
 * Append one dispatch to the durable ledger.
 *
 * Written before anything is reported to the operator. If this process dies
 * immediately afterwards, the record is what makes the remote task findable.
 * @param {object} entry Ledger entry.
 * @param {string} [cwd] Repository root.
 */
function record(entry, cwd = process.cwd()) {
  const path = join(cwd, LEDGER);
  mkdirSync(join(cwd, ".lisa"), { recursive: true });
  const existing = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { version: 1, dispatches: [] };
  existing.dispatches.push(entry);
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
}

/**
 * Dispatch to Codex Cloud and record the result.
 * @param {object} block Surface configuration.
 * @param {string} prompt Thin skill invocation.
 * @param {string} payload The caller's original payload, for the record.
 * @returns {string} The task identifier.
 */
function dispatchCodexCloud(block, prompt, payload) {
  const args = buildCodexArgs(block, prompt);
  let output;
  try {
    output = execFileSync("codex", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(
      `codex cloud exec failed: ${String(err.stderr ?? err.message).trim()}`
    );
  }

  const taskId = extractTaskId(output);
  if (!taskId) {
    throw new Error(
      `dispatch returned no task identifier.\n${output}\n` +
        `Refusing to report success: without the identifier nothing can ` +
        `reconcile this task, and a retry would duplicate it.`
    );
  }

  record({
    taskId,
    surface: "codex-cloud",
    environmentId: block.environmentId,
    repository: block.repository,
    branch: block.branch ?? "main",
    prompt,
    payload,
    dispatchedAt: new Date().toISOString(),
  });
  return taskId;
}

/**
 * Split `--skill NAME` out of the argument vector.
 *
 * Kept separate and tested because the obvious index-filter version is wrong in
 * the default case: with no `--skill` present, `indexOf` returns -1 and a filter
 * on `skillIndex + 1` silently drops argv[0] — which is the entire payload. The
 * failure is invisible, because a swallowed payload parses as no parameters,
 * which resolves to `local`, which looks like a perfectly ordinary local run.
 * @param {string[]} argv Arguments after the script name.
 * @returns {{skill: string, raw: string}} The target skill and remaining input.
 */
export function splitSkillFlag(argv) {
  const index = argv.indexOf("--skill");
  if (index === -1) return { skill: "lisa-implement", raw: argv.join(" ") };
  const skill = argv[index + 1];
  if (!skill) throw new Error("--skill requires a skill name");
  const rest = [...argv.slice(0, index), ...argv.slice(index + 2)];
  return { skill, raw: rest.join(" ") };
}

function main() {
  const { skill, raw } = splitSkillFlag(process.argv.slice(2));
  const { params, rest } = parseInvocation(raw);
  const surface = resolveExecutionEnv(params);

  if (surface === "local") {
    console.log("local");
    return;
  }

  const block = readSurfaceConfig(surface);
  assertPreconditions(block, surface);

  // The invocation stays thin on purpose. Every durable instruction lives in
  // the repository-local skill, so an interactive run, a scheduled run, and a
  // recovery run all execute one contract.
  const prompt = `$${skill} ${rest}`.trim();
  const taskId = dispatchCodexCloud(block, prompt, rest);

  console.log(`dispatched: ${taskId}`);
  console.log(`https://chatgpt.com/codex/tasks/${taskId}`);
  console.log(`recorded in ${LEDGER}; not polling — this process is done.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

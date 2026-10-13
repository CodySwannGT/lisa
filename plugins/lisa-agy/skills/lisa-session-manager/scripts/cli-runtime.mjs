/**
 * Shared plumbing for the session-manager CLI subcommands: exit codes, the
 * error type that carries one, config loading, child-process execution and
 * stdin.
 *
 * Every subcommand module receives a `ctx` built once by `session-manager.mjs`
 * (the only file that reads the real environment), so nothing here reaches for
 * globals. Child processes are always started with `spawnSync(command, argv)`:
 * there is no shell anywhere on this path, so ticket text, Telegram text and
 * worker names can never be re-parsed as shell syntax.
 * @module session-manager/cli-runtime
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  resolveSessionManagerConfig,
  validateSessionManager,
} from "./config.mjs";
import {
  HUMAN_GATE_SIGNAL,
  resolveSignalLabel,
} from "../../../scripts/qa-signal-lifecycle.mjs";
import { normalizeAgents, scrubWorkerEnv } from "./workers.mjs";

/** Exit codes the manager skill branches on. */
export const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 1,
  SETUP: 2,
  NO_CAPACITY: 3,
  LIVE_WORKER: 4,
});

/** The config files Lisa reads, local over global per key. */
export const GLOBAL_CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";

/** Child output can be a whole paginated queue; allow far more than 1 MiB. */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A refusal or failure with the exit code the CLI should end with, and
 * optionally a JSON body to print on stdout (e.g. the capacity report for
 * exit 3, so the manager can say why it did not spawn).
 */
export class CliError extends Error {
  /**
   * @param {string} message - Operator-readable reason, printed on stderr
   * @param {number} [exitCode] - Process exit code
   * @param {unknown} [json] - Optional stdout body
   */
  constructor(message, exitCode = EXIT.FAILURE, json = undefined) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.json = json;
  }
}

/**
 * Run `fn`, turning any plain error it throws (a validation refusal from a
 * pure module) into a setup error, exit 2. System errors (they carry a
 * `code` such as EACCES) and CliErrors pass through unchanged.
 * @template T
 * @param {() => T} fn - Work that may refuse its input
 * @returns {T} Its result
 */
export function asSetupError(fn) {
  try {
    return fn();
  } catch (error) {
    throw toSetupError(error);
  }
}

/**
 * Async form of {@link asSetupError}.
 * @template T
 * @param {() => Promise<T>} fn - Work that may refuse its input
 * @returns {Promise<T>} Its result
 */
export async function asSetupErrorAsync(fn) {
  try {
    return await fn();
  } catch (error) {
    throw toSetupError(error);
  }
}

/**
 * Map one thrown value to a CliError, keeping system errors as they are.
 * @param {unknown} error - Thrown value
 * @returns {unknown} Value to rethrow
 */
function toSetupError(error) {
  if (error instanceof CliError || typeof error?.code === "string") {
    return error;
  }
  return new CliError(error?.message ?? String(error), error?.exitCode ?? 2);
}

/**
 * Read and parse one JSON config file; absent is `undefined`.
 * @param {string} file - Absolute path
 * @returns {object | undefined} Parsed config
 */
function readConfigFile(file) {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`${file} is not valid JSON: ${error.message}`, 2);
  }
}

/**
 * The view of a resolved block the validator expects: keys the resolver
 * fills with `null` for "absent" are passed as absent.
 * @param {object} config - Resolved block
 * @returns {object} Block to validate
 */
function validationView(config) {
  return {
    ...config,
    repos: config.repos ?? undefined,
    trustedAuthorIds: config.trustedAuthorIds ?? undefined,
  };
}

/**
 * Read both config files and resolve the `sessionManager` block.
 * @param {string} root - Absolute project root
 * @returns {{ global: object | undefined, local: object | undefined,
 *   config: object | null, errors: string[] }} Raw files, resolved block
 *   (null when absent) and validation errors
 */
export function loadProject(root) {
  const global = readConfigFile(path.join(root, GLOBAL_CONFIG_FILE));
  const local = readConfigFile(path.join(root, LOCAL_CONFIG_FILE));
  const config = resolveSessionManagerConfig(global, local);
  const errors = config ? validateSessionManager(validationView(config)) : [];
  return { global, local, config, errors };
}

/**
 * The label that marks an item as waiting on a person, for this tracker.
 *
 * Each tracker keeps it somewhere different and Jira's default is spelled
 * differently (`Human Needed`), so a hardcoded `human-needed` would let a held
 * Jira item through to a worker. Local config wins over global, then the
 * tracker's own default.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @param {string | undefined} tracker - `github`, `jira` or `linear`; the
 *   project's configured tracker when omitted
 * @returns {string | undefined} The label, or undefined for an unknown tracker
 */
export function humanNeededLabel(project, tracker) {
  const vendor = tracker ?? project.local?.tracker ?? project.global?.tracker;
  for (const config of [project.local, project.global]) {
    const resolved = resolveSignalLabel({
      signal: HUMAN_GATE_SIGNAL,
      config,
      vendor,
    });
    if (resolved.source === "config") return resolved.value;
  }
  const fallback = resolveSignalLabel({
    signal: HUMAN_GATE_SIGNAL,
    config: {},
    vendor,
  });
  return fallback.value || undefined;
}

/**
 * Throw exit 2 unless the block is valid; return it only when present.
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {object | null} Resolved block, or null when absent
 */
export function validOrAbsent(project) {
  if (project.errors.length > 0) {
    throw new CliError(
      `sessionManager config is invalid:\n- ${project.errors.join("\n- ")}`,
      2
    );
  }
  return project.config;
}

/**
 * The resolved block, or exit 2 when it is absent or invalid.
 * @param {{ root: string }} ctx - CLI context
 * @returns {object} Resolved `sessionManager` block
 */
export function requireConfig(ctx) {
  const config = validOrAbsent(loadProject(ctx.root));
  if (!config) {
    throw new CliError(
      `No sessionManager block in ${path.join(ctx.root, GLOBAL_CONFIG_FILE)}. ` +
        `Run /lisa:setup:session-manager first.`,
      2
    );
  }
  return config;
}

/**
 * Throw exit 2 unless `dir` carries a `.lisa.config.json`: a worker running
 * `/lisa:implement` there would have no tracker or gates.
 * @param {string} dir - Absolute repo dir
 * @returns {string} The same dir
 */
export function requireLisaRepo(dir) {
  if (!existsSync(path.join(dir, GLOBAL_CONFIG_FILE))) {
    throw new CliError(
      `${dir} has no ${GLOBAL_CONFIG_FILE}; a worker cannot run /lisa:implement there.`,
      2
    );
  }
  return dir;
}

/**
 * Run a command with an argv array and no shell.
 * @param {string} command - Executable, looked up on PATH
 * @param {readonly string[]} args - argv
 * @param {{ env: Record<string, string | undefined>, cwd?: string }} options
 *   - Environment and working directory
 * @returns {{ status: number | null, stdout: string, stderr: string,
 *   missing: boolean }} Outcome; `missing` when the command is not on PATH
 */
export function run(command, args, { env, cwd }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    missing: result.error?.code === "ENOENT",
  };
}

/**
 * Run a command and return its stdout, or throw exit 1 naming what failed.
 * @param {string} command - Executable
 * @param {readonly string[]} args - argv
 * @param {{ env: Record<string, string | undefined>, cwd?: string }} options
 *   - Environment and working directory
 * @returns {string} stdout
 */
export function mustRun(command, args, options) {
  const result = run(command, args, options);
  if (result.missing) {
    throw new CliError(`${command} is not on PATH.`, 1);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status}`;
    throw new CliError(`${command} ${args[0] ?? ""} failed: ${detail}`, 1);
  }
  return result.stdout;
}

/**
 * Normalized `claude agents --json` rows. `all` adds finished sessions,
 * which matter for naming (never reuse a name) but never for liveness.
 * @param {{ env: Record<string, string | undefined> }} ctx - CLI context
 * @param {{ all?: boolean }} [options] - Include finished sessions
 * @returns {ReturnType<typeof normalizeAgents>} Rows
 */
export function listAgents(ctx, { all = false } = {}) {
  const args = all ? ["agents", "--json", "--all"] : ["agents", "--json"];
  const stdout = mustRun("claude", args, { env: scrubWorkerEnv(ctx.env) });
  try {
    return normalizeAgents(JSON.parse(stdout));
  } catch (error) {
    throw new CliError(`claude agents --json: ${error.message}`, 1);
  }
}

/**
 * Text piped on stdin, trimmed. Untrusted text (answers, questions, reasons,
 * summaries) always arrives here, never in argv.
 * @param {{ readStdin: () => string }} ctx - CLI context
 * @param {string} what - What the text is, for the error message
 * @param {{ required?: boolean }} [options] - Refuse empty input
 * @returns {string} Text
 */
export function stdinText(ctx, what, { required = true } = {}) {
  const text = ctx.readStdin().trim();
  if (required && text === "") {
    throw new CliError(`Pipe the ${what} on stdin; it was empty.`, 2);
  }
  return text;
}

/**
 * Parse a non-negative integer flag, or exit 2.
 * @param {string | undefined} value - Flag value
 * @param {string} flag - Flag name for the message
 * @returns {number | undefined} Integer, or undefined when absent
 */
export function intFlag(value, flag) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new CliError(`${flag} must be a non-negative integer.`, 2);
  }
  return Number(value);
}

/**
 * The first positional, or exit 2.
 * @param {{ positionals: string[] }} ctx - CLI context
 * @param {string} what - Name for the message
 * @returns {string} Value
 */
export function requirePositional(ctx, what) {
  const [value] = ctx.positionals;
  if (!value) throw new CliError(`Missing <${what}>.`, 2);
  return value;
}

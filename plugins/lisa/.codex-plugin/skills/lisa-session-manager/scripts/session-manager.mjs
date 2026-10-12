#!/usr/bin/env node
/**
 * The session manager's one entrypoint: every skill call goes through here.
 *
 * It parses argv, builds one context, runs a subcommand and maps the outcome
 * to an exit code the manager skill branches on (0 ok, 1 failure, 2 bad repo
 * or config, 3 no capacity, 4 live worker). The logic lives in the pure
 * modules beside it; this file only wires real seams into them.
 *
 * The real environment is read in exactly one place, the call at the bottom
 * of this file. It is passed down as `ctx.env`, and every child that could be
 * a worker or could host one gets it through `scrubWorkerEnv`, which drops
 * every `TELEGRAM_*` key. Children are started with argv arrays, never a shell
 * string, and untrusted text arrives on stdin, so a ticket title or a
 * Telegram message can never become shell syntax.
 *
 * Runtime parity: the manager PROCESS is always Claude Code, because it needs
 * background sessions (`claude --bg`, `claude agents`), cross-session
 * messaging and channels, which no other supported agent has. Codex, Cursor,
 * OpenCode, Antigravity, Copilot and Devin can run the setup-time subcommands
 * (init-config, store-token, validate, start), and `start` hosts a Claude Code
 * manager in tmux whatever agent ran it; they cannot run a manager cycle
 * themselves. OpenCode copies skill folders without the plugin-level
 * `scripts/` directory, so `queue` and `record-cycle` (which import from it)
 * are unavailable there unless the npm package provides that directory.
 * @module session-manager
 */
import { readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  LEDGER_ACTION_NAMES,
  blockedPlan,
  ledger,
  recordCycle,
  route,
} from "./cli-cycle.mjs";
import {
  initConfig,
  repoDir,
  start,
  status,
  stop,
  storeToken,
  validate,
} from "./cli-manager.mjs";
import { queue } from "./cli-queue.mjs";
import { CliError, EXIT } from "./cli-runtime.mjs";
import { USAGE } from "./cli-usage.mjs";
import { capacity, classify, resume, spawn } from "./cli-workers.mjs";

const text = { type: "string" };
const flag = { type: "boolean" };
const MEASURE = { "max-workers": text, meminfo: text };

/** Each subcommand: handler, accepted flags, and how many positionals. */
const COMMANDS = {
  capacity: { run: capacity, options: MEASURE, positionals: 0 },
  spawn: { run: spawn, options: { ...MEASURE, repo: text }, positionals: 1 },
  resume: { run: resume, options: {}, positionals: 1 },
  classify: { run: classify, options: {}, positionals: 1 },
  status: { run: status, options: {}, positionals: 0 },
  start: { run: start, options: {}, positionals: 0 },
  stop: { run: stop, options: {}, positionals: 0 },
  "store-token": {
    run: storeToken,
    options: { replace: flag },
    positionals: 0,
  },
  "repo-dir": {
    run: repoDir,
    options: { repo: text, raw: flag },
    positionals: 0,
  },
  validate: { run: validate, options: {}, positionals: 0 },
  "init-config": {
    run: initConfig,
    options: { slug: text, write: flag },
    positionals: 0,
  },
  queue: {
    run: queue,
    options: {
      tracker: text,
      input: text,
      me: text,
      label: text,
      "github-repo": text,
    },
    positionals: 0,
  },
  ledger: { run: ledger, options: {}, positionals: 0 },
  route: {
    run: route,
    options: { "reply-to": text, owner: text },
    positionals: 0,
  },
  "blocked-plan": {
    run: blockedPlan,
    options: { input: text, ref: text },
    positionals: 0,
  },
  "record-cycle": {
    run: recordCycle,
    options: {
      outcome: text,
      ref: { ...text, multiple: true },
      "run-id": text,
    },
    positionals: 0,
  },
};

/** Flags and positionals for each `ledger <action>`. */
const LEDGER_SPECS = {
  get: { options: {}, positionals: 1 },
  "record-spawn": {
    options: { worker: text, "session-id": text, repo: text },
    positionals: 1,
  },
  "set-question": {
    options: { "telegram-message-id": text, sender: text },
    positionals: 1,
  },
  "clear-question": { options: {}, positionals: 1 },
  finish: { options: { status: text, sender: text }, positionals: 1 },
  control: {
    options: { paused: text, "max-workers": text, me: text },
    positionals: 0,
  },
};

const COMMON = { "project-root": text, help: { ...flag, short: "h" } };

/**
 * Resolve the subcommand (and ledger action) and parse its argv strictly.
 * @param {string[]} argv - Arguments after the script path
 * @returns {{ command: object, action: string | undefined,
 *   values: Record<string, any>, positionals: string[] }} Parsed call
 */
function parseCall(argv) {
  const [name, ...rest] = argv;
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) throw new CliError(`Unknown subcommand "${name}".`, EXIT.SETUP);
  const isLedger = name === "ledger";
  const action = isLedger ? rest.shift() : undefined;
  if (isLedger && !LEDGER_ACTION_NAMES.includes(action ?? "")) {
    throw new CliError(
      `ledger needs one of: ${LEDGER_ACTION_NAMES.join(", ")}.`,
      EXIT.SETUP
    );
  }
  const spec = isLedger ? LEDGER_SPECS[action] : command;
  const { values, positionals } = parseArgs({
    args: rest,
    options: { ...COMMON, ...spec.options },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > spec.positionals) {
    throw new CliError(
      `Unexpected argument "${positionals[spec.positionals]}".`,
      EXIT.SETUP
    );
  }
  return { command, action, values, positionals };
}

/**
 * The project root: `--project-root` (absolute), else the cwd.
 * @param {string | undefined} value - Flag value
 * @returns {string} Absolute root
 */
function projectRoot(value) {
  if (value === undefined) return process.cwd();
  if (!path.isAbsolute(value)) {
    throw new CliError("--project-root must be an absolute path.", EXIT.SETUP);
  }
  return path.resolve(value);
}

/**
 * Read all of stdin. Refuses an interactive terminal rather than waiting on
 * a read nobody will answer.
 * @returns {string} stdin contents
 */
function readStdin() {
  if (process.stdin.isTTY) {
    throw new CliError("Pipe the input on stdin.", EXIT.SETUP);
  }
  return readFileSync(0, "utf8");
}

/**
 * Run one CLI call.
 * @param {string[]} argv - Arguments after the script path
 * @param {{ env: Record<string, string | undefined> }} seams - The real
 *   environment, read once by the caller
 * @returns {Promise<number>} Exit code
 */
async function main(argv, { env }) {
  const out = chunk => process.stdout.write(chunk);
  const warn = message => process.stderr.write(`${message}\n`);
  try {
    if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0])) {
      out(USAGE);
      return EXIT.OK;
    }
    const { command, action, values, positionals } = parseCall(argv);
    if (values.help) {
      out(USAGE);
      return EXIT.OK;
    }
    const result = await command.run({
      root: projectRoot(values["project-root"]),
      env,
      values,
      positionals,
      action,
      platform: process.platform,
      homedir: os.homedir(),
      scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
      now: () => new Date(),
      readStdin,
      warn,
    });
    if (result.text !== undefined) out(result.text);
    if (result.json !== undefined) out(`${JSON.stringify(result.json)}\n`);
    return result.exitCode ?? EXIT.OK;
  } catch (error) {
    if (error?.json !== undefined) out(`${JSON.stringify(error.json)}\n`);
    warn(error?.message ?? String(error));
    if (typeof error?.exitCode === "number") return error.exitCode;
    if (String(error?.code ?? "").startsWith("ERR_PARSE_ARGS")) {
      warn("Run with --help for usage.");
      return EXIT.SETUP;
    }
    return EXIT.FAILURE;
  }
}

/**
 * Whether this module is the one node was asked to run. Both sides are
 * realpath'd, so a worktree, a symlinked checkout or a /tmp path on macOS
 * still runs the CLI instead of silently exiting 0. A local copy rather than
 * an import, because plugin payload scripts ship standalone.
 * @param {string} moduleUrl - The caller's own `import.meta.url`
 * @param {string | undefined} [argv1] - Entry path
 * @returns {boolean} Whether to run the CLI body
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  // The single read of the real environment (see the module header).
  main(process.argv.slice(2), { env: { ...process.env } }).then(
    code => {
      process.exitCode = code;
    },
    error => {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exitCode = EXIT.FAILURE;
    }
  );
}

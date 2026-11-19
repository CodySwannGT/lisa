#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-estimate.mjs
 * @description Render and check a work item's token estimate
 * (CodySwannGT/lisa#4952, #4954).
 *
 * A plain Node script, so it runs the same under every coding agent Lisa
 * supports. It never talks to a tracker: the caller reads the item body,
 * passes it in, and writes back what this prints.
 *
 * Usage:
 *   node scripts/lisa-estimate.mjs config
 *   node scripts/lisa-estimate.mjs render --tokens-low 2M --tokens-high 4M
 *     --model claude-opus-5-5 [--basis <text>] [--body-file <path>]
 *   node scripts/lisa-estimate.mjs calibrate --tokens-low 1M --tokens-high 2M
 *     --history-file <comparable-items.json>
 *   node scripts/lisa-estimate.mjs tally [--body-file <path>] [--usage-file <path>]...
 *   node scripts/lisa-estimate.mjs check [--phase ready|claim|done]
 *     [--body-file <path>] [--usage-file <path>]...
 *
 * `calibrate` scales a first estimate by how comparable finished items
 * actually ran (their `## Lisa Usage` totals against their estimates) and
 * prints the calibrated range and a basis line to pass to `render`.
 *
 * `tally` rewrites the estimate section with the actual tokens and cost from
 * the item's `## Lisa Usage` ledgers and prints the whole body. Pass every
 * comment that holds a ledger with its own `--usage-file`, as many times as
 * needed, to both `tally` and `check --phase done`.
 *
 * `check` exits 0 on PASS or N/A and 1 on FAIL; any usage or config error
 * exits 2. Without `--body-file`, the body is read from standard input.
 * @module lisa-estimate
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  DEFAULT_ESTIMATE_PRICING,
  EstimateConfigError,
  resolveEstimateConfig,
  resolveEstimateGate,
} from "./lib/work-item-estimate-config.mjs";
import {
  buildEstimate,
  parseTokenCount,
  renderEstimateSection,
  upsertEstimateSection,
} from "./lib/work-item-estimate.mjs";
import {
  calibrateEstimate,
  historyBodies,
} from "./lib/work-item-estimate-calibration.mjs";
import { checkEstimate } from "./lib/work-item-estimate-check.mjs";
import { tallyEstimate } from "./lib/work-item-estimate-tally.mjs";

const VALUE_FLAGS = new Set([
  "--tokens-low",
  "--tokens-high",
  "--model",
  "--basis",
  "--body-file",
  "--phase",
  "--history-file",
  "--usage-file",
  "--cwd",
]);

// Every comment that holds a usage ledger is passed with its own --usage-file.
const REPEATABLE_FLAGS = new Set(["usage-file"]);

/**
 * Parse `--flag value` pairs. A repeatable flag's value is the list of every
 * value it was given, in order.
 * @param {string[]} args - Arguments after the subcommand.
 * @returns {Record<string, string | string[]>} Flag values keyed without the dashes.
 */
function parseFlags(args) {
  if (
    args.length % 2 !== 0 ||
    args.some((arg, i) => i % 2 === 0 && !VALUE_FLAGS.has(arg))
  )
    throw new EstimateConfigError(
      `Unrecognised arguments ${JSON.stringify(args)}. Run with --help for the options.`
    );
  const pairs = args.flatMap((arg, i) =>
    i % 2 === 0 ? [[arg.slice(2), args[i + 1]]] : []
  );
  const repeated = pairs
    .map(([name]) => name)
    .filter(
      (name, i, names) =>
        !REPEATABLE_FLAGS.has(name) && names.indexOf(name) !== i
    );
  if (repeated.length)
    throw new EstimateConfigError(
      `--${repeated[0]} was given more than once; only --usage-file may repeat.`
    );
  return Object.fromEntries(
    pairs.map(([name, value]) => [
      name,
      REPEATABLE_FLAGS.has(name)
        ? pairs.filter(([other]) => other === name).map(([, each]) => each)
        : value,
    ])
  );
}

const readJson = path =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};

/**
 * The project's Lisa config with `.lisa.config.local.json` layered on top,
 * key by key.
 * @param {string} cwd - Project root.
 * @returns {object} Effective config.
 */
export function readProjectConfig(cwd) {
  const merge = (base, override) => {
    const plain = value =>
      value !== null && typeof value === "object" && !Array.isArray(value);
    if (!plain(base) || !plain(override)) return override ?? base;
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    return Object.fromEntries(
      [...keys].map(key => [
        key,
        key in override ? merge(base[key], override[key]) : base[key],
      ])
    );
  };
  return merge(
    readJson(join(cwd, ".lisa.config.json")),
    readJson(join(cwd, ".lisa.config.local.json"))
  );
}

const readBody = flags =>
  flags["body-file"] === undefined
    ? readFileSync(0, "utf8")
    : readFileSync(flags["body-file"], "utf8");

const ledgerDocuments = (body, flags) => [
  body,
  ...(flags["usage-file"] ?? []).map(file => readFileSync(file, "utf8")),
];

const COMMANDS = {
  config: (_flags, settings) => ({
    out: `${JSON.stringify({ ...settings, defaultPricing: DEFAULT_ESTIMATE_PRICING }, null, 2)}\n`,
    code: 0,
  }),
  render: (flags, settings) => {
    const section = renderEstimateSection(
      buildEstimate(
        {
          tokensLow: parseTokenCount(flags["tokens-low"] ?? ""),
          tokensHigh: parseTokenCount(flags["tokens-high"] ?? ""),
          model: flags.model ?? "",
          basis: flags.basis,
        },
        settings
      )
    );
    return {
      out:
        flags["body-file"] === undefined
          ? section
          : upsertEstimateSection(readBody(flags), section),
      code: 0,
    };
  },
  calibrate: flags => {
    if (flags["history-file"] === undefined)
      throw new EstimateConfigError(
        "calibrate needs --history-file: a JSON array of comparable finished items (gh issue list --json body prints one)."
      );
    const result = calibrateEstimate(
      {
        tokensLow: parseTokenCount(flags["tokens-low"] ?? ""),
        tokensHigh: parseTokenCount(flags["tokens-high"] ?? ""),
      },
      historyBodies(JSON.parse(readFileSync(flags["history-file"], "utf8")))
    );
    return { out: `${JSON.stringify(result, null, 2)}\n`, code: 0 };
  },
  tally: flags => {
    const body = readBody(flags);
    return { out: tallyEstimate(body, ledgerDocuments(body, flags)), code: 0 };
  },
  check: (flags, settings) => {
    const body = readBody(flags);
    const result = checkEstimate(
      body,
      settings,
      flags.phase,
      ledgerDocuments(body, flags)
    );
    const lines = [`S21 token estimate: ${result.verdict}`, ...result.lines];
    return {
      out: `${lines.join("\n")}\n`,
      code: result.verdict === "FAIL" ? 1 : 0,
    };
  },
};

const USAGE =
  "Usage: lisa-estimate.mjs config | render --tokens-low <n> --tokens-high <n> --model <id> [--basis <text>] [--body-file <path>] | calibrate --tokens-low <n> --tokens-high <n> --history-file <path> | tally [--body-file <path>] [--usage-file <path>]... | check [--phase ready|claim|done] [--body-file <path>] [--usage-file <path>]...\n";

/**
 * Run the CLI.
 * @param {string[]} argv - Arguments after the script name.
 * @param {{stdout: {write: Function}, stderr: {write: Function}}} io - Output streams.
 * @returns {number} Exit code.
 */
export function runCli(argv = process.argv.slice(2), io = process) {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "help") {
    io.stdout.write(USAGE);
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, command ?? "")) {
    io.stderr.write(USAGE);
    return 2;
  }
  try {
    const flags = parseFlags(rest);
    const config = readProjectConfig(flags.cwd ?? process.cwd());
    // `check` honours a disabled gate before it reads the rest of the
    // settings, so it reports N/A instead of failing on settings it ignores.
    const settings =
      command === "check"
        ? resolveEstimateGate(config)
        : resolveEstimateConfig(config);
    const { out, code } = COMMANDS[command](flags, settings);
    io.stdout.write(out);
    return code;
  } catch (error) {
    if (
      !(
        error instanceof EstimateConfigError ||
        error instanceof RangeError ||
        error instanceof SyntaxError ||
        error?.code === "ENOENT"
      )
    )
      throw error;
    io.stderr.write(`lisa-estimate: ${error.message}\n`);
    return 2;
  }
}

if (invokedAsScript(import.meta.url)) process.exitCode = runCli();

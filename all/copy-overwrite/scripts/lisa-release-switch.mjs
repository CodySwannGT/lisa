#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-release-switch.mjs
 * @description The always-promotable checks every agent runs
 * (CodySwannGT/lisa#5188).
 *
 * A plain Node script, so it behaves the same under every coding agent Lisa
 * supports. It never talks to a tracker or to a flag service: the caller reads
 * the item body, passes it in, and writes back what this prints.
 *
 * Usage:
 *   node scripts/lisa-release-switch.mjs config
 *   node scripts/lisa-release-switch.mjs check [--existing true] [--body-file <path>]
 *   node scripts/lisa-release-switch.mjs render --mode live|off
 *     [--switch <name>] [--removed-by "this item"|<ref>] [--body-file <path>]
 *   node scripts/lisa-release-switch.mjs references --switch <name> [--revision <rev>]
 *   node scripts/lisa-release-switch.mjs notice --base <branch>
 *
 * `config` prints the resolved `release.*` setting, including any invalid value
 * by name. `check` is readiness gate S22: exit 0 on PASS or N/A, 1 on FAIL.
 * `render` prints the `## Release Switch` section, or the whole body with the
 * section in place when `--body-file` is given. `references` lists tracked
 * files that still mention a switch and exits 1 when any do. `notice` prints
 * the no-live-users notice for a production deployment and ALWAYS exits 0: it
 * exists to keep the opt-out visible, never to block a deployment. Any usage
 * or read error on the other commands exits 2. Without `--body-file`, the body
 * is read from standard input.
 * @module lisa-release-switch
 */
import { readFileSync } from "node:fs";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { CompletionProofError } from "./lib/completion-proof-errors.mjs";
import {
  ReleaseSwitchError,
  checkDeclaration,
  productionBranch,
  productionNotice,
  readProjectConfig,
  renderDeclaration,
  resolveReleaseSetting,
  switchReferences,
  turnOnOwner,
  turnOnProblems,
  upsertDeclaration,
} from "./lib/release-switch.mjs";

const VALUE_FLAGS = new Set([
  "--existing",
  "--body-file",
  "--mode",
  "--switch",
  "--removed-by",
  "--revision",
  "--base",
  "--cwd",
]);

/**
 * Parse `--flag value` pairs.
 * @param {string[]} args - Arguments after the subcommand.
 * @returns {Record<string, string>} Flag values keyed without the dashes.
 */
function parseFlags(args) {
  if (
    args.length % 2 !== 0 ||
    args.some((arg, i) => i % 2 === 0 && !VALUE_FLAGS.has(arg))
  )
    throw new ReleaseSwitchError(
      `Unrecognised arguments ${JSON.stringify(args)}. Run with --help for the options.`
    );
  return Object.fromEntries(
    args.flatMap((arg, i) => (i % 2 === 0 ? [[arg.slice(2), args[i + 1]]] : []))
  );
}

const readBody = flags =>
  flags["body-file"] === undefined
    ? readFileSync(0, "utf8")
    : readFileSync(flags["body-file"], "utf8");

const COMMANDS = {
  config: (_flags, config) => {
    const setting = resolveReleaseSetting(config);
    return {
      out: `${JSON.stringify(
        {
          ...setting,
          problems: [...setting.problems, ...turnOnProblems(config)],
          productionBranch: productionBranch(config),
          // Who turns a finished feature on in production: the agent, unless
          // the project reserved that decision for a person.
          turnOn: turnOnOwner(config),
        },
        null,
        2
      )}\n`,
      code: 0,
    };
  },
  check: (flags, config) => {
    const result = checkDeclaration(
      readBody(flags),
      resolveReleaseSetting(config),
      { existing: flags.existing === "true" }
    );
    return {
      out: `${[`S22 release switch: ${result.verdict}`, ...result.lines].join("\n")}\n`,
      code: result.verdict === "FAIL" ? 1 : 0,
    };
  },
  render: flags => {
    const section = renderDeclaration({
      mode: flags.mode,
      switchName: flags.switch,
      ...(flags["removed-by"] === undefined
        ? {}
        : { removedBy: flags["removed-by"] }),
    });
    return {
      out:
        flags["body-file"] === undefined
          ? section
          : upsertDeclaration(readBody(flags), section),
      code: 0,
    };
  },
  references: (flags, _config, cwd) => {
    const files = switchReferences(flags.switch ?? "", {
      cwd,
      revision: flags.revision,
    });
    return {
      out: files.length
        ? `Switch ${JSON.stringify(flags.switch)} is still referenced in ${files.length} tracked file(s):\n${files.map(file => `  ${file}`).join("\n")}\n`
        : `Switch ${JSON.stringify(flags.switch)} is not referenced in tracked source.\n`,
      code: files.length ? 1 : 0,
    };
  },
  notice: (flags, config) => {
    const notice = productionNotice(config, flags.base ?? "");
    return { out: notice === null ? "" : `${notice}\n`, code: 0 };
  },
};

const USAGE =
  'Usage: lisa-release-switch.mjs config | check [--existing true] [--body-file <path>] | render --mode live|off [--switch <name>] [--removed-by "this item"|<ref>] [--body-file <path>] | references --switch <name> [--revision <rev>] | notice --base <branch>\n';

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
    const cwd = flags.cwd ?? process.cwd();
    const { out, code } = COMMANDS[command](flags, readProjectConfig(cwd), cwd);
    io.stdout.write(out);
    return code;
  } catch (error) {
    // The notice must never turn a deployment report into a failure, whatever
    // goes wrong. For every other command, a file that cannot be read (missing,
    // a directory, no permission) is a usage error like any other: exit 2, and
    // never the exit 1 that means "the gate failed".
    if (
      command !== "notice" &&
      !(
        error instanceof ReleaseSwitchError ||
        error instanceof CompletionProofError ||
        error instanceof SyntaxError ||
        typeof error?.code === "string"
      )
    )
      throw error;
    io.stderr.write(
      `lisa-release-switch: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return command === "notice" ? 0 : 2;
  }
}

if (invokedAsScript(import.meta.url)) process.exitCode = runCli();

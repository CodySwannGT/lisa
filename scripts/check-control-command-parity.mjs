#!/usr/bin/env node
/**
 * check-control-command-parity — fail unless the four control commands
 * (audit, configure, enforce, attest) are in place on all seven coding agents
 * (CodySwannGT/lisa#5002).
 *
 * `bun run check:plugins` runs this at its end, after it has proved the built
 * plugins reproduce from their source. The rules, and why reproduction alone
 * cannot answer this question, are in `scripts/lib/control-command-parity.mjs`.
 *
 * Usage:
 *
 *   node scripts/check-control-command-parity.mjs [--root <dir>] [--json]
 *
 * `--root` checks another tree: a copy with one skill removed is how the
 * failure is shown without touching the working tree.
 *
 * Exit status:
 *
 *   0  all four commands are in place on all seven agents. The listing of
 *      every agent and its four commands is printed on standard output.
 *   1  something is missing or undocumented. Each line on standard error
 *      names the agent and the skill.
 *   2  the check could not be carried out: an option it does not know, a
 *      record it cannot read, or a record that lists no agent. It never
 *      reports a pass for an inspection it did not perform.
 * @module scripts/check-control-command-parity
 */
import path from "node:path";

import {
  auditControlCommandParity,
  exitStatusOf,
  formatControlCommandParity,
  REPO_ROOT,
} from "./lib/control-command-parity.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** The name this program gives itself in a message. */
const PROGRAM = "check-control-command-parity";

/**
 * Read the command line.
 * @param {string[]} args The arguments after the program's own name.
 * @returns {{ root: string, json: boolean, problem: string | null }} The
 *   tree to check, whether to print JSON, and what was wrong with the
 *   arguments when something was.
 */
export function parseArguments(args) {
  const options = { root: REPO_ROOT, json: false };
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] ?? "";
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root") {
      const value = args[at + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ...options, problem: "--root needs a folder." };
      }
      options.root = path.resolve(value);
      at += 1;
    } else if (arg.startsWith("--root=")) {
      options.root = path.resolve(arg.slice("--root=".length));
    } else {
      return { ...options, problem: `unknown option ${arg}.` };
    }
  }
  return { ...options, problem: null };
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const { root, json, problem } = parseArguments(process.argv.slice(2));
  if (problem !== null) {
    console.error(`${PROGRAM}: ${problem}`);
    process.exitCode = 2;
    return;
  }
  const result = auditControlCommandParity({ root });
  const status = exitStatusOf(result);
  const report = json
    ? JSON.stringify(result, null, 2)
    : formatControlCommandParity(result);
  if (status === 0 || json) console.log(report);
  else console.error(report);
  process.exitCode = status;
}

if (invokedAsScript(import.meta.url)) {
  main();
}

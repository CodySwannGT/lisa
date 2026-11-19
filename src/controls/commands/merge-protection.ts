/**
 * `lisa controls merge-protection [path]`: read the hosting platform's merge
 * protection for the repository's default branch, and print what was read
 * together with the probe entry that records the attempt.
 *
 * The audit runs it once. Whether required checks can be skipped is a setting
 * the hosting platform holds, so the audit asks the platform, and writes down
 * exactly what happened: the platform answered (with the request that was
 * made), it would not answer (with the error as received and the access that
 * is missing), or it was never asked (with the reason).
 *
 * ## What it may send, and what it writes
 *
 * Reads only, and only to github.com. It takes no option that could change
 * that. It writes nothing: not into the repository, and not anywhere else.
 * The document goes to stdout and one line for a person goes to stderr.
 *
 * ## Exit codes
 *
 * - 0: a document was printed. That includes a platform that refused the read
 *   and one that was never asked: for an audit, "could not be read" is a
 *   result to record, not a failure of the command.
 * - 1: no document could be produced; nothing is printed on stdout.
 * @module controls/commands/merge-protection
 */
import path from "node:path";

import type { Command } from "commander";

import type { AuditProbe } from "../audit-probe-types.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
import {
  readMergeProtection,
  type MergeProtectionRead,
} from "../merge-protection-read.js";
import { platformLabel } from "../protect-platform.js";

/** The subcommand's name under `lisa controls`. */
export const MERGE_PROTECTION_COMMAND = "merge-protection";

/** What `--help` says after the options. */
export const MERGE_PROTECTION_HELP_AFTER = `
Reads only. It sends no request that changes anything, takes no option that
could, and writes no file. On a hosting platform other than github.com it
sends nothing at all.

Prints one JSON document on stdout. Its "probe" is the entry to copy into the
audit report's "probes": reachable (with the request that was made),
unreachable (with the error as received and the access that is missing), or
not-attempted (with the reason). "probe" is null when nothing says where the
repository is hosted. Exit codes:
  0  a document was printed, whether or not the platform could be read
  1  no document could be produced`;

/** What the command needs from outside, each replaceable in a test. */
export interface MergeProtectionCommandIo {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the line for a person and any problems go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Reads the platform. */
  readonly read?: (root: string) => Promise<MergeProtectionRead>;
}

/**
 * Put free text on one line.
 * @param text - Text of any shape
 * @returns The text with every run of white space as one space
 */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * End text the way a sentence ends.
 * @param text - Text of any shape
 * @returns The text on one line, closed with a full stop when it has none
 */
function sentence(text: string): string {
  const line = oneLine(text);
  return /[.!?]$/u.test(line) ? line : `${line}.`;
}

/**
 * Say what a probe that got no answer means, the way an operator is told.
 * @param probe - A probe whose result is not `reachable`
 * @returns The sentences
 */
function unreadLine(probe: AuditProbe): string {
  const needs = `To check this requirement an agent needs ${oneLine(probe.access_needed ?? "")}.`;
  return probe.result === "not-attempted"
    ? `NOT TRIED. Lisa did not try to reach ${probe.system}: ${sentence(probe.reason ?? "")} ${needs}`
    : `NOT REACHED. Lisa could not reach ${probe.system}: ${sentence(probe.observed_error ?? "")} ${needs}`;
}

/**
 * Say in one line what a read concluded.
 * @param read - The document
 * @returns The line for a person
 */
function summaryLine(read: MergeProtectionRead): string {
  if (read.probe === null) {
    return `NO PLATFORM. ${sentence(read.platform.note ?? "Nothing says where this repository is hosted")} There is no outside system to read.`;
  }
  if (read.merge_protection === null) return unreadLine(read.probe);
  const count = read.merge_protection.required_checks.length;
  const checks =
    count === 0 ? "no check" : `${count} ${count === 1 ? "check" : "checks"}`;
  return `READ. ${platformLabel(read.platform.name)} requires ${checks} before a change is merged into ${read.branch ?? "the default branch"}.`;
}

/**
 * Read one repository's merge protection and print the document.
 * @param targetPath - The repository; the working directory when left out
 * @param io - Replaceable collaborators
 * @returns The exit code: 0 when a document was printed, 1 when none could be
 */
export async function runMergeProtection(
  targetPath: string | undefined,
  io: MergeProtectionCommandIo = {}
): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problem: string): number => {
    stderr(oneLine(problem));
    stderr(
      "merge-protection: FAIL. Nothing was read, and nothing was sent to the hosting platform or written"
    );
    return 1;
  };

  const named = path.resolve(io.cwd ?? process.cwd(), targetPath ?? ".");
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail(
      `${targetPath ?? named} is not a folder. Give the path of the repository to read.`
    );
  }
  try {
    const read = await (io.read ?? readMergeProtection)(root);
    stdout(JSON.stringify(read, null, 2));
    stderr(`merge-protection: ${summaryLine(read)}`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** The collaborator the registration needs, replaceable in a test. */
export interface MergeProtectionCommandDependencies {
  readonly runMergeProtection: (
    targetPath: string | undefined
  ) => Promise<number>;
}

/**
 * Register `merge-protection` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerMergeProtection(
  group: Command,
  dependencies: MergeProtectionCommandDependencies = {
    runMergeProtection: targetPath => runMergeProtection(targetPath),
  }
): void {
  group
    .command(MERGE_PROTECTION_COMMAND)
    .description(
      "Read the hosting platform's merge protection for the default branch and print it with the probe entry for the audit report; reads only and writes nothing"
    )
    .argument("[path]", "Project path (default: current directory)")
    .addHelpText("after", MERGE_PROTECTION_HELP_AFTER)
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runMergeProtection(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}

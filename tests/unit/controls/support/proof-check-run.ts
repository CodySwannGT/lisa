/**
 * Running `lisa controls proof-check` in-process against fixture
 * repositories (CodySwannGT/lisa#5011).
 *
 * The suites about the command all need the same things: a fixture with a
 * check declared and its patch files committed, a run of the command with
 * what it printed, and the document it printed as data. They are written
 * once here.
 * @module tests/unit/controls/support/proof-check-run
 */
import {
  runProofCheck,
  type ProofCheckDependencies,
  type ProofCheckOptions,
} from "../../../../src/controls/commands/proof-check.js";
import type {
  ProofCheckPart,
  ProofCheckRun,
} from "../../../../src/controls/proof-check-types.js";
import type { ControlAuditFixtureName } from "../../../helpers/control-audit-fixtures.js";
import {
  buildProofFixture,
  type ProofFiles,
} from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { steppingClock } from "./proof-run.js";
import { keep, type Run } from "./report-check-run.js";

/** What one run printed, and the document it printed when it printed one. */
export interface ProofCheckRunResult extends Run {
  /** The JSON document on stdout, or `null` when there is none. */
  readonly result: ProofCheckRun | null;
}

/**
 * Build a fixture with the given checks declared and committed, and remember
 * it for removal.
 * @param gates - The gates block
 * @param files - The proof files; a working pair for F-none by default
 * @param name - Which fixture; F-none by default
 * @returns The repository's path
 */
export function declared(
  gates: GatesBlock,
  files?: ProofFiles,
  name?: ControlAuditFixtureName
): string {
  return keep(buildProofFixture(gates, files, name)).repoPath;
}

/**
 * Run the command in-process and capture what it prints.
 * @param target - The repository
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators
 * @returns Exit code, printed lines, and the document as data
 */
export async function proofCheck(
  target: string | undefined,
  options: ProofCheckOptions = {},
  dependencies: ProofCheckDependencies = {}
): Promise<ProofCheckRunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runProofCheck(target, options, {
    clock: steppingClock(),
    stdout: text => {
      stdout.push(text);
    },
    stderr: line => {
      stderr.push(line);
    },
    ...dependencies,
  });
  const [document] = stdout;
  return {
    code,
    stdout,
    stderr,
    result:
      document === undefined ? null : (JSON.parse(document) as ProofCheckRun),
  };
}

/**
 * The only part of a result.
 * @param run - What the command printed
 * @returns The part
 * @throws {Error} When there is not exactly one, so a case can never pass on
 *   a part it did not mean
 */
export function onlyPart(run: ProofCheckRunResult): ProofCheckPart {
  const parts = run.result?.parts ?? [];
  const [part] = parts;
  if (parts.length !== 1 || part === undefined) {
    throw new Error(
      `Expected one part, found ${String(parts.length)}. stderr: ${run.stderr.join(" | ")}`
    );
  }
  return part;
}

/**
 * Check F-none with one check declared, and give back its one part.
 * @param gates - The gates block
 * @param files - The proof files; a working pair by default
 * @returns The run and its only part
 */
export async function checkedPart(
  gates: GatesBlock,
  files?: ProofFiles
): Promise<{
  readonly run: ProofCheckRunResult;
  readonly part: ProofCheckPart;
}> {
  const run = await proofCheck(declared(gates, files));
  return { run, part: onlyPart(run) };
}

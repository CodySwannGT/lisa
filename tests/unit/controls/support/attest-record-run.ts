/**
 * Writing down an attest run in-process against fixture repositories, and
 * checking the verdict it left, for the suites that hold the evidence, the
 * register and the verdict to each other (CodySwannGT/lisa#4998).
 * @module tests/unit/controls/support/attest-record-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runAttestCheck } from "../../../../src/controls/attest-check.js";
import {
  recordAttestation,
  type AttestationToRecord,
  type RecordAttestationDependencies,
  type RecordedAttestation,
} from "../../../../src/controls/attest-record.js";
import { EVIDENCE_PATH } from "../../../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../../../src/controls/register-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../../../src/controls/verdict-types.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { prove, setting, type ProofSetting } from "./proof-run.js";
import type { Run } from "./report-check-run.js";

/** A minute after the stepping clock's first reading: every proof is done. */
export const RECORDED_NOW = new Date("2026-01-01T00:01:00.000Z");

/** The three files the attest step writes, in the order it writes them. */
export const WRITTEN_FILES = [
  EVIDENCE_PATH,
  CONTROL_REGISTER_PATH,
  VERDICT_PATH,
] as const;

/**
 * Run the proofs of a setting and write down what they found.
 * @param where - The repository and its disposable copy
 * @param attestation - What differs from a plain run at {@link RECORDED_NOW}
 * @param dependencies - Replaceable collaborators
 * @returns What was written, or why it was not
 */
export async function record(
  where: ProofSetting,
  attestation: Partial<AttestationToRecord> = {},
  dependencies: RecordAttestationDependencies = {}
): Promise<RecordedAttestation> {
  return recordAttestation(
    {
      named: where.repoPath,
      run: await prove(where),
      now: RECORDED_NOW,
      ...attestation,
    },
    dependencies
  );
}

/**
 * Build a repository, run its proofs and write down what they found.
 * @param gates - Its gates block
 * @returns The repository and its copy
 */
export async function attested(gates: GatesBlock): Promise<ProofSetting> {
  const where = setting(gates);
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  return where;
}

/**
 * Read one of a repository's files as text.
 * @param repoPath - The repository
 * @param file - The file, from the repository root
 * @returns Its content
 */
export function textOf(repoPath: string, file: string): string {
  return readFileSync(path.join(repoPath, file), "utf8");
}

/**
 * Read one of a repository's JSON files.
 * @param repoPath - The repository
 * @param file - The file, from the repository root
 * @returns The parsed file
 */
export function jsonOf<Shape>(repoPath: string, file: string): Shape {
  return JSON.parse(textOf(repoPath, file)) as Shape;
}

/**
 * The evidence file a repository holds.
 * @param repoPath - The repository
 * @returns The file
 */
export function evidenceIn(repoPath: string): EvidenceDocument {
  return jsonOf<EvidenceDocument>(repoPath, EVIDENCE_PATH);
}

/**
 * The verdict a repository holds.
 * @param repoPath - The repository
 * @returns The verdict
 */
export function verdictIn(repoPath: string): Verdict {
  return jsonOf<Verdict>(repoPath, VERDICT_PATH);
}

/**
 * Change one of a repository's JSON files by hand, the way someone editing
 * it would.
 * @param repoPath - The repository
 * @param file - The file, from the repository root
 * @param change - Returns the file's new content from its current one
 */
export function editJson<Shape>(
  repoPath: string,
  file: string,
  change: (current: Shape) => unknown
): void {
  writeFileSync(
    path.join(repoPath, file),
    `${JSON.stringify(change(jsonOf<Shape>(repoPath, file)), null, 2)}\n`
  );
}

/**
 * Run `lisa controls attest --check` in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @param now - The current time
 * @returns Exit code and printed lines
 */
export async function checkVerdict(
  target: string,
  now: Date = RECORDED_NOW
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttestCheck(target, {
    clock: () => now,
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}

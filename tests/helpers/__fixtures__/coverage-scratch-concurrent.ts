/**
 * One of two real processes competing over a coverage scratch directory.
 *
 * Reproduces the coverage provider's initialisation exactly — `rm` the reports
 * directory, `rm` the scratch directory, `mkdir` it back — around a scratch
 * file the process then reads back. Interleaving the two roles is what turns
 * that into the collision CodySwannGT/lisa#3911 measured.
 *
 * The directory under test comes from the SHIPPED factory, never from a
 * constant here. When the factory declares none, this falls back to vitest's
 * own `coverageConfigDefaults.reportsDirectory`, which is precisely what
 * vitest does with an undeclared value — so running this against a build that
 * has not been fixed exercises the real pre-fix path rather than a
 * reconstruction of it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { coverageConfigDefaults } from "vitest/config";

import { getTypescriptVitestConfig } from "../../../src/configs/vitest/typescript.js";

const root = process.env["LISA_COVERAGE_RACE_ROOT"];
const role = process.env["LISA_COVERAGE_RACE_ROLE"];
const peerSignal = process.env["LISA_COVERAGE_RACE_PEER_SIGNAL"];
const ownSignal = process.env["LISA_COVERAGE_RACE_OWN_SIGNAL"];

if (
  root === undefined ||
  ownSignal === undefined ||
  peerSignal === undefined ||
  (role !== "first" && role !== "second")
) {
  throw new Error(
    "Coverage race fixture requires root, role, own signal and peer signal"
  );
}

/** Barrier deadline. Generous: only a hung peer can reach it. */
const DEADLINE_MS = 60_000;

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * Blocks until a peer's signal file appears.
 * @param signal - Path the peer touches
 */
function awaitSignal(signal: string): void {
  const deadline = Date.now() + DEADLINE_MS;
  while (!fs.existsSync(signal)) {
    if (Date.now() >= deadline) throw new Error(`Peer never signalled ${role}`);
    Atomics.wait(sleeper, 0, 0, 5);
  }
}

const declared = getTypescriptVitestConfig().test?.coverage as
  | { readonly reportsDirectory?: string }
  | undefined;

// Exactly how vitest resolves the option: the declared value when there is
// one, its own default when there is not, then resolved against the project
// root. See BaseCoverageProvider._initialize.
const reportsDirectory = path.resolve(
  root,
  declared?.reportsDirectory ?? coverageConfigDefaults.reportsDirectory
);
const scratchDirectory = path.join(reportsDirectory, ".tmp");

/**
 * How many scratch files this role writes.
 *
 * The provider writes one per test file, so a run's set is as large as its
 * suite. The two roles are given different sizes because the interfering run
 * in the measured collision had written only part of its own set when the
 * first run tried to merge — which is what turns the shared path into the bare
 * `ENOENT … open '…/coverage/.tmp/coverage-1.json'` the ticket quotes, rather
 * than into a silent read of somebody else's measurements.
 */
const SCRATCH_FILES = role === "first" ? 3 : 1;

/**
 * Path of one of this role's scratch files.
 * @param index - Position in this run's own set
 * @returns Absolute path, named exactly as the provider names it
 */
function scratchFileAt(index: number): string {
  return path.join(scratchDirectory, `coverage-${String(index)}.json`);
}

/** The provider's initialisation, verbatim in effect. */
function initialise(): void {
  fs.rmSync(reportsDirectory, { force: true, recursive: true });
  fs.rmSync(scratchDirectory, { force: true, recursive: true });
  fs.mkdirSync(scratchDirectory, { recursive: true });
}

if (role === "second") awaitSignal(peerSignal);

initialise();
for (let index = 0; index < SCRATCH_FILES; index += 1) {
  fs.writeFileSync(scratchFileAt(index), JSON.stringify({ role }), "utf8");
}
fs.writeFileSync(ownSignal, role, "utf8");

if (role === "first") awaitSignal(peerSignal);

// The merge step: the run reads back the scratch IT wrote, by the filenames it
// recorded during the run. Two ways that fails once a sibling has cleaned the
// same directory — the file is gone, or the file at that name now holds the
// sibling's measurements — and both are failures to measure this run's own
// coverage, so both are reported the same way here.
let survived = true;
let error: string | null = null;
try {
  // Highest index first, so the reported cause is the bare ENOENT the ticket
  // quotes rather than the identity check that a lower index would trip on
  // first. Both are checked; only the order of discovery is chosen.
  for (let index = SCRATCH_FILES - 1; index >= 0; index -= 1) {
    const parsed = JSON.parse(
      fs.readFileSync(scratchFileAt(index), "utf8")
    ) as { readonly role?: string };
    if (parsed.role !== role) {
      throw new Error(
        `coverage-${String(index)}.json holds ${String(parsed.role)} measurements`
      );
    }
  }
} catch (cause) {
  survived = false;
  error = (cause as NodeJS.ErrnoException).code ?? (cause as Error).message;
}

process.stdout.write(
  `${JSON.stringify({ error, reportsDirectory, role, survived })}\n`
);

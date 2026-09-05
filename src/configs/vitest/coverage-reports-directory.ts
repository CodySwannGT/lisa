/**
 * Per-run isolation of the Vitest coverage reports directory.
 *
 * ## The defect this exists to prevent
 *
 * Vitest derives the coverage provider's scratch directory from
 * `coverage.reportsDirectory` and offers no separate knob for it:
 *
 * ```js
 * this.coverageFilesDirectory = resolve(this.options.reportsDirectory, ".tmp");
 * ```
 *
 * and its initialisation then removes BOTH, recursively, before a single test
 * file is globbed:
 *
 * ```js
 * if (clean && existsSync(this.options.reportsDirectory)) await rm(...)
 * if (existsSync(this.coverageFilesDirectory)) await rm(...)
 * ```
 *
 * Read against a fixed default of `coverage/`, that is a shared mutable path:
 * a second run starting in the same checkout deletes the first run's live
 * scratch, and the first run reaches the end of its coverage phase with nothing
 * to merge. Measured twice in one evening on one machine
 * (CodySwannGT/lisa#3911), and the cost lands late — the coverage phase is the
 * expensive stretch of the push gate, so the collision is discovered only after
 * roughly 24 minutes have already been spent.
 *
 * ## Isolation, not coordination
 *
 * Each run gets a reports directory nothing else knows about, named from the
 * run's OWN identity rather than from the repository path. Two runs in one
 * checkout then cannot see each other's scratch, so vitest's unconditional
 * `rm` reaches only paths its own process created.
 *
 * This deliberately introduces no lock, no lease, no liveness probe and no
 * pre-run sweep:
 *
 * - a **lock or lease** serialises runs that have no reason to be serialised,
 *   and needs a liveness rule to release one held by a dead process — the same
 *   ownership adjudication that makes shared scratch hard in the first place;
 * - a **sweep of the shared directory** is the failure rather than the fix:
 *   cleaning a directory two runs share is precisely what deletes the other
 *   run's files.
 *
 * The naming scheme is the one the scratch namespace already proved for the
 * same class of collision — `run-<pid>-<startedAt>-<suffix>`, reused here via
 * {@link runRootName} rather than re-spelled, so the two cannot drift apart.
 *
 * ## What this does not change
 *
 * The gate's ability to say UNPROVABLE rather than FAILED when a run produced
 * no coverage number survives untouched, because the classifier that draws
 * that distinction is keyed on the scratch FILENAME (`coverage-<n>.json`) and
 * explicitly not on the directory — see `COVERAGE_SCRATCH_ENOENT` in
 * `all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs`. Moving the
 * directory is the one change this file makes, and it is the one input that
 * classifier does not read.
 * @module configs/vitest/coverage-reports-directory
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { env, pid } from "node:process";

import {
  parseRunRootName,
  runRootName,
} from "./scratch-namespace-authority.js";
import { isProcessAlive } from "./scratch-sweep.js";

/**
 * Directory under `coverage/` holding one run's isolated output.
 *
 * Nested under `coverage/` rather than placed beside it so the single
 * `coverage/` entry every shipped `.gitignore` already carries keeps covering
 * it, and so the coverage artifacts of a checkout stay in one findable place.
 */
export const COVERAGE_RUNS_DIR = ".runs";

/**
 * Environment variable pinning the reports directory to a caller-chosen path.
 *
 * For the environment where isolation is not needed and a STABLE path is —
 * a CI job that runs one suite and then uploads `coverage/lcov.info`. Such a
 * job is the single writer of its own workspace, so the collision this module
 * prevents cannot arise there, and the caller pinning the path is the caller
 * taking responsibility for that.
 *
 * Honoured verbatim. Vitest resolves a relative value against the project root
 * exactly as it resolves its own default, so both forms work.
 */
export const COVERAGE_REPORTS_DIR_ENV = "LISA_COVERAGE_REPORTS_DIR";

/** Bytes of randomness disambiguating two runs started in the same millisecond. */
const SUFFIX_BYTES = 4;

/** The stable directory a checkout's coverage artifacts are read from. */
const COVERAGE_BASE = "coverage";

/**
 * The provider's own scratch subdirectory, named so it is never published.
 *
 * `cleanAfterRun` removes it before the process exits, so in practice it is
 * already gone by the time anything publishes. Skipping it explicitly means a
 * run killed between report generation and exit cannot copy a half-written
 * `coverage-<n>.json` up to the stable path, where another run would read it.
 */
const COVERAGE_SCRATCH_DIR = ".tmp";

/**
 * Builds the relative reports directory for one run.
 *
 * Separated from {@link coverageReportsDirectory} so tests can state the
 * identity rather than mine it out of a memoized process-wide value.
 * @param owner - Process id owning the run
 * @param startedAt - Epoch milliseconds the directory was named
 * @param suffix - Opaque random suffix, free of `-`
 * @returns Root-relative path, POSIX-separated as Vitest's own default is.
 */
export function coverageRunDirectory(
  owner: number,
  startedAt: number,
  suffix: string
): string {
  return `coverage/${COVERAGE_RUNS_DIR}/${runRootName(owner, startedAt, suffix)}`;
}

/**
 * Publish one finished run's artifacts to the stable directory, then drop it.
 *
 * ## Why isolation alone is not enough
 *
 * `reportsDirectory` is the only lever the provider offers, so isolating the
 * scratch necessarily moves the REPORTS with it. An unpinned run therefore
 * writes `coverage/.runs/<run>/lcov.info` and never writes `coverage/lcov.info`
 * again.
 *
 * A project upgrading to that behaviour does not get a missing-file error. Its
 * Sonar keeps reading **the file left there before the upgrade**, indefinitely,
 * and reports a coverage number that has quietly stopped moving — a wrong value
 * that looks like a real one, which is the same failure isolation removed from
 * concurrent runs, relocated one layer out to consumers.
 *
 * ## Why this is safe where a mid-run shared directory is not
 *
 * Ordering. The provider runs `reportCoverage` -> `generateReports` ->
 * `cleanAfterRun`, and this runs later still, at process exit. It therefore
 * moves COMPLETED files, never files a writer is partway through — which is
 * precisely the distinction that makes the shared-directory `rm` destructive
 * and this move benign.
 *
 * Two concurrent runs publishing together is last-writer-wins per file, and can
 * leave `lcov.info` from one beside `index.html` from another. That cost is
 * accepted deliberately: each run still reported its own correct number, and
 * nothing here can delete a directory another run is writing into.
 * @param directory - Reports directory as {@link coverageReportsDirectory} returned it
 * @param expectedName - The run-directory basename this process minted
 * @returns True when this run's own directory was published and removed
 */
export function publishCoverageRunDirectory(
  directory: string,
  expectedName: string
): boolean {
  if (path.basename(directory) !== expectedName) return false;
  const from = path.resolve(process.cwd(), directory);
  // Two levels up from `<base>/coverage/.runs/<run>` is `<base>/coverage`.
  // Derived from the run directory rather than from `process.cwd()` so the
  // pair travels together: a caller that states one has stated both, and a
  // test can exercise this against a temporary tree without changing
  // directory.
  const stable = path.dirname(path.dirname(from));
  try {
    if (!fs.existsSync(from)) return false;
    for (const entry of fs.readdirSync(from)) {
      if (entry === COVERAGE_SCRATCH_DIR) continue;
      const target = path.join(stable, entry);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(path.join(from, entry), target);
    }
    fs.rmSync(from, { recursive: true, force: true });
    return true;
  } catch {
    // Best effort. A run that cannot publish its artifacts has still measured
    // and reported its coverage correctly, and failing over it would turn a
    // tidiness problem into the red gate this module exists to prevent.
    return false;
  }
}

/**
 * Remove a run directory this process minted, and nothing else.
 *
 * The fallback when publishing could not happen, and the guard is the same one:
 * the basename must be the name this process generated, so a mis-wired caller
 * removes nothing rather than removing a directory another run is writing into.
 * @param directory - Reports directory as {@link coverageReportsDirectory} returned it
 * @param expectedName - The run-directory basename this process minted
 * @returns True when the path was this run's own
 */
export function removeOwnCoverageRunDirectory(
  directory: string,
  expectedName: string
): boolean {
  if (path.basename(directory) !== expectedName) return false;
  try {
    fs.rmSync(path.resolve(process.cwd(), directory), {
      recursive: true,
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove run directories belonging to runs that are no longer alive.
 *
 * Publishing happens at process exit, so an ordinary run leaves nothing behind.
 * A run that is `SIGKILL`ed does — and on a contended machine that is routine
 * rather than exceptional, so without this `coverage/.runs/` accrues one
 * directory per killed run with nothing ever removing them.
 *
 * ## Why liveness is legitimate here and not in a lock
 *
 * Reclaiming an abandoned directory is not adjudicating ownership of a
 * contended resource, and the asymmetry is what makes it safe: a false KEEP is
 * inert debris, and a false REMOVE is impossible, because a live run's own pid
 * always probes alive. The lock this module refuses has the opposite asymmetry
 * — there, a wrong answer releases a lock somebody is holding.
 *
 * It introduces no second authority. {@link parseRunRootName} and
 * {@link isProcessAlive} are the scratch namespace's existing parser and
 * liveness probe, and these directories are named by {@link runRootName}, so
 * that parser reads them unchanged. Anything it does not recognise is left
 * alone.
 * @param runsRoot - Directory holding the run directories
 * @param alive - Liveness probe; defaults to the shared one
 * @returns Basenames of the directories removed
 */
export function reclaimAbandonedCoverageRunDirectories(
  runsRoot: string = path.join(COVERAGE_BASE, COVERAGE_RUNS_DIR),
  alive: (owner: number) => boolean = isProcessAlive
): readonly string[] {
  const root = path.resolve(process.cwd(), runsRoot);
  try {
    const abandoned = fs.readdirSync(root).filter(name => {
      const owner = parseRunRootName(name);
      return owner !== undefined && !alive(owner.pid);
    });
    for (const name of abandoned)
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    return abandoned;
  } catch {
    // An absent or unreadable runs directory is not an error: nothing to
    // reclaim is the ordinary state on a checkout that has never run coverage.
    return [];
  }
}

/**
 * The path this process's coverage output belongs in.
 *
 * Memoized rather than recomputed. Every stack factory calls this, a project's
 * `vitest.config.ts` may merge several of them, and a run whose scratch and
 * whose reports disagreed about their directory would reproduce the defect
 * inside the fix.
 */
const pinned: { current: string | undefined } = { current: undefined };

/**
 * Resolves the coverage reports directory for this run.
 * @param environment - Environment to read; defaults to this process's.
 * @returns A value for Vitest's `coverage.reportsDirectory`.
 */
export function coverageReportsDirectory(
  environment: NodeJS.ProcessEnv = env
): string {
  const override = environment[COVERAGE_REPORTS_DIR_ENV];
  if (override !== undefined && override.trim() !== "") return override;

  if (pinned.current === undefined) {
    const name = runRootName(
      pid,
      Date.now(),
      randomBytes(SUFFIX_BYTES).toString("hex")
    );
    pinned.current = `${COVERAGE_BASE}/${COVERAGE_RUNS_DIR}/${name}`;
    registerRunLifecycle(pinned.current, name);
  }
  return pinned.current;
}

/**
 * Whether this process has already armed its reclaim and publish steps.
 *
 * Field named `current` to match {@link pinned}, and not by accident: the
 * project's `functional/immutable-data` rule permits mutation only through
 * `*.current`, `*.value` and `*.displayName`. Renaming it makes the file
 * stop linting.
 */
const lifecycle: { current: boolean } = { current: false };

/**
 * Reclaim abandoned directories now, and publish this run's own at exit.
 *
 * Armed once per process, from the same place the directory is minted, so the
 * two cannot disagree about which run they belong to. A pinned run never
 * reaches here: the pinned directory belongs to whoever set the pin, and is
 * left exactly as it was found.
 * @param directory - This run's reports directory
 * @param name - Its basename, which is the ownership proof both steps check
 */
function registerRunLifecycle(directory: string, name: string): void {
  if (lifecycle.current) return;
  lifecycle.current = true;
  // Before minting anything of our own: this run's directory does not exist
  // yet and its pid is alive regardless, so it can never be its own victim.
  reclaimAbandonedCoverageRunDirectories();
  process.once("exit", () => {
    if (!publishCoverageRunDirectory(directory, name))
      removeOwnCoverageRunDirectory(directory, name);
  });
}

/**
 * Discards the memoized value.
 *
 * Test-only. Exported because the memo is the one piece of state here, and a
 * suite that could not clear it would have to assert against whichever value
 * an unrelated earlier case happened to allocate.
 */
export function resetCoverageReportsDirectory(): void {
  pinned.current = undefined;
  lifecycle.current = false;
}

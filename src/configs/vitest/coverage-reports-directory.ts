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
import { env, pid } from "node:process";

import { runRootName } from "./scratch-namespace-authority.js";

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

  pinned.current ??= coverageRunDirectory(
    pid,
    Date.now(),
    randomBytes(SUFFIX_BYTES).toString("hex")
  );
  return pinned.current;
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
}

/**
 * Vitest Configuration - Coverage include guard (global setup)
 *
 * Refuses a coverage run whose `coverage.include` resolves to no files. The
 * reasoning for the check, and the measurements behind it, live in
 * {@link module:configs/vitest/coverage-include-authority}; this module is only
 * the hook that acts on the verdict.
 *
 * IT LIVES IN `setup`, NOT `teardown`, and that placement is load-bearing for
 * the same measured reason the scratch guard records: vitest SWALLOWS a throw
 * from `globalSetup` teardown — it prints `error during close` and the process
 * still exits 0 — while the same throw from `setup` exits 1. A guard placed in
 * a hook the runner ignores is the very defect this file exists to stop,
 * reproduced inside the guard.
 *
 * IT ONLY BITES WHEN COVERAGE IS ON. `coverage.enabled` is false on a plain
 * `vitest run` and true under `--coverage` — measured on vitest 4.1.9 rather
 * than assumed — so a project whose layout does not match its preset can still
 * run its tests. Only the measurement it cannot honestly make is refused. That
 * boundary is deliberate: the claim being protected is "coverage met the
 * threshold", and nothing else here is a claim about coverage.
 *
 * It reuses the scratch guard's two-part announcement rather than growing its
 * own. A refusal speaks twice, a banner before collection and a summary line at
 * exit, because those are the top and the bottom of a transcript nobody reads
 * in full — and the summary line already says the exact thing that is true
 * here: the run was refused before collection, so no coverage was measured.
 * @see {@link module:configs/vitest/coverage-include-authority} for why config time is the only honest place
 * @module configs/vitest/coverage-include-global-setup
 */
import { describeCoverageIncludeFailure } from "./coverage-include-authority.js";
import { announceRefusal } from "./scratch-global-setup.js";

/**
 * The shape vitest hands `globalSetup`, narrowed to what this guard reads.
 *
 * Declared structurally rather than imported from vitest's own types: this
 * module is compiled into the published package and loaded by consumer
 * projects, whose vitest may be a different minor than the one Lisa builds
 * against. Reading four fields off a plain object survives that; a nominal type
 * import does not.
 */
export interface CoverageProject {
  readonly config?:
    | {
        readonly coverage?:
          | {
              readonly enabled?: boolean | undefined;
              readonly include?: readonly string[] | undefined;
            }
          | undefined;
        readonly root?: string | undefined;
      }
    | undefined;
}

/**
 * Refuses the run when coverage would be measured over an empty file set.
 *
 * Degrades to allowing the run when vitest hands over something this guard
 * cannot read — no config, or no root. An unrecognised argument shape means the
 * guard does not know what it is looking at, and refusing on that would block
 * every run on a vitest whose internals moved, which is a worse failure than
 * the one being prevented. The refusal is reserved for the case it can actually
 * prove.
 * @param project - The test project vitest passes to `globalSetup`
 * @throws {Error} When coverage is enabled and no include pattern resolves.
 */
export const setup = (project?: CoverageProject): void => {
  const config = project?.config;
  const root = config?.root;
  if (config === undefined || root === undefined) return;

  const failure = describeCoverageIncludeFailure({
    enabled: config.coverage?.enabled === true,
    include: config.coverage?.include,
    root,
  });

  if (failure !== undefined) {
    // Both halves of the announcement happen before the throw, because the
    // throw is what ends this function.
    announceRefusal(failure);
    throw new Error(failure);
  }
};

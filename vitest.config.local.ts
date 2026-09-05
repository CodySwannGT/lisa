/**
 * Vitest Configuration - Project-Local Customizations (Lisa)
 *
 * Lisa-specific Vitest settings. This file is create-only — Lisa will not overwrite it.
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";
import * as path from "node:path";

// From source, not from `dist/`, for the reason given on `setupFiles` below:
// the pre-push gate and `test:cov:unit` do not build first, so a stale or
// missing build would silently leave this repo's own suite uncapped.
import { resolveMaxWorkers } from "./src/configs/vitest/base.js";

/** Wrapper-authoritative registry, with Lisa's legacy fixture default. */
const scratchPrefixes =
  process.env["LISA_TEST_SCRATCH_PREFIXES"] ??
  JSON.stringify([
    "changelog-",
    "derived-",
    "e2e-",
    "failure-signatures-",
    "invoked-",
    "lisa-",
    "maestro-",
    "node-",
    "review-",
    "skipreq-",
    "state-",
    "vacuity-",
    "wiki-",
  ]);

const config: ViteUserConfig = {
  test: {
    // The bounded scratch space, wired from source rather than from the built
    // package. Downstream projects reach the same modules through the shipped
    // factory (`getTypescriptVitestConfig`), which resolves them out of `dist/`.
    // Lisa cannot rely on that here: `test:cov:unit` and the pre-push gate do
    // not build first, so a stale or missing `dist/` would silently leave this
    // repo's own suite writing into the shared platform temp directory — the
    // exact condition being fixed, on the one project most able to cause it.
    // Both paths land in the merged arrays when `dist/` is fresh; the setup
    // module is idempotent per process, so that costs nothing.
    setupFiles: [
      path.resolve(import.meta.dirname, "src/configs/vitest/scratch-setup.ts"),
      path.resolve(
        import.meta.dirname,
        "src/configs/vitest/scratch-leak-setup.ts"
      ),
    ],
    sequence: { setupFiles: "list", hooks: "stack" },
    // Lisa's own legacy suite predates per-stack prefix registration. Declare
    // its bounded fixture namespaces before collection so the guard removes
    // known residue without turning existing fixture conventions into false
    // failures; a new prefix outside these families remains a red leak.
    globalSetup: [
      // Admission first, and for the same reason `maxWorkers` below defers to
      // the resolver rather than restating it: this file names its global setup
      // literally instead of calling `scratchGlobalSetup()`, so a control added
      // there reaches every downstream project and not the repository that
      // ships it. Lisa is the machine's largest single source of concurrent
      // runs; it must be inside its own bound, not exempt from it.
      path.resolve(
        import.meta.dirname,
        "src/configs/vitest/fleet-admission-global-setup.ts"
      ),
      path.resolve(
        import.meta.dirname,
        "src/configs/vitest/scratch-global-setup.ts"
      ),
    ],
    // Scale worker pressure with the machine instead of occupying every core.
    // On 2026-08-27 the 966-file coverage suite started 18 workers, drove the
    // host load above 300, and starved two repository-wide inventory tests past
    // their 120-second liveness bound. Half the available workers preserves
    // parallelism without making each scan compete with one worker per core;
    // unlike a fixed cap, it also stays proportionate on smaller CI runners.
    //
    // That half-the-cores value now lives in `resolveMaxWorkers` as the floor
    // every stack inherits, and this file defers to it rather than restating
    // it. The literal "50%" it replaces was correct and also inert against the
    // fleet: half of eighteen is nine, and nine workers times six concurrent
    // agents is fifty-four on an eighteen-core box. The resolver adds the two
    // layers that number was missing — a divisor when something states how many
    // runs share the machine, and an override in both directions — and this
    // config is merged OVER the stack preset, so a literal here would win over
    // both and Lisa would ship a control it does not itself run.
    maxWorkers: resolveMaxWorkers(),
    // The second pattern is not decoration. The ESLint plugin workspaces ship
    // their suites as CommonJS `.js` beside the rules they test, and the
    // fleet's include is `.ts` only — so five files, 1306 lines and 78 tests,
    // were never collected and nothing said so. `vitest run
    // eslint-plugin-component-structure/__tests__/plugin-index.test.js`
    // answered "No test files found"; all 78 pass the moment they are asked.
    //
    // Scoped to Lisa's create-only local config deliberately. Broadening the
    // shipped `.ts`-only include would start collecting `.js` in every
    // downstream project at once, which is a fleet decision with its own
    // evidence, not a side effect of this repo fixing its own dark suites.
    // `tests/unit/config/workspace-suite-collection.test.ts` is what keeps
    // this honest: it walks the workspaces independently of these patterns and
    // fails on any suite they miss — and on finding none at all.
    include: ["tests/**/*.test.ts", "eslint-plugin-*/__tests__/**/*.test.js"],
    // Lisa's own suite (~11.5k tests) is unlike a downstream project's: a large
    // sub-population spawns real subprocesses (git, bash, npm pack, tsc, oxlint)
    // or performs fsync-paired filesystem work in temp repositories. Against the
    // fleet default of 10s (src/configs/vitest/typescript.ts) those tests sit
    // close enough to the budget that WHICH ones lose is a dice roll per run —
    // 13 consecutive pre-push attempts failed with 10 to 161 timeouts, zero
    // assertion failures, and never in the pushing author's own suites (#2522).
    //
    // Ruled out by measurement before changing this, not by reasoning: sibling
    // load (fails at load 4.5 with zero siblings), parallelism (--maxWorkers=4
    // was WORSE, 124 vs 54), disk (682GB free), memory (52% free), subprocess
    // spawn (2.0/5.5/19.8ms for echo/git/node) and fsync (0.25ms/write).
    //
    // This is a LIVENESS bound, not a performance assertion: a hung test still
    // fails, just later. Tests that genuinely assert performance pass their own
    // per-test timeout, which overrides this and is deliberately left alone.
    // Scoped to Lisa's create-only local config on purpose — downstream projects
    // do not carry these suites and must not inherit a looser budget they have
    // no evidence for (#2509).
    // RAISED 60s -> 300s (#2885) for the same signature one band up, then
    // TIGHTENED 300s -> 120s (#2892) once the cause of the 300s tail was removed.
    // Both numbers are kept here because the second only makes sense against the
    // first.
    //
    // WHY IT WENT TO 300s. The 60s number was measured against a TRUNCATED
    // distribution: at a 60s budget every case that would have exceeded it is
    // recorded as exactly 60s, so the number looked adequate because it was
    // clipping the evidence that would refute it. Re-measured with the budget
    // lifted out of the way (--testTimeout=600000, fresh TMPDIR, fleet heavy-work
    // serialised, load ~19 on 18 cores) the whole unit suite was GREEN — 770
    // files, 13,797 tests, 0 failures, 418s wall — and the real tail was:
    //   max 100,254ms  p99.99 61,491ms  p99.9 35,492ms  p99 1,887ms  p50 0.45ms
    //   21 cases over 30s, 3 over 60s, 1 over 90s
    // Three cases exceeded 60s on a quiet machine. It was never passable here;
    // WHICH cases lost was the only variable.
    //
    // WHY IT CAME BACK DOWN TO 90s. That 100,254ms tail was not a property of
    // the code. It was a property of the git binary the bdd fixtures picked:
    // `/usr/bin/git` on macOS is Apple's `xcrun` shim, whose median is an
    // unremarkable ~24ms but whose MAXIMUM reaches ~20,727ms under load against
    // 11ms for a real binary. A tail, not a multiplier — one bad draw crosses a
    // budget and which case draws it is random, which is the entire "flakiness"
    // signature: timeouts only, zero assertion failures, a different losing set
    // every attempt. #2889 put two real root:wheel binaries ahead of the shim in
    // GIT_CANDIDATES, so no fixture dispatches through it any more.
    //
    // WHAT 120s IS SIZED AGAINST (#2892, re-measured 2026-08-23 on v3.66.1).
    // TWO distributions, because they disagree and the worse one governs:
    //
    //   SEQUENTIAL — nine runs, 130,869 timed cases pooled, 14,494 distinct.
    //     SIX runs of `test:unit` and THREE of `test:cov:unit`: the pre-push
    //     gate runs the COVERAGE variant, and a budget sized against a
    //     distribution the gate never sees is not a budget. Coverage did not
    //     inflate the tail — the instrumented runs pooled to a 15,444ms max,
    //     BELOW the uninstrumented one. Fresh TMPDIR per run; 1-minute load
    //     average recorded at each run's start, ranging 28 to 175. One rep began
    //     at 140 and ended at 175 — above the load 143 that was SIGTERM-killing
    //     the push gate during #2867 — and still passed 822/822 files.
    //       max 29,553ms  p99.99 15,168ms  p99.9 4,019ms  p99 1,689ms  p50 0.35ms
    //       0 cases over 30s, over 60s, or over 90s in any of the nine runs.
    //
    //   CONCURRENT — three suites at once in one worktree, which is the fleet
    //     condition rather than the quiet one, and it is the distribution that
    //     set this number. Load reached 155. Zero test failures and zero budget
    //     exceedances across all three, but the tail moved:
    //       worst case 38,790ms, up 1.31x from the sequential 29,553ms
    //     Anyone re-deriving this must reproduce the CONCURRENT number. Sizing
    //     against the sequential one alone yields 90s, which leaves only 2.32x
    //     headroom over a tail that was actually measured — the same
    //     too-close-to-the-tail error as the 60s this thread descends from.
    //
    //   The cases that set both numbers are the same two corpus-wide scans over
    //   every tracked file, so they are what to look at first if this fires:
    //     tests/unit/core/no-downstream-project-names.test.ts
    //     tests/unit/scripts/lisa-owned-hash-ledger.test.ts
    //
    // Margin, stated: 120s is 3.09x the measured 38,790ms concurrent worst case
    // (and 4.06x the 29,553ms sequential one). That is deliberately the SAME
    // 3.0x rule #2885 used, applied to a fresh measurement rather than replaced
    // with a new one — the number moved because the evidence moved, not because
    // the rule was relaxed.
    //
    // TWO LIMITS ON THAT MEASUREMENT, stated so nobody over-reads it:
    //   1. `hookTimeout` is NOT evidenced by it. Vitest's JSON reporter carries
    //      a duration per TEST, not per hook. 120s is applied to hookTimeout by
    //      symmetry with what it replaced, not by measurement. Evidencing it
    //      needs a different instrument.
    //   2. Whole-suite wall time fell 418s -> 62-120s, which is a larger
    //      improvement than the shim fix alone should explain. Scratch-TMPDIR
    //      work, spawn-bounding work and a reboot all landed in the same window.
    //      The EFFECT is measured and reproducible over nine runs; the CAUSE is
    //      not decomposed here and should not be guessed at.
    //
    // IF THIS BUDGET FIRES, READ THIS FIRST. It does not announce itself as
    // "budget too tight". It presents as a red `test-correctness` gate with a
    // different file list every attempt, and `test-correctness` and
    // `coverage-adequacy` share a prover, so one death reports as TWO red
    // verdicts and leaves `test-integration` NOT-RUN. That shape has been
    // misdiagnosed as a code regression more than once. Before raising this
    // number, check the three things that produced the last two false alarms:
    // a saturated shared $TMPDIR (lisa#2883), box load past ~143 (exit 143/137
    // mean KILLED, not failed), and a per-case inline budget overriding this one.
    //
    // Still a LIVENESS bound, not a performance assertion, and still not a
    // quality threshold — `threshold-monotonicity` does not govern it. A hung
    // test still fails, just later. Tests that genuinely assert performance
    // pass their own per-test timeout, which overrides this and is deliberately
    // left alone.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      // Never narrow a frozen wrapper lease. Mutation adds worker namespaces;
      // replacing them here makes setup fail before the first test can register.
      LISA_TEST_SCRATCH_PREFIXES: scratchPrefixes,
      LISA_TEST_SCRATCH_SUITE: "lisa",
      // The SECOND duration band, and vitest cannot reach it. Fourteen failures
      // clustered at 30,034-30,376ms are not vitest's budget expiring — they are
      // `CHILD_TIMEOUT_MS` inside the code under test
      // (all/copy-overwrite/scripts/lisa-work-item.mjs), which SIGKILLs its own
      // child at 30s. Raising testTimeout fixes exactly zero of them: the child
      // is already dead. Anyone who raises only the budget above will watch this
      // gate fail again with a different file list and conclude the raise did
      // not work.
      //
      // 30s is the right deadline for a real commit or push, where it stops a
      // tracker that has stopped answering from hanging a human's hook with no
      // output. It is the wrong deadline for a fixture spawning real `git` and
      // stubbed `gh` on an 18-core box at load 21. So this is set for the TEST
      // RUN only — the shipped default in the script is untouched, and no
      // downstream project inherits a looser one.
      //
      // 48s, and the number is DERIVED, not chosen: it is the same 2.5x-under
      // relationship the old 120s carried against the old 300s budget, re-applied
      // to the 120s budget above (#2892). Lowering the vitest budget WITHOUT
      // lowering this would have inverted the invariant this whole comment exists
      // to protect — a child deadline at or above the test budget means the TEST
      // dies first
      // and the failure reports as an anonymous vitest timeout instead of the
      // CLI's own diagnostic, which is precisely the confusion described above.
      //
      // It also has margin on the measurement rather than only on the ratio.
      // Across the nine #2892 runs the worst draw in ANY work-item CLI case was
      // 4,350ms — 308 distinct cases, none over 5s — and under three concurrent
      // suites the worst work-item case was 1,948ms. 48s is 11x the sequential
      // worst draw and 1.6x the shipped 30s default. The ~178s this comment's
      // predecessor attributed to these suites was shim-era and no longer
      // reproduces.
      //
      // Cases that stage a hang on purpose set their own value
      // (tests/unit/scripts/lisa-work-item.test.ts uses 1500) and that override
      // still wins — it is applied after the inherited environment.
      LISA_WORK_ITEM_TIMEOUT_MS: "48000",
    },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
  resolve: {
    alias: {
      // Expo/NestJS/CDK templates import @codyswann/lisa/* package paths so
      // downstream projects resolve via the installed npm package. In the Lisa
      // repo's own test context the package resolves to itself — redirect these
      // self-referencing imports to the local source files instead.
      "@codyswann/lisa/jest/base": path.resolve(
        import.meta.dirname,
        "src/configs/jest/base.ts"
      ),
      "@codyswann/lisa/vitest/base": path.resolve(
        import.meta.dirname,
        "src/configs/vitest/base.ts"
      ),
      "@codyswann/lisa/eslint/typescript": path.resolve(
        import.meta.dirname,
        "src/configs/eslint/typescript.ts"
      ),
      // Stack template files (expo/, nestjs/, cdk/) import ./jest.base.ts as
      // a sibling — which only exists at the project root after Lisa copies
      // the template. Redirect so tests can import these templates in-place.
      "./jest.base.ts": path.resolve(
        import.meta.dirname,
        "src/configs/jest/base.ts"
      ),
    },
  },
};

export default config;

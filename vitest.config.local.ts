/**
 * Vitest Configuration - Project-Local Customizations (Lisa)
 *
 * Lisa-specific Vitest settings. This file is create-only — Lisa will not overwrite it.
 * @see https://vitest.dev/config/
 * @module vitest.config.local
 */
import type { ViteUserConfig } from "vitest/config";
import * as path from "node:path";

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
    ],
    globalSetup: [
      path.resolve(
        import.meta.dirname,
        "src/configs/vitest/scratch-global-setup.ts"
      ),
    ],
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
    // RAISED AGAIN, 60s -> 300s (#2885), for the same signature one band up.
    // Nine push gates run; six pass. Only `test:cov:unit` fails, and because
    // `test-correctness` and `coverage-adequacy` share a prover, one death
    // reports as two red verdicts and leaves `test-integration` NOT-RUN:
    //   FAILED required test-correctness — 2 test(s)/hook(s) exceeded the
    //   60000ms budget, so the suite did not finish — NOT a coverage shortfall
    // Zero assertion failures, and the named files differ every attempt.
    //
    // The 60s number was measured against a TRUNCATED distribution: at a 60s
    // budget every case that would have exceeded it is recorded as exactly 60s.
    // Re-measured with the budget lifted out of the way (--testTimeout=600000,
    // fresh TMPDIR, fleet heavy-work serialised, load ~19 on 18 cores) the whole
    // unit suite is GREEN — 770 files, 13,797 tests, 0 failures, 418s wall —
    // and the real tail is:
    //   max 100,254ms  p99.99 61,491ms  p99.9 35,492ms  p99 1,887ms  p50 0.45ms
    //   21 cases over 30s, 3 over 60s, 1 over 90s
    // So three cases exceed the old budget on a quiet machine. It was never
    // passable here; WHICH cases lose was the only variable.
    //
    // Ruled out by measurement, not by reasoning, each re-verified today rather
    // than inherited from #2522:
    //   disk        — 515Gi free of 1.8Ti
    //   memory      — 5.7GB free + 50GB inactive of 128GB
    //   spawn       — 3.4ms /bin/echo, 12.7ms git, 34.4ms node (healthy)
    //   fsync       — 4.77ms/write over 20 open+write+fsync+close cycles
    //   parallelism — ruled out in #2522: --maxWorkers=4 was WORSE, 124 vs 54
    //   temp-dir    — the saturated shared $TMPDIR (mkdtemp 8,110.3ms there vs
    //                 0.3ms fresh; a single `stat` on it blocks 6.35s at 0% CPU)
    //                 is real, is lisa#2883, and is ALREADY mitigated: the run
    //                 above used a fresh one and still produced a 100,254ms case
    // What is left is not ours and is not going away: a browser, a power daemon
    // and a VM hold the box at load ~21 while every Lisa test process together
    // accounts for ~102%. That is the condition this budget must hold under,
    // permanently — so it is sized for it rather than against an idle machine.
    //
    // Margin, stated: 300s is 3.0x the 100,254ms worst case measured with the
    // fleet serialised, and 1.7x the worst INDIVIDUAL case observed today with
    // it not serialised (~178s, in the work-item CLI suites). The contended
    // tail runs ~1.8x the quiet tail; 300s covers that with headroom rather
    // than landing on it.
    //
    // Still a LIVENESS bound, not a performance assertion, and still not a
    // quality threshold — `threshold-monotonicity` does not govern it. A hung
    // test still fails, just later. Tests that genuinely assert performance
    // pass their own per-test timeout, which overrides this and is deliberately
    // left alone.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    env: {
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
      // 120s: 4x the shipped default, and deliberately 2.5x UNDER the 300s
      // vitest budget above, so a genuinely hung child still dies first and
      // reports as the CLI's own timeout diagnostic rather than as an anonymous
      // vitest test timeout. Cases that stage a hang on purpose set their own
      // value (tests/unit/scripts/lisa-work-item.test.ts uses 1500) and that
      // override still wins — it is applied after the inherited environment.
      LISA_WORK_ITEM_TIMEOUT_MS: "120000",
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

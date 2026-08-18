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
    testTimeout: 60_000,
    hookTimeout: 60_000,
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

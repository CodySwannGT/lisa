/**
 * A coverage gate must not report a number it never measured.
 *
 * Measured defect (CodySwannGT/lisa#3468): a stack preset's `coverage.include`
 * is written for that stack's usual layout. Applied to a project laid out
 * differently the globs match nothing, coverage is computed over zero files,
 * and the totals become `0/0` — which is not a percentage.
 *
 * The two fixtures at the bottom of this file are the measurement that settles
 * what `0/0` actually does, because the field report and the observed behaviour
 * disagreed. Identical thresholds, identical passing suite, differing only in
 * whether the include glob resolves:
 *
 *   include matches nothing -> thresholds NEVER EVALUATED, exit 0, gate passes
 *   include matches files at 50% -> exit 1, all three shortfalls named
 *
 * So the dangerous half is the silent pass, not the alarming 0% the defect was
 * reported as. Both come from the same non-answer: the json-summary reporter
 * serializes `"pct":"Unknown"` as a STRING, vitest's threshold check skips it,
 * and a reader doing `pct || 0` renders it 0%.
 *
 * The control matters as much as the failing case. Without the second fixture,
 * "the guard blocked the run" is consistent with a guard that blocks
 * everything, and a coverage gate that always refuses is no better than one
 * that always passes.
 * @module tests/unit/config/coverage-include-guard
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  describeCoverageIncludeFailure,
  resolveCoverageInclude,
} from "../../../src/configs/vitest/coverage-include-authority.js";
import { setup } from "../../../src/configs/vitest/coverage-include-global-setup.js";
import {
  coverageGlobalSetup,
  scratchGlobalSetup,
} from "../../../src/configs/vitest/base.js";
import { getCdkVitestConfig } from "../../../src/configs/vitest/cdk.js";
import { getHarperFabricVitestConfig } from "../../../src/configs/vitest/harper-fabric.js";
import { getNestjsVitestConfig } from "../../../src/configs/vitest/nestjs.js";
import { getPhaserVitestConfig } from "../../../src/configs/vitest/phaser.js";
import { getTypescriptVitestConfig } from "../../../src/configs/vitest/typescript.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Every stack factory, so a sixth joins these assertions by being listed once. */
const FACTORIES = [
  getTypescriptVitestConfig,
  getNestjsVitestConfig,
  getCdkVitestConfig,
  getHarperFabricVitestConfig,
  getPhaserVitestConfig,
] as const;

/** The CDK preset's globs, unresolved in a project laid out differently. */
const LIB_GLOB = "lib/**/*.ts";
const UTIL_GLOB = "util/**/*.ts";
/** The glob that resolves in every fixture here, and the file that makes it. */
const SRC_GLOB = "src/**/*.ts";
const SRC_FILE = "src/a.ts";

const temporary: string[] = [];

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/**
 * A project root containing exactly the given files.
 * @param files - Repo-relative paths to create, each with trivial contents
 * @returns The root directory
 */
function projectRoot(files: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-cov-include-"));
  temporary.push(root);
  for (const file of files) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "export const value = 1;\n");
  }
  return root;
}

describe("resolveCoverageInclude", () => {
  it("counts matches per pattern, in declaration order", () => {
    const root = projectRoot([SRC_FILE, "src/b.ts"]);

    expect(resolveCoverageInclude([LIB_GLOB, SRC_GLOB], root)).toEqual([
      { pattern: LIB_GLOB, matches: 0 },
      { pattern: SRC_GLOB, matches: 2 },
    ]);
  });

  it("counts an unresolvable root as zero rather than throwing", () => {
    // An unreadable root is itself a reason the population is empty, and it
    // should reach the same refusal instead of a stack trace.
    expect(
      resolveCoverageInclude([SRC_GLOB], "/definitely/not/a/directory")
    ).toEqual([{ pattern: SRC_GLOB, matches: 0 }]);
  });
});

describe("describeCoverageIncludeFailure", () => {
  it("refuses when no pattern resolves, and names every pattern", () => {
    const root = projectRoot([SRC_FILE]);

    const failure = describeCoverageIncludeFailure({
      enabled: true,
      include: [LIB_GLOB, UTIL_GLOB],
      root,
    });

    expect(failure).toBeDefined();
    expect(failure).toContain(LIB_GLOB);
    expect(failure).toContain(UTIL_GLOB);
    expect(failure).toContain(root);
  });

  it("allows the run when ANY pattern resolves", () => {
    // A partial miss is not a failure: coverage has a real population, so the
    // gate is meaningful. Failing here would break correctly configured
    // consumers — a preset naming lib/ and util/ in a project that has only
    // lib/ — to catch nothing.
    const root = projectRoot(["lib/a.ts"]);

    expect(
      describeCoverageIncludeFailure({
        enabled: true,
        include: [LIB_GLOB, UTIL_GLOB],
        root,
      })
    ).toBeUndefined();
  });

  it("says nothing when coverage is not being collected", () => {
    const root = projectRoot([SRC_FILE]);

    expect(
      describeCoverageIncludeFailure({
        enabled: false,
        include: [LIB_GLOB],
        root,
      })
    ).toBeUndefined();
  });

  it("says nothing when the config declares no include", () => {
    // Vitest's own defaults decide the population, so there is no assumption
    // of Lisa's to check.
    const root = projectRoot([SRC_FILE]);

    expect(
      describeCoverageIncludeFailure({ enabled: true, include: [], root })
    ).toBeUndefined();
    expect(
      describeCoverageIncludeFailure({ enabled: true, root })
    ).toBeUndefined();
  });
});

describe("the globalSetup hook", () => {
  it("throws when coverage is enabled and nothing resolves", () => {
    const root = projectRoot([SRC_FILE]);

    expect(() =>
      setup({
        config: { coverage: { enabled: true, include: ["lib/**"] }, root },
      })
    ).toThrow(/coverage\.include matched no files/u);
  });

  it("does not throw on a plain run, where coverage is disabled", () => {
    const root = projectRoot([SRC_FILE]);

    expect(() =>
      setup({
        config: { coverage: { enabled: false, include: ["lib/**"] }, root },
      })
    ).not.toThrow();
  });

  it("degrades to allowing the run when the project shape is unreadable", () => {
    // An unrecognised argument means the guard does not know what it is looking
    // at. Refusing on that would block every run on a vitest whose internals
    // moved — a worse failure than the one being prevented.
    expect(() => setup()).not.toThrow();
    expect(() => setup({})).not.toThrow();
    expect(() =>
      setup({ config: { coverage: { enabled: true } } })
    ).not.toThrow();
  });
});

describe("stack factory wiring", () => {
  it("resolves a global setup file that exists on disk", () => {
    const files = coverageGlobalSetup();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/coverage-include-global-setup\.(?:js|ts)$/u);
  });

  it.each(FACTORIES)(
    "installs the coverage guard beside the scratch guard",
    factory => {
      // Derived from the factory rather than typed out, so a sixth stack that
      // forgets the guard fails here instead of shipping a preset whose
      // coverage gate can pass having measured nothing.
      const globalSetup = factory().test?.globalSetup;

      expect(globalSetup).toEqual([
        ...scratchGlobalSetup(),
        ...coverageGlobalSetup(),
      ]);
    }
  );

  it.each(FACTORIES)("declares a coverage.include to guard", factory => {
    // The premise of the previous assertion. If a factory stopped declaring an
    // include, guarding it would be measuring nothing and this pair would be
    // two green tests over an empty question.
    expect(factory().test?.coverage?.include?.length).toBeGreaterThan(0);
  });
});

/**
 * Lay out a fixture project on disk.
 * @param include - The coverage.include patterns for the fixture
 * @param sources - Source files to create, relative to the fixture root
 * @returns The fixture root
 */
function writeFixture(
  include: readonly string[],
  sources: readonly string[]
): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-cov-fixture-"));
  temporary.push(root);
  mkdirSync(path.join(root, "tests"), { recursive: true });
  for (const file of sources) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "export const add = (a: number): number => a + 1;\n");
  }
  writeFileSync(
    path.join(root, "tests", "smoke.test.ts"),
    'import { expect, it } from "vitest";\nit("passes", () => { expect(1).toBe(1); });\n'
  );
  writeFileSync(
    path.join(root, "vitest.config.ts"),
    [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({",
      "  test: {",
      '    include: ["tests/**/*.test.ts"],',
      `    globalSetup: ${JSON.stringify(coverageGlobalSetup())},`,
      "    coverage: {",
      '      provider: "v8",',
      `      include: ${JSON.stringify(include)},`,
      '      reporter: ["text"],',
      "      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },",
      "    },",
      "  },",
      "});",
      "",
    ].join("\n")
  );
  // Borrowed rather than installed: the fixture needs the same vitest this
  // suite is running under, and resolving it from this checkout is what makes
  // the run reproduce the consumer's situation exactly. A link rather than a
  // copy, so the fixture never writes into the borrowed tree.
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
  return root;
}

/**
 * This process's environment with the pool marker removed.
 *
 * `VITEST_POOL_ID` is how the refusal banner tells a run's main process from a
 * pool worker, and it stays silent in a worker so a test that pokes the guard
 * cannot scribble on an unrelated transcript. This suite runs inside a worker,
 * so a fixture would INHERIT that marker and its own main process would fall
 * silent — an artifact of spawning vitest from vitest, and nothing a consumer
 * would ever see. Dropping it restores the real situation: a vitest main
 * process, with no pool marker.
 * @returns A copy of the environment, without the pool marker
 */
function fixtureEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["VITEST_POOL_ID"];
  return env;
}

/**
 * Run vitest against a generated fixture project.
 * @param include - The coverage.include patterns for the fixture
 * @param sources - Source files to create, relative to the fixture root
 * @returns Exit status, stderr, and both streams concatenated
 */
function runFixture(
  include: readonly string[],
  sources: readonly string[]
): { status: number; stderr: string; output: string } {
  const root = writeFixture(include, sources);
  const result = boundedSpawnSync({
    label: "coverage include fixture",
    command: process.execPath,
    args: [
      path.resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--coverage",
      "--root",
      root,
    ],
    cwd: root,
    env: fixtureEnv(),
    // Derived against a measured child, not guessed: these fixtures complete in
    // roughly 400-800ms each on an idle machine. 6,000ms is the highest base
    // the budget conformance check admits here — scaled by its 8x slowdown
    // ceiling it stays comfortably inside the per-case budget, which is what
    // keeps the CHILD the thing that dies first. A base above that lets the
    // case die of a vitest timeout instead, and a vitest timeout names nothing.
    baseMs: 6_000,
  });
  return {
    status: result.status ?? -1,
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("a coverage run, end to end", () => {
  it("refuses when the include resolves to nothing, and disowns the number", () => {
    const { status, stderr, output } = runFixture(
      [LIB_GLOB, UTIL_GLOB],
      ["src/math.ts"]
    );

    expect(status).not.toBe(0);
    expect(output).toContain("coverage.include matched no files");
    expect(output).toContain(LIB_GLOB);

    // Vitest prints its empty `All files | 0 | 0 | 0 | 0` table anyway. Measured
    // twice rather than assumed: a globalSetup throw does not unwind the
    // coverage provider, and neither does setting `coverage.enabled = false` on
    // the resolved config before throwing — by then the provider is already
    // initialized.
    //
    // The number therefore cannot be suppressed, so the honest reading of "does
    // not report a coverage percentage" is that the number is unmistakably
    // disowned. The refusal says so in as many words, and says it twice.
    expect(stderr).toContain("not a verdict on the code");
    expect(stderr).toContain("NO VERDICT");
    // Banner first, summary last — the top and the bottom of a transcript
    // nobody reads in full. Asserted within ONE stream on purpose: the table
    // goes to stdout and the refusal to stderr, and how a terminal interleaves
    // two streams is not something a captured pair of buffers can witness.
    expect(stderr.indexOf("REFUSED TO START")).toBeLessThan(
      stderr.indexOf("NO VERDICT")
    );
  });

  it("runs coverage normally when the include resolves", () => {
    // The control. Without it, the assertion above is equally satisfied by a
    // guard that refuses every run.
    const { status, output } = runFixture([SRC_GLOB], ["src/math.ts"]);

    expect(output).toContain("Coverage report from v8");
    expect(output).not.toContain("coverage.include matched no files");
    // The fixture's source is genuinely uncovered, so the thresholds bite —
    // which is the behaviour the guard exists to make reachable.
    expect(status).not.toBe(0);
    expect(output).toContain("does not meet global threshold");
  });
});

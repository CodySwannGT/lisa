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
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The two end-to-end cases below start a WHOLE nested runner — tsx,
// `lisa-test-run` and its two companions, then a complete vitest with the v8
// coverage provider — where they used to start a bare vitest. That child needs
// a base above the 6,000ms the flat regime admits here, and the flat regime is
// the reason it could not have one: with no calibrated case budget, a child
// bound is judged against `vitest.config.local.ts`'s 120,000ms via
// `CASE_BUDGET_MARGIN`, which caps the base at 6,000ms. Calling this puts both
// deadlines on the SAME measured slowdown, so the ratio between them is exact
// on every machine, and it installs the live margin guard that fails a case
// whose quiet-equivalent cost climbs past half its base.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * The supervised route every managed test child in this tree is started
 * through, spelled exactly as the analyzer requires: the runner path, then
 * `--profile`, `--adapter`, and the `--` that separates the wrapper's own
 * arguments from the command it supervises.
 *
 * `lisa` rather than a fixture-specific profile because the scratch this suite
 * creates is already named for it — `lisa-cov-fixture-`, `lisa-cov-include-`
 * and `lisa-cov-scratch-` all carry the `lisa-` prefix that profile registers.
 */
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const TEST_RUNNER_ARGS = [
  "--import",
  "tsx",
  TEST_RUNNER,
  "--profile",
  "lisa",
  "--adapter",
  "vitest",
] as const;

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

/** The CSI escape a terminal-styled run emits around its coloured tokens. */
const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`,
  "gu"
);

/**
 * Captured child output with terminal styling removed.
 *
 * The child decides for itself whether to colourise, and it decided
 * differently on CI than on a developer machine — its coverage banner arrived
 * as `Coverage report from <esc>[22m<esc>[33mv8`, which no contiguous
 * substring assertion can match. Stripping here means these assertions are
 * about what the run DID, not about how it was painted.
 * @param text - Raw captured stream
 * @returns The same text with CSI sequences removed
 */
const withoutAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");

/**
 * This process's environment, with the pool marker removed and temp isolated.
 *
 * `VITEST_POOL_ID` is how the refusal banner tells a run's main process from a
 * pool worker, and it stays silent in a worker so a test that pokes the guard
 * cannot scribble on an unrelated transcript. This suite runs inside a worker,
 * so a fixture would INHERIT that marker and its own main process would fall
 * silent — an artifact of spawning vitest from vitest, and nothing a consumer
 * would ever see. Dropping it restores the real situation: a vitest main
 * process, with no pool marker. It is dropped whoever the child's parent is:
 * routing through the supervisor changed nothing about why.
 *
 * The temp override is what the supervised route adds. `lisa-test-run` roots
 * its own scratch — the run root the detached reaper is armed against — at
 * `TMPDIR`, and pointing that at a base this case created and removes keeps
 * the supervisor's bookkeeping out of the shared platform temp the parent
 * suite is itself being audited on.
 * @param scratchBase - Private temp base for the supervised child
 * @returns A copy of the environment, without the pool marker
 */
function fixtureEnv(scratchBase: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: scratchBase,
    TMP: scratchBase,
    TEMP: scratchBase,
  };
  delete env["VITEST_POOL_ID"];
  return env;
}

/**
 * A private temp base for one supervised run, registered for teardown.
 * @returns The base directory
 */
function supervisorScratchBase(): string {
  const base = mkdtempSync(path.join(tmpdir(), "lisa-cov-scratch-"));
  temporary.push(base);
  return base;
}

/**
 * Quiet-box budget for one supervised fixture run.
 *
 * The bare vitest child this replaced was measured at 400-800ms and given
 * 6,000ms. What runs now is strictly more: `tsx` compiling `lisa-test-run` and
 * its module graph, two forked companions handshaking before the payload is
 * allowed to start, then the same vitest with the same coverage provider, then
 * a drain and a scratch removal after it exits.
 *
 * Measured on this repository, 18 cores, with the conditions stated because a
 * timing without them is a fact about a machine rather than about this code.
 * Two runs: `ps aux | grep -c '[v]itest'` = 0 at a 1-minute load average of
 * 4.5, then = 2 at a load average of 8.1. The two cases cost 2,681/2,899ms and
 * 2,632/2,692ms wall, on a box whose median `node -e ""` spawn measured 15.6ms
 * against the 18ms quiet figure the scaler is calibrated to — i.e. a 1.00x
 * machine, so those numbers are already quiet-equivalent. Nearly all of it is
 * the child. Supervision costs roughly 2s of that, and buys the reaping.
 *
 * 20,000ms is ~7x the slowest measured child and stays under the 30,000ms
 * ceiling `scaledCaseBudgetFailure` puts on a file calling
 * {@link useIoLatencyBudget} with the default 60,000ms case base. It is a
 * LIVENESS bound on a child that has stopped advancing, not a performance
 * assertion: the live margin guard, which fails a PASSING case above 30,000ms
 * quiet-equivalent, is what watches the cost.
 */
const SUPERVISED_FIXTURE_BASE_MS = 20_000;

/**
 * Run vitest against a generated fixture project, under supervision.
 *
 * The child is started through `lisa-test-run` rather than directly
 * (CodySwannGT/lisa#3732). A bare vitest child is an unsupervised process: if
 * this case is killed — a `spawnSync` timeout, a Ctrl-C, a reaped gate command
 * — the child is reparented rather than reaped, and it keeps a whole vitest
 * and its pool alive with nobody left who knows they exist. The supervisor
 * exists precisely to make that unreachable: it arms a DETACHED reaper against
 * the payload's process group before the payload is allowed to start, so the
 * group is torn down whether the foreground exits normally, exits with the
 * payload's failure, or dies without running any cleanup of its own.
 *
 * Nothing about what the two cases below assert had to move. `lisa-test-run`
 * forwards the payload's exit status, and wires stdout and stderr straight
 * through as separate streams, so the status and the two-stream ordering
 * assertion mean exactly what they meant when this call was bare.
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
      ...TEST_RUNNER_ARGS,
      "--",
      process.execPath,
      path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--coverage",
      "--root",
      root,
    ],
    cwd: root,
    env: fixtureEnv(supervisorScratchBase()),
    baseMs: SUPERVISED_FIXTURE_BASE_MS,
  });
  const stderr = withoutAnsi(result.stderr ?? "");
  return {
    status: result.status ?? -1,
    stderr,
    output: `${withoutAnsi(result.stdout ?? "")}${stderr}`,
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

    // Matched as a pattern, and stopping before the provider name. Vitest
    // styles that token separately — on CI its output arrived as
    // `Coverage report from <esc>[22m<esc>[33mv8`, so a contiguous
    // "Coverage report from v8" cannot match however the run behaved. The
    // assertion was testing the child's colour settings, not the guard.
    expect(output).toMatch(/Coverage report from/u);
    expect(output).not.toContain("coverage.include matched no files");
    // The fixture's source is genuinely uncovered, so the thresholds bite —
    // which is the behaviour the guard exists to make reachable.
    expect(status).not.toBe(0);
    expect(output).toContain("does not meet global threshold");
  });
});

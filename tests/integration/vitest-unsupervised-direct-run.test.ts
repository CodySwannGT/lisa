/**
 * A direct `vitest` invocation still evaluates assertions.
 *
 * ## What shipped, and why CI did not catch it
 *
 * `scratch-setup` is wired as a `setupFiles` entry by `scratchSetupFiles()`, so
 * it runs inside every worker before any test file. From 4.29.0 its module top
 * level threw when `LISA_TEST_RUN_LEASE` was absent — that is, whenever anyone
 * ran `vitest` without the `lisa-test-run` wrapper. A throw in a setup file
 * fails COLLECTION, so the run reports:
 *
 * ```
 *  Test Files  1 failed (1)
 *       Tests  no tests
 * ```
 *
 * Zero assertions evaluated, and a gate red having proved nothing. Measured
 * against published tarballs, one fixture consumer, one test, only the version
 * changed:
 *
 * | @codyswann/lisa | `vitest run` with no lease |
 * |---|---|
 * | 4.23.26 | `Tests  1 passed (1)` |
 * | 4.28.5  | `Tests  1 passed (1)` |
 * | 4.29.0 onward | `Tests  no tests` |
 *
 * ## Why it survived two releases, and why this file must stay out-of-process
 *
 * This repository ships the requirement AND the mechanism to itself; consumers
 * get the requirement alone. Every `test*` script in package.json is
 * `lisa-test-run -- --adapter vitest -- vitest ...`, and `lisa-test-run`
 * injects `LISA_TEST_RUN_LEASE` into the child environment. The check was not
 * absent here and it was not skipped — it ran, and it was satisfied, every
 * time.
 *
 * So the defect is not under-tested; it is **structurally invisible from the
 * place it was written**. This repository's environment is the one
 * configuration in which it cannot occur. No amount of care upstream would
 * have caught it, and it took diffing published tarballs across a version
 * boundary to find.
 *
 * The general form is worth more than this ticket:
 *
 * > A precondition this repository satisfies by construction is untested by
 * > this repository's suite. When a change adds a precondition, the test that
 * > matters is one run in an environment that does NOT meet it.
 *
 * **That is why every case below spawns a child process, and why none of them
 * may be "simplified" into an in-suite call later.** An in-suite test inherits
 * the lease from the very wrapper whose absence is the bug, so it runs in the
 * one environment where the failure is unreachable — it would pass against the
 * broken build and restore exactly the blind spot this file exists to close.
 * The out-of-process shape is not belt-and-braces; it is the only shape that
 * can fail.
 *
 * ## The rest of the case's shape
 *
 * **A child process, not an in-process call.** Beyond the blind spot above,
 * the defect lives in module top-level execution under a real Vitest worker.
 * `installScratchRoot()` called from a test that is already running has, by
 * definition, already collected — it can prove the function's return value and
 * never the thing that broke.
 *
 * **The lease is scrubbed, not falsified.** `env -u`, not `LEASE=""`. A run
 * that inherits an empty string is a different input from a run that inherits
 * nothing, and only the second is what a person typing `vitest` produces.
 *
 * **A parsed count, not an exit code.** This is the assertion that would have
 * caught it. A zero-collection run is not reliably non-zero: vitest exits 1 for
 * a failed setup file but 0 for `--passWithNoTests`, and either way "0 tests,
 * green" is the shape that escapes a gate. So the case reads the reporter's own
 * count back and demands it be positive. Asserting `status === 0` alone passes
 * vacuously against the broken build under `--passWithNoTests`.
 *
 * **A private platform temp root.** Measured while writing this: the scratch
 * namespace is derived from `os.tmpdir()`, which is shared, and a concurrent
 * sibling run's roots made the global-setup authority guard refuse to start —
 * a red run that says nothing about this code. `TMPDIR` is therefore pinned to
 * a directory this case owns, which also makes the residue assertion below a
 * statement about this run and no other.
 * @module tests/integration/vitest-unsupervised-direct-run
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SCRATCH_NAMESPACE } from "../../src/configs/vitest/scratch.js";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(__dirname, "..", "..");
const VITEST = path.join(ROOT, "node_modules", ".bin", "vitest");

/** One cheap real suite, chosen only because it is small and always passes. */
const PAYLOAD = "tests/unit/utils/fibonacci.test.ts";

/** Startup dominates; the payload itself is milliseconds. */
const BUDGET_MS = 90_000;

/**
 * Every variable the wrapper injects, so the child inherits a bare environment.
 *
 * The lease is the one under test. The two route-profile variables are removed
 * with it because `lisa-test-run` sets all three together — leaving the other
 * two behind would describe a state no direct invocation can be in, and would
 * quietly test the supervised path with one variable missing.
 */
const WRAPPER_ENV = [
  "LISA_TEST_RUN_LEASE",
  "LISA_TEST_SCRATCH_SUITE",
  "LISA_TEST_SCRATCH_PREFIXES",
] as const;

const created: string[] = [];

/**
 * Allocate a platform temp root this case alone owns.
 * @returns Absolute path to the private temp root.
 */
const privateTempRoot = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unsupervised-direct-"));
  created.push(dir);
  return dir;
};

/**
 * Environment for a direct, unsupervised `vitest` invocation.
 * @param tempRoot - Private platform temp root for the child
 * @returns Inherited environment with every wrapper variable removed.
 */
const unsupervisedEnv = (tempRoot: string): NodeJS.ProcessEnv => {
  const inherited = { ...process.env };
  for (const name of WRAPPER_ENV) delete inherited[name];
  return {
    ...inherited,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    // Rendering only — it does not touch the lease, which is the whole subject
    // of these cases. On CI the reporter colourises even into a pipe, and the
    // summary this file parses arrives as
    // `ESC[2m      Tests ESC[22m ESC[1mESC[32m29 passed…`, which no plain-text
    // match survives. Pinning it makes the parse deterministic rather than
    // dependent on the runner's colour heuristics; `stripAnsi` below is the
    // belt to this braces, for the day a reporter ignores the variable.
    NO_COLOR: "1",
  };
};

/** Matches an SGR colour escape, built without a literal control character. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

/**
 * Remove colour escapes so a summary line can be matched as plain text.
 * @param value - Possibly colourised reporter output
 * @returns The same text with SGR escapes removed.
 */
const stripAnsi = (value: string): string => value.replace(ANSI_SGR, "");

/**
 * Read the reporter's own passed-test count back out of a run's output.
 *
 * Returns 0 for `Tests  no tests`, which is exactly the broken shape, so the
 * caller can assert a positive count rather than an exit status.
 * @param output - Combined stdout and stderr of the run
 * @returns Number of tests the reporter says passed.
 */
const passedTestCount = (output: string): number => {
  // Scanned line by line rather than with one multiline regex. `^\s*` under the
  // `m` flag can consume newlines, which makes the match ambiguous against the
  // anchor and super-linear on long output — and a failing run's output is long
  // precisely because it embeds the child's.
  const summaries = stripAnsi(output)
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("Tests "));
  const last = summaries[summaries.length - 1];
  const passed =
    last === undefined ? null : /^Tests\s+(\d+) passed/u.exec(last);
  return passed === null ? 0 : Number(passed[1]);
};

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("the summary parser these cases assert through", () => {
  // This exists because the parser silently failed CI while every case here
  // passed locally. `spawnSync` gives the child a pipe, so on a developer
  // machine the reporter emits plain text and `startsWith("Tests ")` matched.
  // On CI the reporter colourises anyway and the same line arrives with an SGR
  // escape in front, so the filter matched nothing and the count read 0 — the
  // parser reported the exact shape it was written to detect, against a run
  // that had just passed 29 tests.
  //
  // The sample is copied verbatim from the failing job's log, so this case
  // fails if the stripping is removed.
  const ESC = String.fromCharCode(27);
  const COLOURISED_SUMMARY = [
    `${ESC}[2m Test Files ${ESC}[22m ${ESC}[1m${ESC}[32m1 passed${ESC}[31m${ESC}[22m${ESC}[90m (1)${ESC}[31m`,
    `${ESC}[2m      Tests ${ESC}[22m ${ESC}[1m${ESC}[32m29 passed${ESC}[31m${ESC}[22m${ESC}[90m (29)${ESC}[31m`,
  ].join("\n");

  it("reads a count through the reporter's colour escapes", () => {
    expect(passedTestCount(COLOURISED_SUMMARY)).toBe(29);
  });

  it("reads a count from plain output", () => {
    expect(
      passedTestCount(" Test Files  1 passed (1)\n      Tests  29 passed (29)")
    ).toBe(29);
  });

  it("reads zero from the shape this whole file exists to catch", () => {
    expect(
      passedTestCount(" Test Files  1 failed (1)\n      Tests  no tests")
    ).toBe(0);
  });
});

describe("a direct vitest invocation with no supervised lease", () => {
  it(
    "collects and runs the suite instead of failing at setup",
    { timeout: ioLatencyBudgetMs(BUDGET_MS) },
    () => {
      const tempRoot = privateTempRoot();

      const run = spawnSync(VITEST, ["run", PAYLOAD], {
        cwd: ROOT,
        encoding: "utf-8",
        env: unsupervisedEnv(tempRoot),
        killSignal: "SIGKILL",
        timeout: ioLatencyBudgetMs(BUDGET_MS / 2),
      });
      const output = `${run.stdout}${run.stderr}`;

      expect(
        run.signal,
        `the run was killed (${run.signal}) rather than finishing, so it proves nothing:\n${output}`
      ).toBeNull();

      // The load-bearing assertion. Not `status === 0`: a run that collected
      // nothing can exit 0, which is how this reached four minor releases.
      expect(
        passedTestCount(output),
        `the unsupervised run evaluated no assertions, which is the defect this case exists for:\n${output}`
      ).toBeGreaterThan(0);
      expect(run.status, output).toBe(0);
    }
  );

  it(
    "says it is unsupervised rather than failing silently",
    { timeout: ioLatencyBudgetMs(BUDGET_MS) },
    () => {
      const tempRoot = privateTempRoot();

      const run = spawnSync(VITEST, ["run", PAYLOAD], {
        cwd: ROOT,
        encoding: "utf-8",
        env: unsupervisedEnv(tempRoot),
        killSignal: "SIGKILL",
        timeout: ioLatencyBudgetMs(BUDGET_MS / 2),
      });
      const output = `${run.stdout}${run.stderr}`;

      // Degrading quietly would be its own defect: the operator has to learn
      // that the reaper is absent, and the wrapper has to be nameable and
      // runnable from what is printed.
      expect(output).toContain("self-supervised");
      expect(output).toContain(
        "lisa-test-run --profile <profile> --adapter vitest -- vitest"
      );
    }
  );

  it(
    "leaves no run root behind in its own namespace",
    { timeout: ioLatencyBudgetMs(BUDGET_MS) },
    () => {
      const tempRoot = privateTempRoot();
      const namespace = path.join(tempRoot, SCRATCH_NAMESPACE);

      const run = spawnSync(VITEST, ["run", PAYLOAD], {
        cwd: ROOT,
        encoding: "utf-8",
        env: unsupervisedEnv(tempRoot),
        killSignal: "SIGKILL",
        timeout: ioLatencyBudgetMs(BUDGET_MS / 2),
      });
      const output = `${run.stdout}${run.stderr}`;

      // Guard the guard: an empty namespace is also what a run that never
      // allocated one looks like, so the residue claim is only worth making
      // about a run that actually executed the suite.
      expect(passedTestCount(output), output).toBeGreaterThan(0);

      const residue = fs.existsSync(namespace) ? fs.readdirSync(namespace) : [];
      expect(
        residue,
        `an unsupervised run bounds its scratch to a root it owns and removes it on exit; these were left behind:\n${output}`
      ).toEqual([]);
    }
  );
});

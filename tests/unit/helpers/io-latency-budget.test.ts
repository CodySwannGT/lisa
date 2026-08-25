/**
 * Tests for the calibrated budget that replaced a guessed wall-clock number.
 *
 * Two layers on purpose. The arithmetic is tested purely, because a guard whose
 * verdict depends on how busy the box is cannot be tested by making the box
 * busy. The WIRING is tested by running a fixture suite in a child vitest,
 * because a margin guard that is never attached to `beforeEach`/`afterEach`
 * reports nothing and passes forever — which is the exact defect
 * CodySwannGT/lisa#2822 sits under (CodySwannGT/lisa#2867).
 * @module tests/unit/helpers/io-latency-budget
 */
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import localVitestConfig from "../../../vitest.config.local.js";
import {
  BOUNDED_SPAWN_BASE_MS,
  CASE_BUDGET_MARGIN,
  IO_LATENCY_TEST_TIMEOUT_MS,
  MARGIN_FRACTION,
  MAX_SPAWN_SLOWDOWN,
  QUIET_SPAWN_LATENCY_MS,
  boundedSpawnSync,
  caseBudgetFailure,
  ioLatencyBudgetMs,
  marginFailure,
  measureSpawnLatencyMs,
  slowdownFactorFrom,
  useIoLatencyBudget,
  workerSpawnSlowdown,
} from "../../helpers/io-latency-budget.js";

// One case here spawns a whole child vitest, which is the only honest way to
// prove the guard is attached. Measured at 3.0s with 6 sibling vitest processes
// live and a 1-minute load average of 9.0 on 18 cores.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests",
  "helpers",
  "__fixtures__",
  "margin-guard-case.ts"
);
const REDUCE_THE_WORK = "REDUCE THE WORK";
const HELPER_SOURCE = "tests/helpers/io-latency-budget.ts";

/** How the derivation cites the case budget it was computed against. */
const CITED_CASE_BUDGET = /`testTimeout` to ([\d,]+)ms/u;

/**
 * Read the per-case budget this repository's suites actually run under.
 *
 * From the config rather than from a literal here, because a literal here is
 * the same defect one file over: it would agree with the derivation forever
 * and with vitest only until somebody re-measured the budget.
 * @returns The configured `testTimeout`, in milliseconds
 */
function liveCaseBudgetMs(): number {
  const configured = localVitestConfig.test?.testTimeout;
  if (typeof configured !== "number") {
    throw new Error(
      "vitest.config.local.ts no longer sets an explicit testTimeout, so the " +
        "budget the bounded-child derivation is written against is unknown. " +
        "Point this at whatever now decides the per-case budget."
    );
  }
  return configured;
}
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("slowdownFactorFrom", () => {
  it("reports 1 for the recorded quiet-box latency", () => {
    expect(slowdownFactorFrom(QUIET_SPAWN_LATENCY_MS)).toBe(1);
  });

  it("reports the measured ratio for a slower box", () => {
    expect(slowdownFactorFrom(QUIET_SPAWN_LATENCY_MS * 4)).toBe(4);
  });

  it("never tightens the budget on a box faster than the recording", () => {
    expect(slowdownFactorFrom(QUIET_SPAWN_LATENCY_MS / 10)).toBe(1);
  });

  it("clamps a pathological box so it cannot buy unlimited silence", () => {
    expect(slowdownFactorFrom(QUIET_SPAWN_LATENCY_MS * 1_000)).toBe(
      MAX_SPAWN_SLOWDOWN
    );
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to 1 for the unusable measurement %s",
    latency => {
      expect(slowdownFactorFrom(latency)).toBe(1);
    }
  );
});

describe("ioLatencyBudgetMs", () => {
  it("scales the base budget by the measured slowdown", () => {
    expect(ioLatencyBudgetMs(1_000)).toBe(
      Math.round(workerSpawnSlowdown() * 1_000)
    );
  });

  it("is never tighter than the quiet-box base", () => {
    expect(
      ioLatencyBudgetMs(IO_LATENCY_TEST_TIMEOUT_MS)
    ).toBeGreaterThanOrEqual(IO_LATENCY_TEST_TIMEOUT_MS);
  });
});

describe("measureSpawnLatencyMs", () => {
  it("returns a positive finite cost for a real child process", () => {
    const latency = measureSpawnLatencyMs(3);

    expect(Number.isFinite(latency)).toBe(true);
    expect(latency).toBeGreaterThan(0);
  });
});

describe("marginFailure", () => {
  it("stays silent for a case well inside its margin", () => {
    expect(
      marginFailure({ elapsedMs: 5_000, baseMs: 60_000, slowdown: 1 })
    ).toBeUndefined();
  });

  it("stays silent exactly at the ceiling", () => {
    expect(
      marginFailure({
        elapsedMs: 60_000 * MARGIN_FRACTION,
        baseMs: 60_000,
        slowdown: 1,
      })
    ).toBeUndefined();
  });

  it("names the remedy when a quiet box burns past the ceiling", () => {
    const failure = marginFailure({
      elapsedMs: 51_000,
      baseMs: 60_000,
      slowdown: 1,
    });

    expect(failure).toContain(REDUCE_THE_WORK);
    expect(failure).toContain("51.0s");
    expect(failure).toContain("30.0s ceiling");
  });

  it("divides the machine out: the same wall time passes on a slower box", () => {
    const observed = { elapsedMs: 51_000, baseMs: 60_000 } as const;

    expect(marginFailure({ ...observed, slowdown: 1 })).toContain(
      REDUCE_THE_WORK
    );
    expect(marginFailure({ ...observed, slowdown: 4 })).toBeUndefined();
  });

  it("still fails a slow box whose code genuinely outgrew the budget", () => {
    expect(
      marginFailure({ elapsedMs: 200_000, baseMs: 60_000, slowdown: 4 })
    ).toContain(REDUCE_THE_WORK);
  });
});

describe("caseBudgetFailure", () => {
  it("stays silent for a bound with the whole margin to spare", () => {
    expect(
      caseBudgetFailure({
        baseMs: 1_000,
        maxSlowdown: 8,
        caseBudgetMs: 120_000,
      })
    ).toBeUndefined();
  });

  it("stays silent exactly at the margin", () => {
    // The negative control the bite case below needs. Without a triple that
    // DOES satisfy the relation and is admitted, a guard that refused
    // everything would look identical to a guard that works.
    expect(
      caseBudgetFailure({
        baseMs: 6_000,
        maxSlowdown: 8,
        caseBudgetMs: 120_000,
      })
    ).toBeUndefined();
  });

  it("fails a margin short by a single millisecond of base", () => {
    expect(
      caseBudgetFailure({
        baseMs: 6_001,
        maxSlowdown: 8,
        caseBudgetMs: 120_000,
      })
    ).toContain("48,008ms");
  });

  it("names both deadlines for the derivation that silently went stale", () => {
    // CodySwannGT/lisa#3202 exactly: the base that was correct against a
    // 300,000ms case budget, still sitting there after the budget was
    // re-measured to 120,000ms. 15,000 x 8 EQUALS 120,000, so the child's
    // deadline and the case's deadline are the same instant.
    const failure = caseBudgetFailure({
      baseMs: 15_000,
      maxSlowdown: 8,
      caseBudgetMs: 120_000,
    });

    expect(failure).toContain("15,000ms");
    expect(failure).toContain("120,000ms");
    expect(failure).toContain("1.00x");
    expect(failure).toContain(`${CASE_BUDGET_MARGIN}x`);
    expect(failure).toContain("6,000ms");
  });

  it("reads the ceiling from the reading, not from this repository", () => {
    // Halving the slowdown ceiling admits twice the base. The relation has
    // three terms and any of them can be the one that moved; a guard that
    // only ever saw this tree's 8x would not know that.
    const admitted = { baseMs: 12_000, caseBudgetMs: 120_000 } as const;

    expect(caseBudgetFailure({ ...admitted, maxSlowdown: 4 })).toBeUndefined();
    expect(caseBudgetFailure({ ...admitted, maxSlowdown: 8 })).toContain(
      "96,000ms"
    );
  });
});

describe("the derivation is checked against the live case budget", () => {
  it("keeps the child's worst case a full margin under the per-case budget", () => {
    // The invariant CodySwannGT/lisa#3202 exists for. `fe1ae1e02` moved the
    // case budget and re-derived ONE of the two constants tied to it; this is
    // what notices the next time that happens, instead of a paragraph nobody
    // re-multiplies.
    expect(
      caseBudgetFailure({
        baseMs: BOUNDED_SPAWN_BASE_MS,
        maxSlowdown: MAX_SPAWN_SLOWDOWN,
        caseBudgetMs: liveCaseBudgetMs(),
      })
    ).toBeUndefined();
  });

  it("cites the testTimeout vitest.config.local.ts actually sets", () => {
    // The other half of the same staleness: the paragraph published a case
    // budget of 300,000ms for months after the config said 120,000ms, and the
    // arithmetic it showed was correct FOR A NUMBER THAT WAS NO LONGER THERE.
    const cited = CITED_CASE_BUDGET.exec(
      readFileSync(path.join(REPO_ROOT, HELPER_SOURCE), "utf8")
    );

    expect(
      cited,
      `no cited testTimeout found in ${HELPER_SOURCE}`
    ).not.toBeNull();
    expect(Number((cited?.[1] ?? "").replaceAll(",", ""))).toBe(
      liveCaseBudgetMs()
    );
  });
});

describe("the guard is attached to real cases, not merely defined", () => {
  it("fails a passing case that consumed too much of its budget", () => {
    const child = runFixtureSuite("0.7");

    expect(child.status).not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toContain(REDUCE_THE_WORK);
  });

  it("leaves a passing case with room to spare alone", () => {
    const child = runFixtureSuite("0.1");

    expect(`${child.stdout}${child.stderr}`).not.toContain(REDUCE_THE_WORK);
    expect(child.status).toBe(0);
  });
});

/**
 * Run the margin-guard fixture under its own vitest configuration.
 *
 * A throwaway config rather than the repository's, so the fixture is collected
 * despite deliberately not being named `*.test.ts` — being uncollectable by the
 * normal run is the point of that name.
 * @param share - Fraction of the quiet-equivalent budget the case should burn
 * @returns Completed child process, statuses and streams included
 */
function runFixtureSuite(share: string): SpawnSyncReturns<string> {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-margin-guard-"));
  const configPath = path.join(directory, "vitest.margin-guard.config.ts");
  temporaryDirectories.push(directory);
  writeFileSync(
    configPath,
    `export default { test: { include: [${JSON.stringify(FIXTURE)}] } };\n`,
    "utf8"
  );
  // A whole child vitest boot, so the toolchain base rather than the fixture
  // one. The child is expected to exit non-zero in the arm where the guard
  // fires, which is a verdict — only a kill is an infrastructure event, and
  // boundedSpawnSync keeps those apart.
  return boundedSpawnSync({
    label: "a child vitest run over the margin-guard fixture",
    command: process.execPath,
    args: [
      path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--root",
      REPO_ROOT,
      "--config",
      configPath,
    ],
    baseMs: 30_000,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CI: "1",
      LISA_MARGIN_GUARD_SHARE: share,
    },
  });
}

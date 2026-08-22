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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IO_LATENCY_TEST_TIMEOUT_MS,
  MARGIN_FRACTION,
  MAX_SPAWN_SLOWDOWN,
  QUIET_SPAWN_LATENCY_MS,
  assertChildCompleted,
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

describe("assertChildCompleted", () => {
  it("accepts a child that exited on its own", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: null }, "packer")
    ).not.toThrow();
  });

  it("names the command and the kill signal instead of an empty stdout", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: "SIGTERM" }, "packer")
    ).toThrow(/packer did not complete: killed by signal SIGTERM/u);
  });

  it("surfaces the runtime error when one is reported", () => {
    expect(() =>
      assertChildCompleted(
        { error: new Error("spawnSync ETIMEDOUT"), signal: null },
        "compiler"
      )
    ).toThrow(/compiler did not complete: spawnSync ETIMEDOUT/u);
  });

  it("reports the measured slowdown so the reader can rule out variance", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: "SIGKILL" }, "packer")
    ).toThrow(new RegExp(`${workerSpawnSlowdown().toFixed(2)}x`, "u"));
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
function runFixtureSuite(share: string): ReturnType<typeof spawnSync> {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-margin-guard-"));
  const configPath = path.join(directory, "vitest.margin-guard.config.ts");
  temporaryDirectories.push(directory);
  writeFileSync(
    configPath,
    `export default { test: { include: [${JSON.stringify(FIXTURE)}] } };\n`,
    "utf8"
  );
  return spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--root",
      REPO_ROOT,
      "--config",
      configPath,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        LISA_MARGIN_GUARD_SHARE: share,
      },
    }
  );
}

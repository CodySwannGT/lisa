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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { resolveGit } from "../../support/git-executable.js";

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

// Every pattern below is written against a TRIMMED, prettier-normalised line
// and uses no adjacent variable-width quantifiers. That is not stylistic: a
// looser `\s*`-and-lazy-quantifier spelling is super-linear on a pathological
// line and `sonarjs/slow-regex` refuses it. Prettier owns the spacing in this
// tree and `format:check` gates it, so the exact-space form is the safe one.

/** A per-case budget spelled as the trailing argument: `}, <budget>);`. */
const TRAILING_BUDGET = /^\}, ([^\s,()]+)\);?$/u;

/** A per-case budget spelled as an options object: `{ timeout: <budget> }`. */
const OPTIONS_BUDGET = /\{ timeout: ([^\s,{}]+) \}/u;

/**
 * The trailing form again, after prettier reflows the call.
 *
 * A budget longer than a numeric literal stops fitting on the closing line, and
 * prettier then breaks `it(name, fn, budget)` across lines so the budget stands
 * alone between the end of the callback and the closing paren. Missing this
 * shape would have made the whole scan a façade: every budget in this tree is
 * written that way, so a scan that only knew `}, N);` would have reported a
 * clean tree while examining nothing.
 */
const LONE_BUDGET = /^([^\s,()]+)$/u;

/** End of the callback argument, on the line above a reflowed budget. */
const CALLBACK_END = "},";

/** Closing paren of a reflowed call, on the line below its budget. */
const CALL_END = ");";

/** A module-scope binding of a bare number, which a budget may hide behind. */
const NUMERIC_BINDING = /^const ([A-Za-z_$][\w$]*) = (\d[\d_]*);$/u;

/**
 * Smallest value treated as a budget rather than as an ordinary argument.
 *
 * A trailing numeric argument is not always a budget — `reduce(fn, 0)` closes
 * the same way — and this scan is syntactic, so it cannot tell them apart by
 * meaning. Every budget in this repository is at least four figures and every
 * incidental trailing number is a small one, so the threshold separates them
 * without an allowlist. A budget under a second would be a hang detector so
 * tight that no subprocess case could survive it.
 */
const SMALLEST_BUDGET_MS = 1_000;

// Built rather than written out, so this suite is not its own counterexample:
// a literal sample would be found by the very scan it exists to exercise.
const TRAILING_SAMPLE = `}, ${"40_000"});`;
const OPTIONS_SAMPLE = `it("x", { timeout: ${"20_000"} }, () => {`;

/**
 * Read a fragment as a bare numeric budget.
 * @param text - Source fragment standing in the budget position
 * @returns Its value, or undefined when it is not a bare number
 */
function bareBudgetValue(text: string): number | undefined {
  if (!/^\d[\d_]*$/u.test(text)) return undefined;
  return Number(text.replaceAll("_", ""));
}

/**
 * Find every uncalibrated per-case budget in one suite's source.
 *
 * Line-oriented and syntactic on purpose. Parsing would report the same thing
 * at ten times the cost, and the defect is legible at exactly this resolution:
 * a number standing where a calibrated call belongs. A budget hidden behind a
 * module-scope constant bound to a bare number counts too — renaming a literal
 * does not calibrate it.
 * @param name - Repository-relative path, for the diagnostic
 * @param source - The suite's source text
 * @returns One `path:line: text` entry per uncalibrated budget
 */
function bareBudgets(name: string, source: string): readonly string[] {
  const lines = source.split("\n").map(line => line.trim());
  const named = new Set(
    lines
      .map(line => NUMERIC_BINDING.exec(line))
      .filter(
        (match): match is RegExpExecArray =>
          match !== null &&
          (bareBudgetValue(match[2] ?? "") ?? 0) >= SMALLEST_BUDGET_MS
      )
      .map(match => match[1])
  );
  const uncalibrated = (budget: string | undefined): boolean =>
    budget !== undefined &&
    ((bareBudgetValue(budget) ?? 0) >= SMALLEST_BUDGET_MS || named.has(budget));
  const budgetAt = (index: number): string | undefined => {
    const line = lines[index] ?? "";
    const inline =
      TRAILING_BUDGET.exec(line)?.[1] ?? OPTIONS_BUDGET.exec(line)?.[1];
    if (inline !== undefined) return inline;
    if (lines[index - 1] !== CALLBACK_END || lines[index + 1] !== CALL_END) {
      return undefined;
    }
    return LONE_BUDGET.exec(line)?.[1];
  };

  return lines
    .map((line, index) => ({ at: index + 1, line }))
    .filter(({ at }) => uncalibrated(budgetAt(at - 1)))
    .map(({ at, line }) => `${name}:${at}: ${line}`);
}

/**
 * The unit suites the pre-push `test-correctness` gate actually runs.
 *
 * Derived from `git ls-files` rather than a hardcoded roster: a hand-written
 * list stops covering the tree the moment somebody adds a suite, and the
 * omission is silent.
 * @returns Repository-relative paths of the tracked unit suites
 */
function trackedUnitSuites(): readonly string[] {
  // `resolveGit()` rather than a bare "git": the lint ruleset refuses a
  // command resolved through a writeable PATH (`sonarjs/no-os-command-from-path`).
  const listed = spawnSync(resolveGit(), ["ls-files", "tests/unit"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: ioLatencyBudgetMs(30_000),
  });
  assertChildCompleted(listed, "git ls-files tests/unit");
  return listed.stdout.split("\n").filter(name => name.endsWith(".test.ts"));
}

describe("no unit suite hands vitest an uncalibrated budget", () => {
  // CodySwannGT/lisa#2894. A per-case budget silently overrides the file-level
  // one, so raising `vitest.config.local.ts` does nothing wherever a literal
  // exists — and does nothing without saying so. That has put the pre-push
  // gate red twice: once against the 60s CodySwannGT/lisa#2885 replaced, and
  // again against the `40_000` that survived CodySwannGT/lisa#2888's raise and
  // killed a case whose siblings measured 52.9s to 75.3s.
  //
  // The remedy is not a bigger number. A fixed wall-clock budget over a
  // subprocess measures the machine (CodySwannGT/lisa#2822), so the next box
  // invalidates it again — this one has been re-derived three times already.
  // It is `ioLatencyBudgetMs`, which is clamped at 1 from below and can
  // therefore only ever widen a base, never tighten one.
  //
  // Scoped to `tests/unit` deliberately. `tests/integration` legitimately
  // carries fixed budgets sized by an external tool's own bound — the mutation
  // gates' 900s and 1.8Ms — where a machine multiplier on top would mean
  // nothing.

  it("finds a bare budget in either syntactic form", () => {
    expect(bareBudgets("suite.ts", TRAILING_SAMPLE)).toEqual([
      `suite.ts:1: }, ${"40_000"});`,
    ]);
    expect(bareBudgets("suite.ts", OPTIONS_SAMPLE)).toEqual([
      `suite.ts:1: it("x", { timeout: ${"20_000"} }, () => {`,
    ]);
  });

  it("finds one hidden behind a name, because renaming is not calibrating", () => {
    const source = [`const SLOW_MS = ${"30_000"};`, "  }, SLOW_MS);"].join(
      "\n"
    );

    expect(bareBudgets("suite.ts", source)).toEqual([
      "suite.ts:2: }, SLOW_MS);",
    ]);
  });

  it("finds one after prettier has broken the call across lines", () => {
    // The shape every budget in this tree actually has. A scan that knew only
    // the single-line spelling would report this file clean.
    const source = [
      "  it(",
      '    "a case",',
      "    () => {",
      "      expect(true).toBe(true);",
      "    },",
      `    ${"180_000"}`,
      "  );",
    ].join("\n");

    expect(bareBudgets("suite.ts", source)).toEqual([
      `suite.ts:6: ${"180_000"}`,
    ]);
  });

  it("leaves a calibrated budget, and a number that is not one, alone", () => {
    // The last three lines are the false positives a coarser scan produces: a
    // small trailing argument that closes an ordinary call, a trailing numeric
    // argument that is not a budget, and a `setTimeout` inside a string literal
    // that a fixture writes out as another program's source.
    const source = [
      "const SLOW_MS = ioLatencyBudgetMs(30_000);",
      "  }, SLOW_MS);",
      "  }, ioLatencyBudgetMs(30_000));",
      "  { timeout: ioLatencyBudgetMs(20_000) },",
      "  }, 0);",
      "        graceFor({ first_seen: RECENTLY, grace_days: 14 }, 7)",
      '      "setTimeout(() => {}, 600000);\\n",',
    ].join("\n");

    expect(bareBudgets("suite.ts", source)).toEqual([]);
  });

  it("finds none in the tree the pre-push unit gate runs", () => {
    const offenders = trackedUnitSuites().flatMap(name =>
      bareBudgets(name, readFileSync(path.join(REPO_ROOT, name), "utf8"))
    );

    expect(
      offenders,
      "A per-case budget overrides the file-level one silently. Wrap it in " +
        "ioLatencyBudgetMs(...) so it scales with the machine, or drop it " +
        "where the file already calls useIoLatencyBudget()."
    ).toEqual([]);
  });
});

/**
 * No test suite hands vitest an uncalibrated per-case budget.
 *
 * A per-case budget silently OVERRIDES the file-level one, so raising
 * `vitest.config.local.ts` does nothing wherever a literal exists — and does
 * nothing without saying so. That has put the pre-push gate red three times:
 * against the 60s CodySwannGT/lisa#2885 replaced, against the `40_000` that
 * survived CodySwannGT/lisa#2888's raise and killed a case whose siblings
 * measured 52.9s to 75.3s, and against a `}, 30_000)` that refused six branches
 * at 4.9% headroom.
 *
 * The remedy is not a bigger number. A fixed wall-clock budget over a
 * subprocess measures the machine (CodySwannGT/lisa#2822), so the next box
 * invalidates it again — this one has been re-derived three times already. It
 * is `ioLatencyBudgetMs`, which is clamped at 1 from below and can therefore
 * only ever widen a base, never tighten one.
 *
 * ## Why the scan is not keyed on one spelling
 *
 * CodySwannGT/lisa#2897: a budget has at least six spellings and half of them
 * are invisible to the obvious `}, N)` grep — the options object, the budget
 * reflowed onto its own line by prettier, and the budget bound to a named
 * constant. Seven uncounted budgets hid in the named form alone, two of them
 * real caps sitting BELOW the file-level budget and silently overriding it. Any
 * inventory keyed on one spelling under-reports, so this one knows all of them
 * and each is exercised against a sample below.
 *
 * @module tests/unit/helpers/test-budget-conformance
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

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
 * Whether a line is commentary rather than code.
 *
 * Found the hard way: this suite's own comment about the options spelling was
 * reflowed by prettier so the literal it names landed on a `//` line, and the
 * scan reported the guard as its own offender. A budget written in prose runs
 * nothing, and a doc comment discussing a budget is how a scan like this gets
 * explained. Commented-out code is covered by the same rule and correctly so —
 * it is not a budget until somebody uncomments it, at which point the line
 * stops being prose and the scan sees it.
 * @param line - One trimmed source line
 * @returns Whether the line is a comment
 */
function isProse(line: string): boolean {
  return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*");
}

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
      .filter(line => !isProse(line))
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
    if (isProse(line)) return undefined;
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
 * Suites whose budgets are sized by an external tool's own bound, with why.
 *
 * A directory-wide exclusion is what this list replaces, and the replacement is
 * the point: `tests/integration` was skipped wholesale on the strength of these
 * two files, which left FOUR uncalibrated budgets in that directory unexamined
 * — three `}, 180_000)` / `}, 120_000)` and one reflowed `30_000` that no
 * single-spelling grep would have found either. An allowlist added to harden a
 * guard becomes the bypass unless every entry is named and reasoned, so each
 * entry carries its reason and the case below refuses a stale one.
 *
 * Both entries are Stryker runs. Stryker enforces its own per-mutant timeout
 * and reports its own progress, so the vitest budget over it is a containment
 * bound on a tool that is already bounded — and scaling a 30-minute containment
 * bound by a machine multiplier would produce a four-hour one, which is not a
 * bound at all.
 */
const EXTERNALLY_BOUNDED: Readonly<Record<string, string>> = {
  "tests/integration/mutation-gate-bite.test.ts":
    "a full Stryker run, bounded by Stryker's own timeout, not by the machine",
  "tests/integration/mutation-gate-diff-bite.test.ts":
    "a diff-scoped Stryker run, bounded the same way",
};

/**
 * Every tracked test suite in the repository.
 *
 * Derived from `git ls-files` rather than a hardcoded roster: a hand-written
 * list stops covering the tree the moment somebody adds a suite, and the
 * omission is silent.
 *
 * `tests`, not `tests/unit`. The narrower scope was itself a silent hole — the
 * pre-push gate runs the integration tree too, and the budget that refused six
 * branches was an inline one (CodySwannGT/lisa#2895). A guard scoped to where
 * the last defect happened to land is a guard the next one walks around.
 * @returns Repository-relative paths of the tracked test suites
 */
function trackedTestSuites(): readonly string[] {
  // `resolveGit()` rather than a bare "git": the lint ruleset refuses a
  // command resolved through a writeable PATH (`sonarjs/no-os-command-from-path`).
  const listed = boundedSpawnSync({
    label: "git ls-files tests",
    command: resolveGit(),
    args: ["ls-files", "tests"],
    cwd: REPO_ROOT,
    baseMs: 30_000,
  });
  return listed.stdout.split("\n").filter(name => name.endsWith(".test.ts"));
}

/**
 * Read a suite's source from disk.
 * @param name - Repository-relative path
 * @returns The file's text
 */
function sourceOf(name: string): string {
  return readFileSync(path.join(REPO_ROOT, name), "utf8");
}

describe("no test suite hands vitest an uncalibrated budget", () => {
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

  it("leaves a budget written in prose alone, because prose runs nothing", () => {
    // The regression that produced this case: prettier reflowed this suite's
    // own comment so the literal it discusses landed on a `//` line, and the
    // scan named the guard as its own offender.
    const source = [
      `    // The spelling \`{ timeout: ${"1_800_000"} },\` standing alone.`,
      `     * A budget of ${"180_000"} was measured here.`,
      `    // }, ${"40_000"});`,
    ].join("\n");

    expect(bareBudgets("suite.ts", source)).toEqual([]);
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

  it("finds one in the options form prettier reflows onto its own line", () => {
    // An options object standing alone on its own line. Both mutation suites
    // are written that way, so a scan that required the `it(` on the same line
    // would have reported them clean — and the exemption below would have been
    // guarding nothing.
    const source = [
      "  () => {",
      "    run();",
      "  },",
      `  { timeout: ${"900_000"} },`,
    ].join("\n");

    expect(bareBudgets("suite.ts", source)).toEqual([
      `suite.ts:4: { timeout: ${"900_000"} },`,
    ]);
  });

  it("finds none in the tree the pre-push gates run", () => {
    const offenders = trackedTestSuites()
      .filter(name => EXTERNALLY_BOUNDED[name] === undefined)
      .flatMap(name => bareBudgets(name, sourceOf(name)));

    expect(
      offenders,
      "A per-case budget overrides the file-level one silently. Wrap it in " +
        "ioLatencyBudgetMs(...) so it scales with the machine, or drop it " +
        "where the file already calls useIoLatencyBudget()."
    ).toEqual([]);
  });

  it("refuses an exemption that has gone stale", () => {
    // An allowlist is a hole in a guard, and a hole nobody re-checks widens.
    // Every entry has to still name a tracked suite that still carries a bare
    // budget; the moment one does not, the entry is buying silence for nothing
    // and has to be deleted rather than carried.
    const tracked = new Set(trackedTestSuites());
    const stale = Object.keys(EXTERNALLY_BOUNDED).filter(
      name =>
        !tracked.has(name) || bareBudgets(name, sourceOf(name)).length === 0
    );

    expect(
      stale,
      "An exemption that no longer names a tracked suite carrying a bare " +
        "budget is dead weight in a guard. Delete the entry."
    ).toEqual([]);
  });
});

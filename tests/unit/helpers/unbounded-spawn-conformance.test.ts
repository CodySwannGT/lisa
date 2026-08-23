/**
 * No test in this tree starts a program without a deadline.
 *
 * CodySwannGT/lisa#2940. 326 callsites under `tests/` started a child and
 * waited for it with nothing that could give up. Two things make that worse
 * than it sounds. `spawnSync` blocks the worker's event loop, so vitest's
 * per-case budget — a timer on that loop — cannot fire for the one case it was
 * written for; and a child killed from outside returns EMPTY streams, so the
 * assertion below it fails as a content mismatch and the word timeout never
 * appears. One such child was watched sitting at 0% CPU in state `U` for 15:04.
 *
 * It is a correctness fix rather than tidying. A mutation run scores a
 * timed-out mutant as KILLED, so an unbounded child under a mutate target
 * inflates that target's score: bounding six spawns in one target took it from
 * 48m03s to 24m51s and its score from 63.05 to 56.97 — roughly 129 mutants had
 * been counted as detected because the box was slow.
 *
 * ## No allowlist, no grandfather list, no count ceiling
 *
 * Every arm below scans the whole tracked test tree and every one of them must
 * come back empty. There is no exemption map here on purpose: an allowlist
 * added to harden a guard has already become the way around one in this
 * repository, and a ratchet solves for not being able to fix them all when
 * they can all be fixed.
 * @module tests/unit/helpers/unbounded-spawn-conformance
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutFiles } from "../../helpers/tracked-files.js";
import { unboundedSpawns } from "../../helpers/unbounded-spawn-scan.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Stand-in path the detector's control cases are reported against. */
const SAMPLE = "tests/sample.ts";

/**
 * A source containing one unbounded child start, built rather than written.
 *
 * Assembled from fragments so this suite is not its own counterexample: a
 * literal call here would be found by the very scan it exists to exercise, and
 * the guard would report itself.
 */
const UNBOUNDED_SAMPLE = [
  `import { ${"spawnSync"} } from "node:child_process";`,
  "",
  "export function run(): void {",
  `  ${"spawnSync"}("/bin/echo", ["hello"], { encoding: "utf8" });`,
  "}",
].join("\n");

/** The same call, with the deadline the tree requires. */
const BOUNDED_SAMPLE = UNBOUNDED_SAMPLE.replace(
  '{ encoding: "utf8" }',
  '{ encoding: "utf8", timeout: ioLatencyBudgetMs(15_000) }'
);

/**
 * Every tracked TypeScript file under `tests/`.
 *
 * `checkoutFiles` rather than a walk or a hardcoded roster: the index is
 * exactly what a commit can carry, and it still answers inside Stryker's
 * sandbox copy, which has no `.git` of its own and would otherwise make this
 * roster empty during a mutation run — a green scan over nothing.
 * @returns Repository-relative paths of the tracked test-tree sources
 */
function trackedTestSources(): readonly string[] {
  return checkoutFiles(REPO_ROOT).filter(
    name => name.startsWith("tests/") && name.endsWith(".ts")
  );
}

describe("every synchronous child start in the test tree carries a deadline", () => {
  it("flags a spawn with no timeout, naming the file and the line", () => {
    // The positive control. Without it a clean tree and a broken detector are
    // indistinguishable, and the arms below would be permanently green for the
    // wrong reason.
    expect(unboundedSpawns(SAMPLE, UNBOUNDED_SAMPLE)).toEqual([
      `${SAMPLE}:4: ${"spawnSync"}`,
    ]);
  });

  it("leaves the same call alone once it states a deadline", () => {
    expect(unboundedSpawns(SAMPLE, BOUNDED_SAMPLE)).toEqual([]);
  });

  it("flags every synchronous form, because one import style is not a rule", () => {
    const source = [
      `${"execFileSync"}("/bin/echo", ["hi"]);`,
      `${"execSync"}("echo hi");`,
      `childProcess.${"spawnSync"}("/bin/echo", []);`,
    ].join("\n");

    expect(unboundedSpawns(SAMPLE, source)).toEqual([
      `${SAMPLE}:1: ${"execFileSync"}`,
      `${SAMPLE}:2: ${"execSync"}`,
      `${SAMPLE}:3: ${"spawnSync"}`,
    ]);
  });

  it("reads a call prettier has broken across lines", () => {
    // The shape most calls in this tree actually have. A line-oriented scan
    // pairs the callee with whatever options object shares its line, which for
    // a reflowed call is the wrong one or none.
    const source = [
      `  ${"spawnSync"}(`,
      "    BIN,",
      '    ["--version"],',
      "    {",
      '      cwd: "/tmp",',
      "    }",
      "  );",
    ].join("\n");

    expect(unboundedSpawns(SAMPLE, source)).toEqual([
      `${SAMPLE}:1: ${"spawnSync"}`,
    ]);
  });

  it("leaves a call that only appears inside a string or a comment alone", () => {
    // A fixture writes another program's source as a template literal, and a
    // grep reports an offender that does not exist. The regression that makes
    // this a case rather than a claim: `safety-net-guard-fixtures.ts` embeds
    // `execSync` inside the source of a child script it writes to disk.
    const source = [
      `// ${"spawnSync"}("/bin/echo", []) is what this used to do.`,
      `const script = \`node -e "require('child_process').${"execSync"}('ls')"\`;`,
      `const named = "${"execFileSync"}";`,
    ].join("\n");

    expect(unboundedSpawns(SAMPLE, source)).toEqual([]);
  });

  it("finds none in the tracked test tree", () => {
    const offenders = trackedTestSources().flatMap(name =>
      unboundedSpawns(name, readFileSync(path.join(REPO_ROOT, name), "utf8"))
    );

    expect(
      offenders,
      "A synchronous child start with no deadline makes the per-case budget " +
        "unenforceable, and a child killed from outside returns empty streams " +
        "so the failure reads as a content mismatch. Start it through " +
        "boundedSpawnSync / boundedExecFileSync in " +
        "tests/helpers/io-latency-budget.ts, which pairs the deadline with the " +
        "assertion that names a kill. There is no exemption list."
    ).toEqual([]);
  });

  it("scans a tree that is actually there", () => {
    // A roster that quietly resolves to nothing turns the arm above into a
    // check on the empty set — the exact façade this guard exists to remove.
    expect(trackedTestSources().length).toBeGreaterThan(100);
  });
});

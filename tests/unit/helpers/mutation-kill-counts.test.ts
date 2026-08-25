/**
 * The contribution check, against a real Stryker report.
 *
 * ## Provenance of the fixture, because an invented one would prove nothing
 *
 * `tests/fixtures/stryker-json-report/two-guard-one-starved.json` is the JSON
 * report of an actual run of the COMMITTED gate configuration on this
 * repository, 2026-08-24, 9.2 s wall clock: `mutate` narrowed to two guards and
 * `LISA_MUTATION_SUITES` set to only the first one's suites. Its clear-text
 * table, transcribed from the same run:
 *
 * ```
 * File                        |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
 * All files                   |  45.94 |   96.08 |      147 |         0 |          6 |      167 |        0 |
 *  lisa-destructive-guard.mjs |  96.08 |   96.08 |      147 |         0 |          6 |        0 |        0 |
 *  lisa-floor-collisions.mjs  |   0.00 |    0.00 |        0 |         0 |          0 |      167 |        0 |
 * ```
 *
 * So the fixture holds **both** halves of what this file has to prove, in one
 * real report: a guard that genuinely contributed (147 kills) and a guard
 * starved of its suites (0 kills, 167 uncovered) — the exact state
 * CodySwannGT/lisa#2992 describes. The repository has been bitten by invented
 * fixtures before, which is why this is a recording rather than a construction.
 *
 * Trimmed for size only: mutant `replacement` and `statusReason` dropped, file
 * `source` bodies emptied, the `config`/`testFiles`/`framework` blocks dropped,
 * and `projectRoot` redacted. Every `status` is exactly as Stryker wrote it, so
 * the counts below are the run's own.
 * @module tests/unit/helpers/mutation-kill-counts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertGuardsContributedKills,
  killCounts,
  readReport,
} from "../../helpers/mutation-kill-counts.js";

const FIXTURE = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "stryker-json-report",
  "two-guard-one-starved.json"
);

/** The guard whose four suites ran: 147 killed, 6 survived, 28 ignored. */
const CONTRIBUTOR = "all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

/** The guard whose suites were withheld: 0 killed, 167 uncovered. */
const STARVED = "all/copy-overwrite/scripts/lisa-floor-collisions.mjs";

const fixture = (): string => fs.readFileSync(FIXTURE, "utf8");

describe("killCounts, over a real Stryker JSON report", () => {
  it("reads the same per-file kill counts the clear-text table reported", () => {
    const counts = killCounts(fixture(), "fixture");

    expect(counts.get(CONTRIBUTOR)).toEqual({
      killed: 147,
      timeout: 0,
      total: 181,
    });
    expect(counts.get(STARVED)).toEqual({ killed: 0, timeout: 0, total: 167 });
  });

  it("keys files by the repo-relative path the mutate list uses", () => {
    const byName = (left: string, right: string): number =>
      left.localeCompare(right);

    expect([...killCounts(fixture(), "fixture").keys()].sort(byName)).toEqual(
      [CONTRIBUTOR, STARVED].sort(byName)
    );
  });
});

describe("assertGuardsContributedKills", () => {
  // The negative control. Without this a check that failed EVERYTHING would
  // pass the case below and look like a working guard.
  it("passes a guard that genuinely contributed kills", () => {
    expect(() =>
      assertGuardsContributedKills(
        killCounts(fixture(), "intact"),
        [CONTRIBUTOR],
        "intact"
      )
    ).not.toThrow();
  });

  // The case CodySwannGT/lisa#2992 describes, on real Stryker output: a guard
  // whose suites contributed nothing, so withholding them removes nothing.
  it("fails a withheld guard that killed nothing in the intact run", () => {
    expect(() =>
      assertGuardsContributedKills(
        killCounts(fixture(), "intact"),
        [STARVED],
        "intact"
      )
    ).toThrow(/killed 0 of its 167 mutants in the intact run/);
  });

  it("fails a withheld guard the run never mutated at all", () => {
    expect(() =>
      assertGuardsContributedKills(
        killCounts(fixture(), "intact"),
        ["all/copy-overwrite/scripts/not-in-this-run.mjs"],
        "intact"
      )
    ).toThrow(/does not mutate it/);
  });

  it("fails rather than passing vacuously when no guards are named", () => {
    expect(() =>
      assertGuardsContributedKills(
        killCounts(fixture(), "intact"),
        [],
        "intact"
      )
    ).toThrow(/vacuously/);
  });
});

describe("every way the data can be absent is a failure, never a pass", () => {
  it("fails when the run wrote no report at all", () => {
    expect(() =>
      readReport(
        path.join(path.dirname(FIXTURE), "no-such-report.json"),
        "intact"
      )
    ).toThrow(/wrote no JSON report/);
  });

  it("fails when the report is not parseable JSON", () => {
    expect(() => killCounts("{ truncated", "intact")).toThrow(
      /could not be parsed/
    );
  });

  it("fails when the report has no files object", () => {
    expect(() =>
      killCounts(JSON.stringify({ schemaVersion: "1.0" }), "intact")
    ).toThrow(/has no "files" object/);
  });

  it("fails when the report names zero mutated files", () => {
    expect(() => killCounts(JSON.stringify({ files: {} }), "intact")).toThrow(
      /names zero mutated files/
    );
  });

  it("fails when a file entry carries no mutants array", () => {
    expect(() =>
      killCounts(JSON.stringify({ files: { "a/b.mjs": {} } }), "intact")
    ).toThrow(/no mutants array for a\/b\.mjs/);
  });
});

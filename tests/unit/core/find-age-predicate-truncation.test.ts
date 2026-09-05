/**
 * The day-truncating `find` age predicates, measured rather than asserted
 * (CodySwannGT/lisa#3905).
 *
 * ## The defect
 *
 * `find -mtime +N` does NOT mean "older than N days". `find` divides the age by
 * 86400 and DISCARDS the remainder, so `-mtime +2` matches only files older
 * than **three** days. Anyone writing `-mtime +2` intending "older than two
 * days" silently under-selects by a full 24 hours.
 *
 * The direction is what makes it dangerous: the under-selection reports
 * "nothing to do". Nobody questions an empty result from a cleanup predicate,
 * so it prevents needed work rather than causing visible harm. It reproduced
 * live during a `$TMPDIR` sweep where a node scan counted 5,232 entries at age
 * >= 2 days and `find -mtime +2` returned 0 — both correct answers to different
 * questions, because every one of those 5,232 sat inside the 2-3 day band.
 *
 * It was first reported — by the same person who then disproved it — as a
 * BROKEN INSTRUMENT producing false zeros. That is wrong and is the reason this
 * file measures instead of asserting: `find` is answering a different question
 * than the flag appears to ask, which is exactly why the form survives review.
 *
 * ## Why a fixture at 10 days would prove nothing
 *
 * The two predicates AGREE everywhere except the N-to-N+1 day band. A test
 * written over a 10-day-old file passes under both readings and pins neither.
 * The boundary is the whole measurement, so the ages below are chosen to sit
 * either side of it with an hour of margin — never on it, because a case that
 * has to win a race against its own setup is not a control.
 *
 * ## Portability
 *
 * The truncation is POSIX, not a BSD quirk: GNU `find` documents the same
 * behaviour ("any fractional part is ignored"), and this was cross-checked here
 * against both `/usr/bin/find` and `bfs 4.1.1` on Darwin, which agreed. So this
 * case is expected to hold on the Linux runner as well as on a developer's Mac.
 *
 * What is NOT portable is the REMEDY's timestamp: `date -v-2d` is BSD/macOS and
 * `date -d '2 days ago'` is GNU/Linux. That asymmetry is why the shipped
 * guidance recommends `-mmin`, which needs no date arithmetic at all — and this
 * file therefore uses `utimes` rather than shelling out to `date`.
 *
 * The RULE that refuses the truncating form is covered separately, in
 * `tests/unit/config/ast-grep-template.test.ts`, because it has to be proved
 * against all four shipped copies rather than the one this repository scans
 * itself with. This file owns the PREMISE the rule's message asserts.
 * @module tests/unit/core/find-age-predicate-truncation
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** Seconds in an hour, named so the age table below reads as hours. */
const SECONDS_PER_HOUR = 3600;

/**
 * `find`, by absolute path.
 *
 * Absolute because `boundedExecFileSync` requires it, and deliberately the
 * system binary rather than whatever a developer's `PATH` resolves: this case
 * is a statement about the instrument, so it has to name which one it measured.
 * @returns The first system `find` that exists.
 */
const systemFind = (): string => {
  const candidates = ["/usr/bin/find", "/bin/find"];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `No system find at any of: ${candidates.join(", ")}. This case measures ` +
        "an instrument, so a missing instrument is a failure and never a skip."
    );
  }
  return found;
};

/**
 * File ages, in hours, either side of the two-day boundary.
 *
 * 47 and 73 are an hour clear of 48 and 72 so neither can be decided by how
 * long the setup took. 49 and 71 are the band the two predicates disagree over.
 */
const AGES_HOURS = [47, 49, 71, 73, 95] as const;

/**
 * A file's name, derived from its age so a failure names the age directly.
 * @param hours - The fixture's age in hours.
 * @returns The basename to create.
 */
const nameFor = (hours: number): string => `age-${hours}h`;

/**
 * Run `find` over `dir` with one predicate, and return the basenames it matched.
 * @param dir - The fixture directory.
 * @param predicate - The age predicate and its argument, e.g. `["-mtime", "+2"]`.
 * @returns Matched basenames, sorted.
 */
const matched = (dir: string, predicate: readonly string[]): string[] =>
  boundedExecFileSync({
    label: `find ${predicate.join(" ")}`,
    command: systemFind(),
    args: [dir, "-maxdepth", "1", "-type", "f", ...predicate],
  })
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => path.basename(line.trim()))
    // An explicit comparator: a bare `.sort()` compares UTF-16 code units, and
    // this list is the subject of every assertion below.
    .sort((left, right) => left.localeCompare(right));

describe("find's day-truncating age predicates (#3905)", () => {
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-find-age-"));
    const now = Date.now() / 1000;
    for (const hours of AGES_HOURS) {
      const file = path.join(dir, nameFor(hours));
      fs.writeFileSync(file, "");
      const stamp = now - hours * SECONDS_PER_HOUR;
      fs.utimesSync(file, stamp, stamp);
    }
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("-mtime +2 matches only files older than THREE days", () => {
    // The exact set, not a membership check: a `toContain` assertion here would
    // be satisfied by a predicate that also returned the whole directory.
    expect(matched(dir, ["-mtime", "+2"])).toEqual(["age-73h", "age-95h"]);
  });

  it("-mmin +2880 matches every file older than two days, as it reads", () => {
    expect(matched(dir, ["-mmin", "+2880"])).toEqual([
      "age-49h",
      "age-71h",
      "age-73h",
      "age-95h",
    ]);
  });

  it("names the 49h-71h band as the entire disagreement", () => {
    // Stated as its own case because the two above could both be right while
    // the claim the rule's message makes — that the gap is a full day wide and
    // sits between N and N+1 — was wrong.
    const byDays = matched(dir, ["-mtime", "+2"]);
    const byMinutes = matched(dir, ["-mmin", "+2880"]);

    expect(byMinutes.filter(name => !byDays.includes(name))).toEqual([
      "age-49h",
      "age-71h",
    ]);
    expect(byDays.filter(name => !byMinutes.includes(name))).toEqual([]);
  });

  it("CONTROL: -mtime +N is exactly -mmin +((N+1)*1440), not broken", () => {
    // Without this the cases above are consistent with `-mtime` being broken
    // outright, which is the mischaracterisation #3905 exists to correct. Only
    // an agreement measured on the same directory rules it out, and stating it
    // as the N+1 equivalence says WHICH question `-mtime` answers rather than
    // merely that it answers a different one.
    //
    // 4320 minutes is 72 hours, one day past the two the flag names.
    expect(matched(dir, ["-mtime", "+2"])).toEqual(["age-73h", "age-95h"]);
    expect(matched(dir, ["-mmin", "+4320"])).toEqual(["age-73h", "age-95h"]);
  });
});

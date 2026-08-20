/**
 * An unparseable BASELINE must not disable the ratchet for that file.
 *
 * The asymmetry was the tell: an unparseable CURRENT file produced an
 * `unparseable` finding, while an unparseable baseline returned no findings at
 * all. That does not merely miss one change — once a malformed threshold file
 * is on the base branch, every later pull request compares against a baseline
 * that yields no constraints, so the ratchet stops having an opinion about
 * that file until someone happens to fix the JSON.
 *
 * A UTF-8 BOM is the realistic route in: an editor writes one on save, the
 * file still reads correctly in a diff and in most viewers, and `JSON.parse`
 * rejects it.
 *
 * Imported STATICALLY and by relative path for the reason
 * `threshold-ratchet.test.ts` documents: a runtime-assembled URL is invisible
 * to Vite's module graph and drops the ratchet's mutants out of the gate.
 * @module tests/unit/scripts/threshold-ratchet-baseline
 */
import { describe, expect, it } from "vitest";

import { compareFile } from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";

const VITEST_FILE = "vitest.thresholds.json";
const LISA_CONFIG = ".lisa.config.json";

/** A well-formed baseline: the coverage floor as it stands. */
const TIGHT = JSON.stringify({ global: { lines: 90 } });

/** The same file loosened 90 → 10, which the ratchet exists to catch. */
const LOOSENED = JSON.stringify({ global: { lines: 10 } });

/** What an editor writes on save, and what `JSON.parse` rejects. */
const BOM = "﻿";

describe("a baseline the ratchet cannot parse", () => {
  it("is reported when the current file loosens a threshold", () => {
    // Before the fix `if (base === undefined) return []` swallowed this
    // entirely: a 90 → 10 loosening produced zero findings.
    const findings = compareFile(VITEST_FILE, `${BOM}${TIGHT}`, LOOSENED);

    expect(findings).not.toHaveLength(0);
  });

  it("names the baseline, not the current file", () => {
    // An operator told "vitest.thresholds.json is not valid JSON" would open
    // the current file, find it well-formed, and conclude the gate is broken.
    // The defect is at the base ref.
    const [finding] = compareFile(VITEST_FILE, `${BOM}${TIGHT}`, LOOSENED);

    expect(finding?.type).toBe("unparseable-baseline");
    expect(finding?.file).toBe(VITEST_FILE);
    expect(finding?.message).toContain("baseline");
  });

  it("fires on a trailing comma", () => {
    const trailing = '{ "global": { "lines": 90, } }';

    expect(compareFile(VITEST_FILE, trailing, LOOSENED)).not.toHaveLength(0);
  });

  it("fires on an empty baseline file", () => {
    expect(compareFile(VITEST_FILE, "", LOOSENED)).not.toHaveLength(0);
  });

  it("fires even when the current file is unchanged", () => {
    // The ratchet is disabled for the file from the moment the baseline breaks,
    // so the report must not wait for someone to also loosen a threshold.
    expect(compareFile(VITEST_FILE, `${BOM}${TIGHT}`, TIGHT)).not.toHaveLength(
      0
    );
  });
});

describe("cases an unparseable baseline must not be confused with", () => {
  it("a file absent from the base ref is still new, not malformed", () => {
    // `git show` returns null for a path that does not exist at the ref, and
    // the caller distinguishes absent from present-but-unreadable with
    // `cat-file -e`. A new gate file has nothing to weaken.
    expect(compareFile(VITEST_FILE, null, LOOSENED)).toHaveLength(0);
  });

  it("a well-formed baseline with an unchanged current file is clean", () => {
    expect(compareFile(VITEST_FILE, TIGHT, TIGHT)).toHaveLength(0);
  });

  it("a well-formed baseline still catches the loosening", () => {
    const findings = compareFile(VITEST_FILE, TIGHT, LOOSENED);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe("weakened");
  });

  it("an unparseable CURRENT file is still reported as such", () => {
    const [finding] = compareFile(VITEST_FILE, TIGHT, "{oops");

    expect(finding?.type).toBe("unparseable");
  });

  it("an unparseable allow-list baseline stays silent, as its current side does", () => {
    // Symmetry with the current-side carve-out, and for the same reason: an
    // allow list nobody can read grants no exceptions, so both sides already
    // fail closed. Reporting it would block every change touching the file
    // without making anything safer.
    expect(compareFile(LISA_CONFIG, `${BOM}{}`, "{}")).toHaveLength(0);
  });
});

/**
 * Regression tests for CodySwannGT/lisa#3856 — a threshold-ratchet exemption
 * must be able to END.
 *
 * `thresholdRatchet.allow` entries are the human-approved way for a weakening
 * to pass the ratchet. They had no expiry, no review and no removal path, and
 * nothing read the `reason`, so an exemption granted for a temporary condition
 * outlived the condition and kept applying forever. The set of gates actually
 * enforced therefore shrank monotonically while every individual decision that
 * shrank it was correct at the time.
 *
 * The shape is taken from `_thresholdsDivergence` (src/sync/
 * stryker-thresholds-ownership.ts), the one exemption surface in this
 * repository that already stops exempting when it goes stale: it records the
 * live condition, its reason must say what resolves it, and once resolved it
 * reports itself stale and names the remedy.
 *
 * BITE, both directions, per the ticket:
 *   - an exemption whose condition has passed no longer applies (expired)
 *   - an exemption whose condition still holds still applies (live)
 * Without the second this would red-wall every project carrying a valid
 * exception; without the first the expiry would lapse into "allowed", which is
 * worse than no expiry at all.
 *
 * Modules are imported STATICALLY and by relative path for the same reason
 * threshold-ratchet.test.ts documents: a runtime-assembled URL is invisible to
 * Vite's module graph, so the mutation gate reports every mutant in both
 * modules as uncovered.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyAllowList,
  compareFile,
  describeAllowList,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import {
  allowEntryExpiry,
  classifyAllowEntry,
  extractAllowEntries,
} from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const VITEST_FILE = "vitest.thresholds.json";
const LISA_CONFIG_FILE = ".lisa.config.json";
const KEY_LINES = "global.lines";

/** The named day an exemption in these fixtures is live through. */
const UNTIL_DAY = "2026-06-15";
/** Inside that day, UTC — the exemption is live. */
const WHILE_LIVE = Date.UTC(2026, 5, 15, 23, 59, 59);
/** The first instant of the next day, UTC — the exemption has ended. */
const AFTER_EXPIRY = Date.UTC(2026, 5, 16, 0, 0, 0);

const MIGRATION_REASON =
  "Coverage suite mid-rewrite; resolved when the rewrite lands.";

/** One `weakened` finding: a coverage minimum dropped from 70 to 50. */
function loweredCoverage(): ReturnType<typeof compareFile> {
  return compareFile(
    VITEST_FILE,
    JSON.stringify({ global: { lines: 70, branches: 70 } }),
    JSON.stringify({ global: { lines: 50, branches: 70 } })
  );
}

describe("threshold-ratchet exemption expiry (#3856)", () => {
  describe("an exemption whose condition has ended no longer applies", () => {
    it("refuses the weakening the expired entry used to permit", () => {
      const findings = loweredCoverage();
      expect(findings).toHaveLength(1);
      const { blocked, allowed, expired } = applyAllowList(
        findings,
        [
          {
            file: VITEST_FILE,
            key: KEY_LINES,
            reason: MIGRATION_REASON,
            until: UNTIL_DAY,
          },
        ],
        AFTER_EXPIRY
      );
      expect(allowed).toHaveLength(0);
      expect(blocked).toHaveLength(1);
      expect(expired).toHaveLength(1);
    });

    it("names the entry, the file it covered and what to do", () => {
      const { expired } = applyAllowList(
        loweredCoverage(),
        [
          {
            file: VITEST_FILE,
            key: KEY_LINES,
            reason: MIGRATION_REASON,
            until: UNTIL_DAY,
          },
        ],
        AFTER_EXPIRY
      );
      const message = expired[0]?.message ?? "";
      expect(message).toContain("thresholdRatchet.allow");
      expect(message).toContain(VITEST_FILE);
      expect(message).toContain(KEY_LINES);
      expect(message).toContain(UNTIL_DAY);
      expect(message).toContain(MIGRATION_REASON);
      expect(message).toContain("Delete it");
    });

    it("reports the stale entry even when nothing changed under it", () => {
      const lines = describeAllowList(
        [{ file: VITEST_FILE, key: KEY_LINES, until: UNTIL_DAY }],
        AFTER_EXPIRY
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("expired");
    });
  });

  describe("a live exemption still applies", () => {
    it("permits the weakening its condition still covers", () => {
      const { blocked, allowed, expired } = applyAllowList(
        loweredCoverage(),
        [
          {
            file: VITEST_FILE,
            key: KEY_LINES,
            reason: MIGRATION_REASON,
            until: UNTIL_DAY,
          },
        ],
        WHILE_LIVE
      );
      expect(blocked).toHaveLength(0);
      expect(expired).toHaveLength(0);
      expect(allowed).toHaveLength(1);
      expect(allowed[0]?.message).toContain(UNTIL_DAY);
    });

    it("says nothing about an entry that is still live", () => {
      expect(
        describeAllowList(
          [{ file: VITEST_FILE, key: KEY_LINES, until: UNTIL_DAY }],
          WHILE_LIVE
        )
      ).toEqual([]);
    });

    it("is live through the whole of its named day, UTC", () => {
      expect(allowEntryExpiry(UNTIL_DAY)).toBe(AFTER_EXPIRY);
      expect(
        classifyAllowEntry(
          { file: "a", key: "b", until: UNTIL_DAY },
          AFTER_EXPIRY - 1
        ).state
      ).toBe("live");
      expect(
        classifyAllowEntry(
          { file: "a", key: "b", until: UNTIL_DAY },
          AFTER_EXPIRY
        ).state
      ).toBe("expired");
    });
  });

  describe("a condition nothing can evaluate is reported", () => {
    it("reports an entry that names no condition at all", () => {
      const entry = { file: VITEST_FILE, key: KEY_LINES };
      expect(classifyAllowEntry(entry, WHILE_LIVE).state).toBe("unchecked");
      const lines = describeAllowList([entry], WHILE_LIVE);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("until");
    });

    it("reports an `until` that is not a calendar date", () => {
      for (const until of ["when the migration lands", "2026-6-15", "", 7]) {
        expect(
          classifyAllowEntry(
            { file: VITEST_FILE, key: KEY_LINES, until },
            WHILE_LIVE
          ).state
        ).toBe("unchecked");
      }
    });

    it("refuses a date that is not a real day rather than sliding it", () => {
      expect(allowEntryExpiry("2026-02-31")).toBeUndefined();
      expect(allowEntryExpiry("0099-01-01")).toBeUndefined();
      expect(allowEntryExpiry("2026-13-01")).toBeUndefined();
    });

    it("tolerates surrounding whitespace in a well-formed date", () => {
      expect(allowEntryExpiry(`  ${UNTIL_DAY}\n`)).toBe(AFTER_EXPIRY);
    });

    it("treats a blank reason as no reason recorded", () => {
      expect(
        classifyAllowEntry(
          {
            file: VITEST_FILE,
            key: KEY_LINES,
            reason: "   ",
            until: UNTIL_DAY,
          },
          AFTER_EXPIRY
        ).detail
      ).toContain("No reason is recorded.");
    });

    it("keeps honouring an unchecked entry so a valid exception survives", () => {
      // Migration safety, stated as a test: an entry written before `until`
      // existed still exempts. It is reported, loudly, and it is not a wall.
      const { blocked, allowed } = applyAllowList(
        loweredCoverage(),
        [{ file: VITEST_FILE, key: KEY_LINES }],
        AFTER_EXPIRY
      );
      expect(blocked).toHaveLength(0);
      expect(allowed).toHaveLength(1);
    });
  });

  describe("a file-wide exemption is distinguishable from a key-scoped one", () => {
    it("names the wildcard entry as file-wide", () => {
      const detail = classifyAllowEntry(
        { file: VITEST_FILE, key: "*", until: UNTIL_DAY },
        AFTER_EXPIRY
      ).detail;
      expect(detail).toContain("file-wide");
      expect(detail).toContain("every key");
    });

    it("names a single-key entry as key-scoped", () => {
      const detail = classifyAllowEntry(
        { file: VITEST_FILE, key: KEY_LINES, until: UNTIL_DAY },
        AFTER_EXPIRY
      ).detail;
      expect(detail).toContain("key-scoped");
      expect(detail).not.toContain("file-wide");
    });

    it("expires a file-wide exemption exactly as it expires a scoped one", () => {
      const { blocked, expired } = applyAllowList(
        loweredCoverage(),
        [{ file: VITEST_FILE, key: "*", until: UNTIL_DAY }],
        AFTER_EXPIRY
      );
      expect(blocked).toHaveLength(1);
      expect(expired[0]?.message).toContain("file-wide");
    });
  });

  describe("the baseline-side fence is unchanged", () => {
    it("still refuses a change that grants its own exemption", () => {
      const findings = compareFile(
        LISA_CONFIG_FILE,
        JSON.stringify({}),
        JSON.stringify({
          thresholdRatchet: {
            allow: [{ file: VITEST_FILE, key: "*", until: UNTIL_DAY }],
          },
        })
      );
      const { blocked, allowed } = applyAllowList(
        findings,
        [{ file: LISA_CONFIG_FILE, key: "*", until: UNTIL_DAY }],
        WHILE_LIVE
      );
      expect(allowed).toHaveLength(0);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.type).toBe("allow-added");
    });
  });

  describe("this repository's own allow list", () => {
    it("carries no expired or unevaluable entry", () => {
      // The executable form of the `_thresholdsDivergence` precedent: a stale
      // exemption stops exempting AND fails a test, rather than relying on a
      // reader noticing. Vacuous only while the list is empty, and it stops
      // being vacuous the moment anyone adds an entry.
      const config: unknown = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, LISA_CONFIG_FILE), "utf-8")
      );
      expect(describeAllowList(extractAllowEntries(config))).toEqual([]);
    });
  });
});

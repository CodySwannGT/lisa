/**
 * Tests for destructive-capability name matching.
 *
 * The envelope schema admits any `^[a-z][a-z0-9-]*$`, and its own description
 * uses compound examples, while `DESTRUCTIVE_CAPABILITIES` holds only bare
 * verbs. Matching the whole string against that list therefore classified
 * `reset-database` as non-destructive.
 *
 * Every case here pairs a compound name with an **empty summary**, because that
 * is the combination that actually bypasses the guard: the counts arm fires
 * only when a run reports rows touched, and an operation that deletes without
 * reporting is exactly what the guard exists for. A test that let the summary
 * report counts would pass against the broken matcher and prove nothing.
 * @module tests/unit/scripts/destructive-capability-compound-names
 */

import { describe, expect, it } from "vitest";

import {
  DESTRUCTIVE_CAPABILITIES,
  isDestructive,
} from "../../../all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

/**
 * An envelope naming a capability and reporting no work at all.
 * @param capability - The capability name to classify
 * @returns An envelope-shaped object with a silent summary
 */
const silent = (capability: string) => ({ capability, summary: {} });

describe("isDestructive: compound capability names", () => {
  it.each([
    "reset-database",
    "db-teardown",
    "seed-all",
    "truncate-tables",
    "purge-old-events",
    "restore-from-backup",
  ])("classifies %s as destructive despite an empty summary", name => {
    expect(isDestructive(silent(name))).toBe(true);
  });

  it("still classifies the bare verbs it always knew", () => {
    for (const name of DESTRUCTIVE_CAPABILITIES) {
      expect(isDestructive(silent(name)), name).toBe(true);
    }
  });

  it("matches segments, not substrings", () => {
    // `presets` contains `reset`. Segment matching is what keeps an ordinary
    // capability from being refused; a substring test would over-refuse here,
    // and an over-refusing guard gets disabled.
    expect(isDestructive(silent("presets"))).toBe(false);
    expect(isDestructive(silent("load-presets"))).toBe(false);
    expect(isDestructive(silent("reseeded"))).toBe(false);
  });

  it("leaves ordinary read capabilities alone", () => {
    expect(isDestructive(silent("export"))).toBe(false);
    expect(isDestructive(silent("migrate-up"))).toBe(false);
    expect(isDestructive(silent("health-check"))).toBe(false);
  });

  it("keeps the counts arm as a backstop for honest reporting", () => {
    // A capability nobody named destructively is still destructive if the run
    // says it deleted or created rows.
    expect(
      isDestructive({ capability: "export", summary: { deleted: 3 } })
    ).toBe(true);
    expect(
      isDestructive({ capability: "export", summary: { created: 1 } })
    ).toBe(true);
    expect(
      isDestructive({ capability: "export", summary: { deleted: 0 } })
    ).toBe(false);
  });

  it("does not throw on a missing or malformed capability", () => {
    expect(isDestructive({})).toBe(false);
    expect(isDestructive({ capability: null })).toBe(false);
    expect(isDestructive(undefined)).toBe(false);
  });
});

/** Existing exception identities include their rationale and end date. */
import { describe, expect, it } from "vitest";

import {
  compareFile,
  settleAddedExceptions,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";

const CONFIG = ".lisa.config.json";
const TARGET = "eslint.thresholds.json";
const FIRST_DAY = "2026-06-22";
const LATER_DAY = "2026-06-29";
const NOW = Date.UTC(2026, 5, 15);
const DEFAULT = "access-only";
const ENTRY = {
  file: TARGET,
  key: "maxWarnings",
  reason: "Remove before the rollout ends.",
  until: FIRST_DAY,
};

/**
 * Serialize the raw exception declaration as it is written to the config file.
 * @param allow - Declared exceptions
 * @returns Config contents
 */
function config(...allow: Record<string, unknown>[]): string {
  return JSON.stringify({ thresholdRatchet: { allow } });
}

const BASE = config(ENTRY);

describe("ratchet judging changed exception declarations", () => {
  it.each([
    {
      name: "in-place date extension without a reason",
      baseline: BASE,
      entry: { file: TARGET, key: ENTRY.key, until: LATER_DAY },
      expected: "needs a reason",
    },
    {
      name: "first-time config with a bare entry",
      baseline: null,
      entry: { file: TARGET, key: "*" },
      expected: 'needs an "until"',
    },
    {
      name: "repaired config with no until day",
      baseline: "{",
      entry: { file: TARGET, key: ENTRY.key, reason: ENTRY.reason },
      expected: 'needs an "until"',
    },
  ])("refuses $name", ({ baseline, entry, expected }) => {
    const findings = compareFile(CONFIG, baseline, config(entry));
    const outcome = settleAddedExceptions(findings, DEFAULT, NOW);

    expect(outcome.accepted).toEqual([]);
    expect(outcome.refused).toEqual([
      expect.objectContaining({ message: expect.stringContaining(expected) }),
    ]);
  });

  it("records a sound in-place change under access-only and refuses it under strict", () => {
    const findings = compareFile(
      CONFIG,
      BASE,
      config({ ...ENTRY, until: LATER_DAY })
    );
    const source = () => '{"maxWarnings":10}';
    const ordinary = settleAddedExceptions(findings, DEFAULT, NOW, source);
    const strict = settleAddedExceptions(findings, "strict", NOW, source);

    expect(ordinary.refused).toEqual([]);
    expect(ordinary.accepted).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("new exception recorded"),
      }),
    ]);
    expect(strict.refused).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Exceptions are a human decision"),
      }),
    ]);
  });

  it("ignores an unchanged declaration and a removed entry", () => {
    const unrelated = JSON.stringify({
      tracker: "github",
      thresholdRatchet: { allow: [ENTRY] },
    });

    expect(compareFile(CONFIG, BASE, unrelated)).toEqual([]);
    expect(compareFile(CONFIG, BASE, config())).toEqual([]);
    expect(compareFile(TARGET, null, '{"maxWarnings":10}')).toEqual([]);
  });
});

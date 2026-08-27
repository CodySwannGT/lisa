/**
 * Contract tests for the reviewed `secrets.require` provider boundary.
 * Synthetic values only; no test process receives a provider credential.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeRows,
  selectRequired,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

const row = (key: string, value: string) => ({
  key,
  value,
  note: "",
  projectId: "project-a",
  id: `id-${key}`,
});

describe("required provider view", () => {
  it("contains exactly the declared required names", () => {
    const selected = normalizeRows([
      row("REQUIRED_A", "1"),
      row("UNDECLARED", "2"),
      row("REQUIRED_B", "3"),
    ]);

    expect([
      ...selectRequired(selected, ["REQUIRED_A", "REQUIRED_B"]).keys(),
    ]).toEqual(["REQUIRED_A", "REQUIRED_B"]);
  });

  it("keeps the provider grant unchanged when require is omitted", () => {
    const selected = normalizeRows([row("A_KEY", "1"), row("B_KEY", "2")]);

    expect(selectRequired(selected, null)).toBe(selected);
  });

  it("refuses a missing name instead of returning a partial set", () => {
    const selected = normalizeRows([row("PRESENT", "1")]);

    expect(() => selectRequired(selected, ["PRESENT", "MISSING"])).toThrow(
      /required secret not found: MISSING/i
    );
  });
});

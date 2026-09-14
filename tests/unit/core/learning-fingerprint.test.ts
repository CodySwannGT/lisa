import { describe, expect, it } from "vitest";
import * as learnings from "../../../src/core/learnings.js";

describe("canonical learning fingerprint", () => {
  it("deduplicates equivalent rules across whitespace and case", () => {
    expect(
      learnings.learningFingerprint("  Check THE\n target   first. ")
    ).toBe(learnings.learningFingerprint("check the target first."));
  });

  it("uses the same rule-only SHA-256 identity in every workflow", () => {
    expect(learnings.learningFingerprint("hello")).toBe(
      "learning-2cf24dba5fb0a30e26e8"
    );
  });

  it("keeps distinct rules distinct even when they cite the same event", () => {
    const rules = ["Verify the target.", "Preserve the working tree."];
    expect(new Set(rules.map(learnings.learningFingerprint)).size).toBe(2);
  });

  it.each(["", " \n\t "])("refuses an empty normalized rule", rule => {
    expect(() => learnings.learningFingerprint(rule)).toThrow(/rule/i);
  });
});

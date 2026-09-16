/**
 * Pin the gardener's shared invariant fingerprint to its historical keys.
 * The CLI and recurrence storage must retain trim/collapse/lowercase followed
 * by the first 12 SHA-256 hex characters so existing dedupe markers stay valid.
 */
import { invariantFingerprint } from "../../../src/utils/effectiveness.js";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL = readFileSync(
  path.resolve("plugins/src/base/skills/lisa-learnings-audit/SKILL.md"),
  "utf8"
);

// Known vectors captured during the #1735 verification run — the two first-run
// PROJECT_RULES.md candidates the gardener classified as RETIRE.
const VECTORS = [
  {
    label: "eslint-statement-order invariant",
    raw: "When writing utility functions, avoid calling shared validation helpers (expression statements/side effects) before const definitions, as this violates the enforce-statement-order rule. Instead, inline validation as `if` guard clauses, which are exempt from the ordering rule.",
    hash: "ffc090644634",
  },
  {
    label: "eslint-disable-comments invariant",
    raw: "All `eslint-disable` directives must include a description to satisfy the `eslint-comments/require-description` rule.",
    hash: "0ba61dd88e78",
  },
] as const;

describe("gardener deterministic invariant-hash procedure", () => {
  it("documents the normalization + hash pipeline in the skill", () => {
    expect(SKILL).toMatch(/trim/i);
    expect(SKILL).toMatch(/collapse/i);
    expect(SKILL).toMatch(/lowercase/i);
    expect(SKILL).toContain("lisa effectiveness fingerprint --input <file>");
    expect(SKILL).toContain("first 12 SHA-256 hex characters");
    expect(SKILL).toMatch(/never estimated by the model/i);
  });

  describe.each(VECTORS)("known vector: $label", vector => {
    it("normalizes then hashes to the pinned 12-char key", () => {
      expect(invariantFingerprint(vector.raw)).toBe(vector.hash);
    });
  });

  it("is stable across normalization-equivalent spellings (whitespace/case)", () => {
    // Hardcoded expected value (test isolation: never derive the expected
    // output by calling the function under test on the clean input).
    const expectedNormalized =
      "when writing utility functions, avoid calling shared validation helpers (expression statements/side effects) before const definitions, as this violates the enforce-statement-order rule. instead, inline validation as `if` guard clauses, which are exempt from the ordering rule.";
    const noisy = `  \n\t${VECTORS[0].raw.toUpperCase().replace(/ /gu, "   ")}\n  `;
    expect(invariantFingerprint(expectedNormalized)).toBe(VECTORS[0].hash);
    expect(invariantFingerprint(noisy)).toBe(VECTORS[0].hash);
  });
});

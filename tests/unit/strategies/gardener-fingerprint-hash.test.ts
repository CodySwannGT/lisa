/**
 * Regression pin for the gardener's DETERMINISTIC invariant-hash procedure
 * (lisa-learnings-audit, LLG-6 #1735).
 *
 * The skill documents that the `<invariant-hash>` in a `[lisa-gardener]`
 * fingerprint marker is computed deterministically — "never estimated by the
 * model" — by (1) normalizing the invariant text (trim, collapse internal
 * whitespace runs to a single space, lowercase), then (2) hashing in Bash:
 * `printf '%s' "$normalized" | shasum -a 256 | cut -c1-12`. That determinism
 * is what makes the same knowledge item produce the same key across runs and
 * sessions, so the dedupe / rejection-memory contract can never file a
 * duplicate for a surface it already ticketed.
 *
 * The existing prose-contract suite asserts the SKILL.md *documents* the
 * pipeline verbatim (the `shasum -a 256` / `cut -c1-12` / trim+collapse+lowercase
 * strings). This suite pins the pipeline's actual OUTPUT against known vectors
 * — the two first-run PROJECT_RULES.md candidates the gardener fingerprinted
 * during the #1735 verification (live tickets #1775 / #1776) — so a change to
 * the normalization steps or the 12-char truncation, which would silently
 * re-key every marker and break idempotency, fails CI. Pure `node:crypto` keeps
 * it portable (the documented `shasum`/`cut` pipeline is macOS-centric); the
 * sibling prose-contract test is what guards the documented command string.
 * @module tests/unit/strategies/gardener-fingerprint-hash
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL = readFileSync(
  path.resolve("plugins/src/base/skills/lisa-learnings-audit/SKILL.md"),
  "utf8"
);

/**
 * Normalizes invariant text exactly as the skill documents: trim
 * leading/trailing whitespace, collapse every internal whitespace run to a
 * single space, lowercase.
 * @param raw Raw invariant text.
 * @returns The normalized single-line lowercased text.
 */
function normalizeInvariant(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * Computes the 12-hex-char fingerprint hash, mirroring the documented
 * `shasum -a 256 | cut -c1-12` in portable `node:crypto`.
 * @param normalized Normalized invariant text.
 * @returns First 12 hex chars of the SHA-256 digest.
 */
function fingerprint(normalized: string): string {
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 12);
}

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
    expect(SKILL).toContain("shasum -a 256");
    expect(SKILL).toContain("cut -c1-12");
    expect(SKILL).toMatch(/never estimated by the model/i);
  });

  describe.each(VECTORS)("known vector: $label", vector => {
    it("normalizes then hashes to the pinned 12-char key", () => {
      expect(fingerprint(normalizeInvariant(vector.raw))).toBe(vector.hash);
    });
  });

  it("is stable across normalization-equivalent spellings (whitespace/case)", () => {
    const canonical = normalizeInvariant(VECTORS[0].raw);
    const noisy = normalizeInvariant(
      `  \n\t${VECTORS[0].raw.toUpperCase().replace(/ /gu, "   ")}\n  `
    );
    expect(noisy).toBe(canonical);
    expect(fingerprint(noisy)).toBe(VECTORS[0].hash);
  });
});

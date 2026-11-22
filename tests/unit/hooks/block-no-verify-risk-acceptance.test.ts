/**
 * The bypass refusal names who makes the risk-acceptance call
 * (CodySwannGT/lisa#4687).
 *
 * Under the default `humanGate.mode` (`access-only`) the agent makes that
 * decision itself — a specific documented ignore with its reason and an
 * expiry — because no access is missing. Only under `strict` does it ask a
 * person. Every copy of the refusal (the canonical hook, the Antigravity
 * variant, the retired Codex script) must say the same thing, or the agent's
 * instructions would depend on which runtime it happens to run in.
 * @module tests/unit/hooks/block-no-verify-risk-acceptance
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SENTENCE =
  "If a fix is genuinely impossible, make the risk-acceptance decision yourself: " +
  "add a specific documented ignore with its reason and an expiry (under " +
  "humanGate.mode strict, ask the user to make that decision instead); never " +
  "bypass the hook.";

const COPIES = [
  "plugins/src/base/hooks/block-no-verify.sh",
  "plugins/src/base/hooks/block-no-verify.agy.sh",
  "src/codex/scripts/block-no-verify.sh",
];

/**
 * A copy's text with line wrapping collapsed.
 * @param file - Repo-relative path
 * @returns Flattened text
 */
const flat = (file: string): string =>
  readFileSync(file, "utf8").replace(/\s+/gu, " ");

describe("block-no-verify: who accepts the risk", () => {
  it.each(COPIES)("%s gives the mode-aware instruction", file => {
    const text = flat(file);
    expect(text).toContain(SENTENCE);
    expect(text).not.toContain(
      "ask the user to make the risk-acceptance decision and add"
    );
  });
});

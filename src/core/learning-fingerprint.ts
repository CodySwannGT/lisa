import { createHash } from "node:crypto";

/**
 * Identify a rule independently of its capture workflow or evidence links.
 * Legacy stored ids and fingerprints remain valid and must not be rewritten
 * merely to adopt this rule-only SHA-256 identity.
 * @param rule - The final, consolidated rule text.
 * @returns Deterministic ledger content fingerprint.
 */
export function learningFingerprint(rule: string): string {
  const normalized = rule.toLowerCase().replace(/\s+/gu, " ").trim();
  if (normalized === "") throw new Error("A learning rule must not be empty");
  return `learning-${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
}

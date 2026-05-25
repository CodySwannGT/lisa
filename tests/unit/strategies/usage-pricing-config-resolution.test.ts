/**
 * Regression tests for the optional usage-pricing config contract.
 *
 * Issue #733 extends the canonical config-resolution docs with a committed,
 * non-secret `usage.pricing` block so Lisa can estimate cost from trustworthy
 * token counts without inventing built-in provider rates.
 * @module tests/unit/strategies/usage-pricing-config-resolution
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ROOTS = ["plugins/src/base/rules", "plugins/lisa/rules"] as const;

describe.each(RULE_ROOTS)(
  "config-resolution usage pricing docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("documents the usage.pricing schema and per-model rate shape", () => {
      expect(content).toContain('"usage": {');
      expect(content).toContain('"pricing": {');
      expect(content).toContain('"currency": "USD"');
      expect(content).toContain('"source": "openai-api-pricing"');
      expect(content).toContain('"snapshot": "2026-05-25"');
      expect(content).toContain('"openai/gpt-5"');
      expect(content).toContain('"inputPer1M": 1.25');
      expect(content).toContain('"cachedInputPer1M": 0.125');
      expect(content).toContain('"outputPer1M": 10.0');
    });

    it("forbids built-in provider defaults and preserves missing pricing", () => {
      expect(content).toMatch(/no built-in provider rates/i);
      expect(content).toMatch(/do \*\*not\*\* trigger built-in defaults/i);
      expect(content).toMatch(/pricing_status = missing/i);
      expect(content).toMatch(/cost = null/i);
    });

    it("documents pricing source provenance from config metadata", () => {
      expect(content).toMatch(/config:<source>@<snapshot>/i);
      expect(content).toMatch(/config:<source>/i);
      expect(content).toMatch(/Runtime-observed monetary cost always wins/i);
      expect(content).toMatch(/per-key local-overrides-global precedence/i);
    });
  }
);

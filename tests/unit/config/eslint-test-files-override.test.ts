/**
 * Unit tests that pin the rule relaxations in Lisa's shared test-file
 * ESLint override (`getTestFilesOverride`).
 *
 * Background: every stack config (typescript, expo, nestjs, cdk) enables
 * strict rules like `code-organization/enforce-statement-order` globally and
 * relies on `getTestFilesOverride` — appended later in the flat-config
 * array — to switch off the rules that arrange-act-assert tests cannot
 * satisfy. Lisa 2.191.x shipped without the statement-order relaxation,
 * which broke CI lint in every downstream project whose tests interleave
 * mock-setup side effects with consts that read the resulting state. This
 * guard test keeps each required relaxation in place.
 */
import { describe, expect, it } from "vitest";

import { getTestFilesOverride } from "../../../src/configs/eslint/base.js";

describe("getTestFilesOverride rule relaxations", () => {
  const override = getTestFilesOverride();
  const rules = override.rules as Record<string, unknown>;

  it("targets test file patterns", () => {
    expect(override.files).toContain("**/*.test.ts");
    expect(override.files).toContain("**/__tests__/*");
  });

  it("appends additional patterns when provided", () => {
    const extended = getTestFilesOverride(["**/*.integration.ts"]);
    expect(extended.files).toContain("**/*.integration.ts");
  });

  it("disables statement-order enforcement for arrange-act-assert tests", () => {
    expect(rules["code-organization/enforce-statement-order"]).toBe("off");
  });

  it("disables immutability rules that block mock mutation", () => {
    expect(rules["functional/immutable-data"]).toBe("off");
    expect(rules["functional/no-let"]).toBe("off");
  });

  it("disables process.env and length restrictions for test setup", () => {
    expect(rules["no-restricted-syntax"]).toBe("off");
    expect(rules["max-lines-per-function"]).toBe("off");
  });
});

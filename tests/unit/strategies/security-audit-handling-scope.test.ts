/**
 * The audit's failure message must name the `lisa-security-audit-handling`
 * skill (#4521), so an agent that hits a failing audit is pointed at the
 * ladder that teaches the scoped exclusion shape. Checked in the distributed
 * script and the repository's own copy.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("security-audit-handling is named by the audit", () => {
  it("is named by the audit's failure message", () => {
    for (const script of [
      "all/copy-overwrite/scripts/lisa-audit.mjs",
      "scripts/lisa-audit.mjs",
    ])
      expect(readFileSync(script, "utf8"), script).toContain(
        "lisa-security-audit-handling"
      );
  });
});

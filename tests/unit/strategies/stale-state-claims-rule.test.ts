/**
 * Contract coverage for the stale-state-claims rule.
 *
 * The rule's guidance prose is reviewed, not pinned. Two checks stay, and
 * rewording the rule cannot fail either. The reference body must be reachable
 * from the eager rule index. And the confidentiality assertion is load-bearing
 * rather than cosmetic: rules ship to every Lisa consumer, and the observed
 * instances behind this rule came from one project's live infrastructure.
 * Tracker refs and hostnames are the two forms that leak by copy-paste.
 *
 * Both roots are checked because `plugins/lisa` is generated from
 * `plugins/src/base`.
 * @module tests/unit/strategies/stale-state-claims-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("stale-state-claims rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/stale-state-claims.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/stale-state-claims.md"
      );
    });

    it("carries no originating-project identifiers", () => {
      expect(reference).not.toMatch(/\b[A-Z]{2,6}-\d{1,6}\b/);
      expect(reference).not.toMatch(/https?:\/\//);
      expect(reference).not.toMatch(/\b[a-z0-9-]+\.(com|net|org|io|dev)\b/);
    });
  });
});

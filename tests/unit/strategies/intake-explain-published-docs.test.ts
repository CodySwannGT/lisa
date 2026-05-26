/**
 * Regression coverage for the published intake-explain operator docs.
 *
 * Issue #853 makes the concise command/README surfaces useful without requiring
 * operators to read the full skill body first.
 * @module tests/unit/strategies/intake-explain-published-docs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (filePath: string): string =>
  readFileSync(path.resolve(filePath), "utf8");

describe("intake-explain published docs (#853)", () => {
  it("lists intake-explain in the README batch and scheduled work table", () => {
    const readme = read("README.md");

    expect(readme).toContain("/lisa:intake-explain <item-ref>");
    expect(readme).toMatch(
      /lifecycle role, verdict, decisive intake or repair gate/i
    );
    expect(readme).toContain("/lisa:intake");
    expect(readme).toContain("/lisa:repair-intake");
  });

  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("documents command usage, verdict taxonomy, and workflows", () => {
      const command = read(path.join(root, "commands", "intake-explain.md"));

      expect(command).toContain("Common operator usage");
      expect(command).toContain("The diagnosis uses stable verdicts");
      expect(command).toContain("Use it for these operator workflows");

      for (const verdict of [
        "ELIGIBLE_FOR_INTAKE",
        "ELIGIBLE_FOR_REPAIR",
        "WAITING_ON_STALENESS",
        "HELD_BY_BLOCKERS",
        "NON_LEAF_CONTAINER",
        "PRODUCT_OWNED_STATE",
        "MISCONFIGURED",
      ]) {
        expect(command).toContain(verdict);
      }

      expect(command).toMatch(/Intake triage/i);
      expect(command).toMatch(/Repair triage/i);
      expect(command).toMatch(/Product follow-up/i);
      expect(command).toMatch(/Queue cleanup/i);
      expect(command).toMatch(/read-only/i);
      expect(command).toMatch(
        /never claims, relabels, comments on, repairs, or decomposes/i
      );
    });
  });
});

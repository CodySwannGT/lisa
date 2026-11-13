/**
 * Contract coverage for the vendor-neutral reset-seed-coverage rule.
 *
 * The eager head + reference body are the executable contract every work item
 * touching persistent state conforms to. These assertions pin the things most
 * likely to rot: vendor neutrality, the four-policy classification, and the
 * correction that matters most — keep-list-by-subtraction is a DETECTOR, not
 * the safety model. "New entities are cleared unless exempted" is the tempting
 * shortcut that erases unrelated non-production data the first time a change
 * adds one, so the rule must keep saying so out loud.
 * @module tests/unit/strategies/reset-seed-coverage-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The only four policies an entity may carry. */
const POLICIES = [
  "fixture-owned",
  "preserve",
  "derived-rebuild",
  "forbidden",
] as const;

/** Golden-state properties promoted into the contract. */
const ASSURANCES = [
  "preserves-non-fixture-data",
  "rejects-reserved-id-collision",
  "rejects-foreign-references",
  "requires-write-acknowledgment",
  "converges-on-second-apply",
  "verifies-exact-counts",
  "production-fails-closed",
] as const;

/** Kinds of state that are not rows and are routinely forgotten. */
const NON_DB_STATE = [
  "identity",
  "object storage",
  "search index",
  "queue",
  "cache",
  "materialized",
] as const;

/** Every skill wired to cite the contract rather than restate it. */
const CITING_SKILLS = [
  "lisa-research",
  "lisa-acceptance-criteria",
  "lisa-task-decomposition",
  "lisa-test-strategy",
  "lisa-implement",
  "lisa-codify-verification",
  "lisa-verification-lifecycle",
  "lisa-verify",
] as const;

/**
 * Read a rules/skills file from one plugin root.
 * @param root - Plugin root (source or built)
 * @param rel - Path relative to that root
 * @returns File contents
 */
const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("reset-seed-coverage rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/reset-seed-coverage.md");
    const reference = read(root, "rules/reference/reset-seed-coverage.md");

    it("stays reachable from the eager rule index", () => {
      expect(reference.length).toBeGreaterThan(2000);
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/reset-seed-coverage.md"
      );
    });

    it("names all four policies in the eager head", () => {
      for (const policy of POLICIES) {
        expect(eager).toContain(policy);
      }
    });

    it("says rows are only one kind of state", () => {
      for (const kind of NON_DB_STATE) {
        expect(eager.toLowerCase()).toContain(kind);
      }
    });

    it("carries the golden-state assurances", () => {
      for (const assurance of ASSURANCES) {
        expect(reference).toContain(assurance);
      }
    });

    it("specifies the standard command envelope", () => {
      for (const field of [
        "schemaVersion",
        "capability",
        "mode",
        "operation",
        "environment",
        "contractVersion",
        "dryRun",
        "status",
        "correlationId",
        "summary",
      ]) {
        expect(reference).toContain(field);
      }
      expect(reference).toContain("declared-noop");
    });

    it("is cited by every lifecycle skill rather than restated in each", () => {
      for (const skill of CITING_SKILLS) {
        const contents = read(root, `skills/${skill}/SKILL.md`);
        expect(
          contents,
          `${skill} must cite the reset-seed-coverage rule`
        ).toContain("reset-seed-coverage");
      }
    });
  });
});

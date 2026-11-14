/**
 * Structural coverage for the dependency-trust-classes rule.
 *
 * The rule's guidance prose (the six classes, their review inputs) is not
 * pinned (#4867). What stays is that the reference body ships from plugin
 * source and is reachable from the eager rule index.
 * @module tests/unit/strategies/dependency-trust-classes-rule-pair
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = "plugins/src/base/rules/eager/00-rule-index.md";
const REFERENCE =
  "plugins/src/base/rules/reference/dependency-trust-classes.md";

describe("dependency-trust-classes rule", () => {
  it("ships the reference body and indexes it from the eager rule index", () => {
    expect(existsSync(REFERENCE)).toBe(true);
    expect(readFileSync(INDEX, "utf8")).toContain(
      "reference/dependency-trust-classes.md"
    );
  });
});

/**
 * Structural coverage for the dependency decision-record scaffold that
 * `lisa apply` seeds into every host project.
 *
 * The scaffold's guidance prose, field wording and worked examples are not
 * pinned (#4867). What stays is that the create-only template ships.
 * @module tests/unit/templates/dependency-decisions-template
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "all",
  "create-only",
  ".lisa",
  "DEPENDENCY_DECISIONS.md"
);

describe("dependency decisions create-only template", () => {
  it("ships the scaffold in the create-only tree", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });
});

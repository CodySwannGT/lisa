/**
 * Regression coverage for issue #669: project-ideation ships concrete example
 * outputs that demonstrate practical ideas, discovery spikes, unavailable-data
 * rejection, and evidence-card formatting.
 *
 * @module tests/unit/codex/project-ideation-examples
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const EXAMPLE_ROOTS = [
  "plugins/src/base/skills/project-ideation/examples",
  "plugins/lisa/skills/project-ideation/examples",
] as const;

const EXAMPLE_FILES = [
  "host-project-only.md",
  "public-external-inspiration.md",
  "unavailable-data-rejection.md",
  "evidence-card-format.md",
] as const;

/**
 * Read one committed project-ideation example from a source or generated root.
 * @param root Example directory under source or built plugin artifacts.
 * @param file Example markdown filename.
 * @returns The example markdown contents.
 */
function readExample(root: string, file: string): string {
  return readFileSync(path.resolve(root, file), "utf8");
}

describe("codex/project-ideation-examples (#669)", () => {
  it.each(EXAMPLE_ROOTS)(
    "%s ships the required project-ideation example outputs",
    root => {
      for (const file of EXAMPLE_FILES) {
        const content = readExample(root, file);

        expect(content).toContain("## What Already Exists");
        expect(content).toContain("## Practical Ideas");
        expect(content).toContain("## Discovery Spikes");
        expect(content).toContain("## Rejected / Not Practical Yet");
      }
    }
  );

  it.each(EXAMPLE_ROOTS)(
    "%s keeps Practical Ideas tied to empirical evidence fields",
    root => {
      for (const file of EXAMPLE_FILES) {
        const content = readExample(root, file);

        expect(content).toMatch(/- Empirical verification: .+/);
        expect(content).toMatch(/- Evidence: .+/);
      }
    }
  );

  it.each(EXAMPLE_ROOTS)(
    "%s names missing sources when rejecting unavailable-data ideas",
    root => {
      const content = readExample(root, "unavailable-data-rejection.md");

      expect(content).toContain("missing source");
      expect(content).toContain("support-ticket export");
      expect(content).toContain("licensed data feed");
    }
  );
});

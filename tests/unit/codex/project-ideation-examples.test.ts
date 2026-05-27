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

const IDEMPOTENCY_HARNESS_EXAMPLE = "idempotency-verification-harness.md";

const EXAMPLE_FILES = [
  "host-project-only.md",
  "public-external-inspiration.md",
  "unavailable-data-rejection.md",
  "evidence-card-format.md",
  IDEMPOTENCY_HARNESS_EXAMPLE,
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

        if (file === IDEMPOTENCY_HARNESS_EXAMPLE) {
          expect(content).toContain("## Deterministic fixture");
          expect(content).toContain("## Scripted verification");
          continue;
        }

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

        if (file === IDEMPOTENCY_HARNESS_EXAMPLE) {
          expect(content).toContain("[EVIDENCE: marker-count-one]");
          expect(content).toContain("[EVIDENCE: memory-recreated-after-rerun]");
          continue;
        }

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

  it.each(EXAMPLE_ROOTS)("%s documents the idempotency harness", root => {
    const content = readExample(root, IDEMPOTENCY_HARNESS_EXAMPLE);

    expect(content).toContain("project-ideation-idempotency-harness.mjs");
    expect(content).toContain("prd_ready=true");
    expect(content).toContain("max_prds=1");
    expect(content).toContain("memoryRecreated");
  });
});

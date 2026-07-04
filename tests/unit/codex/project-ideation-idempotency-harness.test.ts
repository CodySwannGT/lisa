/**
 * Regression coverage for issue #1010: project-ideation ships a deterministic
 * verification harness proving stable-marker PRD dedupe across repeated runs
 * and missing automation memory.
 *
 * @module tests/unit/codex/project-ideation-idempotency-harness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT_ROOTS = [
  "plugins/src/base/scripts",
  "plugins/lisa/scripts",
] as const;
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/**
 * Read a committed source or generated artifact.
 * @param root Directory containing the target file.
 * @param file File path relative to the root.
 * @returns File contents.
 */
function readFile(root: string, file: string): string {
  return readFileSync(path.resolve(root, file), "utf8");
}

describe("project-ideation idempotency harness (#1010)", () => {
  it.each(SCRIPT_ROOTS)("%s ships the marker-count harness script", root => {
    const content = readFile(root, "project-ideation-idempotency-harness.mjs");

    expect(content).toContain("--marker");
    expect(content).toContain("--command");
    expect(content).toContain("--memory-file");
    expect(content).toContain('`"${marker}" in:body`');
    expect(content).toContain("memoryRecreated");
    expect(content).toContain("memoryFieldsRecorded");
    expect(content).toContain("source_agreement:");
  });

  it.each(SKILL_ROOTS)("%s documents fixture-driven verification", root => {
    const content = readFile(root, "lisa-project-ideation/SKILL.md");

    expect(content).toContain("fixture=<path>");
    expect(content).toContain("idempotency-verification-harness.md");
    expect(content).toMatch(/marker count at one/i);
    expect(content).toContain("Optional Codex automation memory");
    expect(content).toContain("source_agreement");
  });
});

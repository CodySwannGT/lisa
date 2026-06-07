/**
 * Unit tests for the OpenCode command transformer (Lisa command Markdown →
 * OpenCode command Markdown).
 *
 * Covers:
 *   - description frontmatter preserved (fallback to display name)
 *   - $ARGUMENTS preserved verbatim (native OpenCode substitution)
 *   - body passthrough; malformed frontmatter throws
 */
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { transformCommandToOpencode } from "../../../src/opencode/command-transformer.js";

const SAMPLE_COMMAND = `---
description: "Fix a bug. Reproduces, analyzes, fixes via TDD."
argument-hint: "<description>"
---

Apply the intent-routing rule and execute the Implement flow.

$ARGUMENTS
`;

describe("opencode/command-transformer", () => {
  it("preserves the description in frontmatter", () => {
    const out = transformCommandToOpencode(SAMPLE_COMMAND, "lisa:fix");
    const fm = yaml.load(
      /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)?.[1] ?? ""
    ) as Record<string, unknown>;
    expect(fm.description).toBe(
      "Fix a bug. Reproduces, analyzes, fixes via TDD."
    );
  });

  it("preserves $ARGUMENTS verbatim (unlike the skill conversion)", () => {
    const out = transformCommandToOpencode(SAMPLE_COMMAND, "lisa:fix");
    expect(out).toContain("$ARGUMENTS");
    expect(out).toContain("execute the Implement flow.");
  });

  it("does not carry argument-hint into OpenCode frontmatter", () => {
    const out = transformCommandToOpencode(SAMPLE_COMMAND, "lisa:fix");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)?.[1] ?? "";
    expect(fm).not.toMatch(/argument-hint/);
  });

  it("falls back to the display name when no description is present", () => {
    const command = `---
argument-hint: "<x>"
---

Body $ARGUMENTS
`;
    const out = transformCommandToOpencode(command, "lisa:git:commit");
    const fm = yaml.load(
      /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)?.[1] ?? ""
    ) as Record<string, unknown>;
    expect(fm.description).toBe("lisa:git:commit");
  });

  it("throws on a command missing YAML frontmatter", () => {
    expect(() =>
      transformCommandToOpencode("no frontmatter", "lisa:x")
    ).toThrow(/frontmatter/i);
  });
});

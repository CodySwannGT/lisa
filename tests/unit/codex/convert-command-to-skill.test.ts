/**
 * Unit tests for the pure convertCommandToSkill helper from
 * `src/codex/skills-installer.ts`. Lives in its own file so the I/O-heavy
 * installSkills suite next door doesn't blow past the per-file line cap.
 */
import { describe, expect, it } from "vitest";
import { convertCommandToSkill } from "../../../src/codex/skills-installer.js";

const SAMPLE_COMMAND_MD = `---
description: "Fix a bug. Reproduces, analyzes, fixes via TDD."
argument-hint: "<description>"
---

Apply the intent-routing rule and execute the Implement flow.

$ARGUMENTS
`;

describe("codex/skills-installer convertCommandToSkill", () => {
  it("converts a basic command into a skill with the expected frontmatter", () => {
    const out = convertCommandToSkill(
      SAMPLE_COMMAND_MD,
      "lisa-fix",
      "lisa:fix"
    );
    expect(out).toMatch(/^---\nname: lisa-fix\n/);
    expect(out).toContain('description: "Fix a bug.');
  });

  it("strips $ARGUMENTS substitution from the body", () => {
    const out = convertCommandToSkill(
      SAMPLE_COMMAND_MD,
      "lisa-fix",
      "lisa:fix"
    );
    expect(out).not.toContain("$ARGUMENTS");
  });

  it("preserves the body content other than $ARGUMENTS", () => {
    const out = convertCommandToSkill(
      SAMPLE_COMMAND_MD,
      "lisa-fix",
      "lisa:fix"
    );
    expect(out).toContain(
      "Apply the intent-routing rule and execute the Implement flow"
    );
  });

  it("falls back to displayName when description is missing", () => {
    const src = `---
argument-hint: "<x>"
---

Body.
`;
    const out = convertCommandToSkill(src, "lisa-x", "lisa:x");
    expect(out).toContain('description: "lisa:x"');
  });

  it("throws on missing frontmatter", () => {
    expect(() =>
      convertCommandToSkill("# Just a header\n", "lisa-x", "lisa:x")
    ).toThrow(/missing YAML frontmatter/);
  });

  it("supports unquoted description values", () => {
    const src = `---
description: Fix a bug — short and sweet
---

Body.
`;
    const out = convertCommandToSkill(src, "lisa-fix", "lisa:fix");
    expect(out).toContain("Fix a bug");
  });

  it("supports single-quoted description values", () => {
    const src = `---
description: 'Single-quoted desc'
---

Body.
`;
    const out = convertCommandToSkill(src, "lisa-x", "lisa:x");
    expect(out).toContain("Single-quoted desc");
  });
});

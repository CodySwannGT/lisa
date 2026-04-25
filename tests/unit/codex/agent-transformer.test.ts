/**
 * Unit tests for the Lisa agent (Markdown + YAML) → Codex agent (TOML)
 * transformer. The transformer must produce TOML that satisfies Codex's
 * `RawAgentRoleFileToml` deserializer (deny_unknown_fields enabled), so the
 * tests pin the field set and shape carefully.
 */
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  LISA_AGENT_NAME_PREFIX,
  parseAgentMarkdown,
  transformAgentMarkdownToToml,
} from "../../../src/codex/agent-transformer.js";

/** Common agent id reused across multiple test cases */
const BUG_FIXER = "bug-fixer";
/** Body heading that's expected to survive the transform unchanged */
const BUG_FIXER_HEADING = "# Bug Fixer Agent";

const MINIMAL = `---
name: bug-fixer
description: Bug fix agent. Reproduces bugs as failing tests.
---

# Bug Fixer Agent

You are a bug fix specialist.
`;

const WITH_SKILLS = `---
name: bug-fixer
description: Bug fix agent. Reproduces bugs as failing tests.
skills:
  - bug-triage
  - tdd-implementation
  - jsdoc-best-practices
---

# Bug Fixer Agent

Body content here.
`;

const WITH_TOOLS_AND_MODEL = `---
name: test-runner
description: Runs tests
tools: Read, Bash, Grep
model: sonnet
---

Body.
`;

describe("agent-transformer", () => {
  describe("parseAgentMarkdown", () => {
    it("parses minimal frontmatter and body", () => {
      const result = parseAgentMarkdown(MINIMAL);
      expect(result.frontmatter.name).toBe(BUG_FIXER);
      expect(result.frontmatter.description).toContain("Bug fix agent");
      expect(result.body).toContain(BUG_FIXER_HEADING);
    });

    it("parses skills as string array", () => {
      const result = parseAgentMarkdown(WITH_SKILLS);
      expect(result.frontmatter.skills).toEqual([
        "bug-triage",
        "tdd-implementation",
        "jsdoc-best-practices",
      ]);
    });

    it("preserves tools and model when present", () => {
      const result = parseAgentMarkdown(WITH_TOOLS_AND_MODEL);
      expect(result.frontmatter.tools).toBe("Read, Bash, Grep");
      expect(result.frontmatter.model).toBe("sonnet");
    });

    it("trims leading whitespace from body", () => {
      const result = parseAgentMarkdown(MINIMAL);
      expect(result.body.startsWith(BUG_FIXER_HEADING)).toBe(true);
    });

    it("throws when frontmatter is absent", () => {
      expect(() => parseAgentMarkdown("# Just a heading\n")).toThrow(
        /missing YAML frontmatter/
      );
    });

    it("throws when name is missing", () => {
      const src = "---\ndescription: only desc\n---\n\nbody\n";
      expect(() => parseAgentMarkdown(src)).toThrow(/required "name"/);
    });

    it("throws when description is missing", () => {
      const src = "---\nname: only-name\n---\n\nbody\n";
      expect(() => parseAgentMarkdown(src)).toThrow(/required "description"/);
    });

    it("throws when name is empty string", () => {
      const src = "---\nname: ''\ndescription: x\n---\n\nbody\n";
      expect(() => parseAgentMarkdown(src)).toThrow(/required "name"/);
    });

    it("ignores unknown frontmatter fields", () => {
      const src = `---
name: x
description: x
some_future_field: hi
---

body
`;
      expect(() => parseAgentMarkdown(src)).not.toThrow();
    });

    it("handles CRLF line endings", () => {
      const crlf = MINIMAL.replace(/\n/g, "\r\n");
      const result = parseAgentMarkdown(crlf);
      expect(result.frontmatter.name).toBe(BUG_FIXER);
    });
  });

  describe("transformAgentToToml", () => {
    it("emits valid TOML parseable by smol-toml", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      expect(() => parseToml(out)).not.toThrow();
    });

    it("emits the three required Codex fields and no others", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(Object.keys(parsed).sort((a, b) => a.localeCompare(b))).toEqual([
        "description",
        "developer_instructions",
        "name",
      ]);
    });

    it("applies the lisa- name prefix by default", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.name).toBe(`${LISA_AGENT_NAME_PREFIX}${BUG_FIXER}`);
    });

    it("can be configured to skip the prefix", () => {
      const out = transformAgentMarkdownToToml(MINIMAL, {
        applyNamePrefix: false,
      });
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.name).toBe(BUG_FIXER);
    });

    it("preserves description verbatim", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.description).toBe(
        "Bug fix agent. Reproduces bugs as failing tests."
      );
    });

    it("emits the body as developer_instructions", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.developer_instructions).toContain(BUG_FIXER_HEADING);
      expect(parsed.developer_instructions).toContain(
        "You are a bug fix specialist."
      );
    });

    it("prepends a skills block when skills frontmatter is present", () => {
      const out = transformAgentMarkdownToToml(WITH_SKILLS);
      const parsed = parseToml(out) as Record<string, unknown>;
      const instructions = String(parsed.developer_instructions);
      expect(instructions).toContain("## Available Lisa Skills");
      expect(instructions).toContain("- bug-triage");
      expect(instructions).toContain("- tdd-implementation");
      expect(instructions).toContain("- jsdoc-best-practices");
      // Original body still present after skills block
      expect(instructions).toContain(BUG_FIXER_HEADING);
    });

    it("does not emit a skills block when frontmatter has none", () => {
      const out = transformAgentMarkdownToToml(MINIMAL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.developer_instructions).not.toContain(
        "Available Lisa Skills"
      );
    });

    it("does NOT emit tools field (Codex governs via sandbox_mode)", () => {
      const out = transformAgentMarkdownToToml(WITH_TOOLS_AND_MODEL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("tools");
    });

    it("does NOT emit model field (Lisa lets Codex use its default)", () => {
      // Model mapping is a Phase 6 polish — for now, drop to keep schema clean
      const out = transformAgentMarkdownToToml(WITH_TOOLS_AND_MODEL);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("model");
    });

    it("escapes literal triple-quotes in body to keep TOML valid", () => {
      const src = `---
name: edge
description: Edge case agent
---

Example: \`\`\`python
"""docstring"""
\`\`\`
`;
      const out = transformAgentMarkdownToToml(src);
      // Must still parse cleanly after escaping
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.name).toBe("lisa-edge");
      expect(String(parsed.developer_instructions)).toContain("docstring");
    });

    it("preserves backslashes in body", () => {
      const src = `---
name: bs
description: Backslash agent
---

A literal backslash: \\path\\to\\file
`;
      const out = transformAgentMarkdownToToml(src);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(String(parsed.developer_instructions)).toContain(
        "\\path\\to\\file"
      );
    });

    it("escapes special characters in description", () => {
      const src = `---
name: q
description: 'Says "hello" and uses \\backslash'
---

body
`;
      const out = transformAgentMarkdownToToml(src);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.description).toBe('Says "hello" and uses \\backslash');
    });

    it("trims trailing whitespace from body but preserves internal blank lines", () => {
      const src = `---
name: t
description: t
---

Para 1.

Para 2.



`;
      const out = transformAgentMarkdownToToml(src);
      const parsed = parseToml(out) as Record<string, unknown>;
      const instructions = String(parsed.developer_instructions);
      expect(instructions).toContain("Para 1.\n\nPara 2.");
      expect(instructions.endsWith("\n\n\n")).toBe(false);
    });
  });

  describe("transformAgentToToml — round-trip with the real bug-fixer agent", () => {
    it("produces a valid Codex agent file when fed Lisa's bug-fixer.md", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const sourcePath = path.resolve(
        __dirname,
        "../../../plugins/lisa/agents/bug-fixer.md"
      );
      const source = await fs.readFile(sourcePath, "utf8");
      const out = transformAgentMarkdownToToml(source);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.name).toBe("lisa-bug-fixer");
      expect(parsed.description).toMatch(/Bug fix agent/);
      expect(String(parsed.developer_instructions)).toContain(
        "You are a bug fix specialist"
      );
      // Skills frontmatter is reflected in the body for parity with Claude Code
      expect(String(parsed.developer_instructions)).toContain(
        "Available Lisa Skills"
      );
    });
  });
});

/**
 * Unit tests for the OpenCode agent transformer (Claude agent Markdown →
 * OpenCode subagent Markdown).
 *
 * Covers:
 *   - Frontmatter reshape (description + mode: subagent), body passthrough
 *   - skills/model/tools metadata preserved as body context blocks
 *   - YAML-safe description encoding (colons, quotes)
 *   - Malformed frontmatter throws
 */
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  transformAgentMarkdownToOpencode,
  transformAgentToOpencodeMarkdown,
} from "../../../src/opencode/agent-transformer.js";
import { parseAgentMarkdown } from "../../../src/codex/agent-transformer.js";

const SIMPLE_AGENT = `---
name: bug-fixer
description: Bug fix agent
---

Body content here.
`;

describe("opencode/agent-transformer", () => {
  it("emits description + mode: subagent frontmatter and preserves the body", () => {
    const out = transformAgentMarkdownToOpencode(SIMPLE_AGENT);
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(out);
    expect(match).not.toBeNull();
    const fm = yaml.load(match?.[1] ?? "") as Record<string, unknown>;
    expect(fm.description).toBe("Bug fix agent");
    expect(fm.mode).toBe("subagent");
    // No name field — OpenCode derives the name from the filename
    expect(fm.name).toBeUndefined();
    expect(match?.[2]).toContain("Body content here.");
  });

  it("does not emit a Claude name field into OpenCode frontmatter", () => {
    const out = transformAgentMarkdownToOpencode(SIMPLE_AGENT);
    expect(out).not.toMatch(/^name:/m);
  });

  it("preserves a skills: list as an in-body context block", () => {
    const agent = `---
name: architect
description: Architecture agent
skills:
  - codebase-research
  - task-decomposition
---

Design the approach.
`;
    const out = transformAgentMarkdownToOpencode(agent);
    expect(out).toContain("## Available Lisa Skills");
    expect(out).toContain("- lisa-codebase-research");
    expect(out).toContain("- lisa-task-decomposition");
    expect(out).toContain("Design the approach.");
  });

  it("preserves model/tools metadata as a compatibility block, not frontmatter", () => {
    const agent = `---
name: runner
description: Runner agent
tools: Read, Bash
model: sonnet
---

Do the thing.
`;
    const out = transformAgentMarkdownToOpencode(agent);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)?.[1] ?? "";
    // model/tools must NOT leak into frontmatter (a Claude alias would be an
    // invalid OpenCode model id)
    expect(fm).not.toMatch(/^model:/m);
    expect(fm).not.toMatch(/^tools:/m);
    // ...but the information is preserved in the body
    expect(out).toContain("## Claude Agent Compatibility");
    expect(out).toContain("`sonnet`");
    expect(out).toContain("Read, Bash");
  });

  it("encodes descriptions containing colons and quotes as YAML-safe scalars", () => {
    const agent = `---
name: tricky
description: 'Does X: "quoted" and more'
---

Body.
`;
    const out = transformAgentMarkdownToOpencode(agent);
    const fm = yaml.load(
      /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)?.[1] ?? ""
    ) as Record<string, unknown>;
    expect(fm.description).toBe('Does X: "quoted" and more');
  });

  it("transformAgentToOpencodeMarkdown accepts a pre-parsed agent", () => {
    const parsed = parseAgentMarkdown(SIMPLE_AGENT);
    const out = transformAgentToOpencodeMarkdown(parsed);
    expect(out).toContain("mode: subagent");
    expect(out).toContain("Body content here.");
  });

  it("throws on markdown missing YAML frontmatter", () => {
    expect(() =>
      transformAgentMarkdownToOpencode("no frontmatter here")
    ).toThrow(/frontmatter/i);
  });
});

/**
 * Regression coverage for GitHub issue #1064.
 *
 * Lisa-authored JIRA descriptions must be converted to ADF before acli/curl
 * writes. Passing Markdown or wiki markup as plain text stores one literal
 * paragraph in JIRA Cloud, which breaks validator section detection and human
 * readability.
 * @module tests/unit/strategies/jira-description-adf
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { markdownToAdf } from "../../../plugins/src/base/skills/lisa-atlassian-access/scripts/markdown-to-adf.mjs";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("JIRA description Markdown to ADF conversion", () => {
  it("converts Lisa's description subset into structured ADF nodes", () => {
    const adf = markdownToAdf(`# Context / Business Value

Text with **bold** and \`inline code\`.

- one
- two

1. first
2. second

\`\`\`gherkin
Given a user
When they save
Then it works
\`\`\`
`);

    expect(adf).toMatchObject({ version: 1, type: "doc" });
    expect(adf.content.map(node => node.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "codeBlock",
    ]);
    expect(adf.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(JSON.stringify(adf)).toContain('"type":"strong"');
    expect(JSON.stringify(adf)).toContain('"type":"code"');
    expect(adf.content[4]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "gherkin" },
    });
  });

  it("also converts JIRA wiki-style headings to heading nodes", () => {
    const adf = markdownToAdf("h2. Repository\nlisa\n");

    expect(adf.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Repository" }],
    });
  });

  describe.each(SKILL_ROOTS)("%s", root => {
    it("routes JIRA write descriptions through the shared converter", () => {
      const content = readSkill(root, "lisa-atlassian-access");

      expect(content).toContain("markdown-to-adf.mjs");
      expect(content).toContain("normalize_jira_description_payload");
      expect(content).toMatch(/description.*ADF/i);
      expect(content).toMatch(/acli.*does not convert Markdown/i);
    });

    it("requires validators to inspect rendered ADF heading nodes", () => {
      const content = readSkill(root, "lisa-jira-validate-ticket");

      expect(content).toContain("ADF heading");
      expect(content).toContain("extract section headings from ADF");
      expect(content).toContain("literal Markdown");
    });

    it("documents that post-write verify catches descriptions dropped to literal text", () => {
      const content = readSkill(root, "lisa-jira-write-ticket");

      expect(content).toContain("markdown-to-adf.mjs");
      expect(content).toMatch(/literal .*paragraph/i);
      expect(content).toContain("heading nodes");
    });
  });
});

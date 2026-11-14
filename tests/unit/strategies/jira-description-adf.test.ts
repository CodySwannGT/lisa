/**
 * Regression coverage for GitHub issue #1064.
 *
 * Lisa-authored JIRA descriptions must be converted to ADF before acli/curl
 * writes. Passing Markdown or wiki markup as plain text stores one literal
 * paragraph in JIRA Cloud, which breaks validator section detection and human
 * readability. The converter is tested as code; the skill prose that routes
 * writes through it is guidance and is not pinned here (#4867).
 * @module tests/unit/strategies/jira-description-adf
 */
import { describe, expect, it } from "vitest";
import { markdownToAdf } from "../../../plugins/src/base/skills/lisa-atlassian-access/scripts/markdown-to-adf.mjs";

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
});

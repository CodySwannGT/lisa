#!/usr/bin/env node
/**
 * Convert the Markdown subset Lisa writes for JIRA descriptions into ADF.
 *
 * This intentionally supports the description shapes produced by Lisa skills:
 * headings, paragraphs, fenced code blocks, bullet lists, numbered lists,
 * inline code, and bold text. Unsupported Markdown stays as paragraph text
 * instead of being dropped.
 */

const ADF_VERSION = 1;

/**
 * Convert a Markdown string into an Atlassian Document Format document.
 * @param {string} markdown Markdown or wiki-heading text.
 * @returns {{version: 1, type: "doc", content: Array<Record<string, unknown>>}}
 */
export function markdownToAdf(markdown) {
  const lines = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const content = [];
  let paragraph = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    content.push(paragraphNode(paragraph.join(" ")));
    paragraph = [];
  };

  const flushList = () => {
    if (!list) {
      return;
    }
    content.push({
      type: list.ordered ? "orderedList" : "bulletList",
      content: list.items.map(item => ({
        type: "listItem",
        content: [paragraphNode(item)],
      })),
    });
    list = null;
  };

  const flushFence = () => {
    if (!fence) {
      return;
    }
    const attrs = fence.language ? { language: fence.language } : {};
    content.push({
      type: "codeBlock",
      attrs,
      content: [{ type: "text", text: fence.lines.join("\n") }],
    });
    fence = null;
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      if (fence) {
        flushFence();
      } else {
        flushParagraph();
        flushList();
        fence = { language: fenceMatch[1] ?? "", lines: [] };
      }
      continue;
    }

    if (fence) {
      fence.lines.push(line);
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      flushParagraph();
      flushList();
      content.push({
        type: "heading",
        attrs: { level: heading.level },
        content: parseInline(heading.text),
      });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushFence();
  flushParagraph();
  flushList();

  return {
    version: ADF_VERSION,
    type: "doc",
    content,
  };
}

/**
 * Parse Markdown and common JIRA wiki-style headings.
 * @param {string} line A single input line.
 * @returns {{level: number, text: string} | null}
 */
function parseHeading(line) {
  const markdown = line.match(/^(#{1,6})\s+(.+)$/);
  if (markdown) {
    return { level: markdown[1].length, text: markdown[2].trim() };
  }

  const wiki = line.match(/^h([1-6])\.\s+(.+)$/i);
  if (wiki) {
    return { level: Number(wiki[1]), text: wiki[2].trim() };
  }

  return null;
}

/**
 * Create an ADF paragraph node.
 * @param {string} text Text content.
 * @returns {{type: "paragraph", content: Array<Record<string, unknown>>}}
 */
function paragraphNode(text) {
  return {
    type: "paragraph",
    content: parseInline(text),
  };
}

/**
 * Parse Lisa's inline formatting subset.
 * @param {string} text Text with optional `code` and **strong** spans.
 * @returns {Array<Record<string, unknown>>}
 */
function parseInline(text) {
  const nodes = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      nodes.push({
        type: "text",
        text: match[2],
        marks: [{ type: "code" }],
      });
    } else {
      nodes.push({
        type: "text",
        text: match[3],
        marks: [{ type: "strong" }],
      });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text: "" }];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    process.stdout.write(`${JSON.stringify(markdownToAdf(input), null, 2)}\n`);
  });
}

import { mergeCopyContents } from "../../../src/strategies/copy-contents.js";
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
const END_MARKER = "# END: AI GUARDRAILS";
it("preserves marker mentions before a complete managed block", () => {
  const prefix = `# This mentions ${BEGIN_MARKER}\noperator-must-survive/\n`;
  const before = `${prefix}${BEGIN_MARKER}\nold-cache/\n${END_MARKER}\ntrailing\n`;
  const source = `${BEGIN_MARKER}\nnew-cache/\n${END_MARKER}\n`;
  expect(mergeCopyContents(source, before)).toBe(
    `${prefix}${source}trailing\n`
  );
});

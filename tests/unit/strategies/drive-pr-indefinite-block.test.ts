/**
 * Regression tests for CodySwannGT/lisa#4643 item 9: the mergeability gate said
 * "Where both hold, the block is indefinite", which made
 * `dismiss_stale_reviews_on_push` a condition of the block.
 *
 * Since CodySwannGT/lisa#4574 the same section says a `CHANGES_REQUESTED`
 * review survives a push under either setting, so that setting decides nothing.
 * The block is indefinite whenever a stale change request stands; the approval
 * count only decides whether anything else is also waiting.
 *
 * Every copy root is asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/drive-pr-indefinite-block
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

describe.each(ROOTS)("drive-pr-to-merge indefinite block (%s)", root => {
  const content = readFileSync(
    path.resolve(root, "lisa-drive-pr-to-merge", "SKILL.md"),
    "utf8"
  );
  const start = content.indexOf("\n### The mergeability gate");
  const end = content.indexOf("\n## 2. The watch loop", start);
  const gate = content.slice(start, end);

  it("no longer conditions the block on both settings holding", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it("says a standing stale CHANGES_REQUESTED alone makes it indefinite, whatever the setting", () => {
    expect(gate).toMatch(
      /whenever a stale `CHANGES_REQUESTED` review\s+stands, the block is\s+\*\*indefinite, not slow\*\*/
    );
    expect(gate).toMatch(
      /whatever\s+`dismiss_stale_reviews_on_push` is set to/
    );
  });
});

/** Parent rollup guidance must use one change decision across agent surfaces. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
];

describe.each(ROOTS)("rollup deduplication in %s", root => {
  it("separates milestone body comparison from the classifier decision", () => {
    const content = readFileSync(`${root}/lisa-github-sync/SKILL.md`, "utf8");
    expect(content).toContain(
      "use `[claude-sync] rollup` only to locate the managed comment"
    );
  });
});

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
    const milestone = content
      .split("### Step 3: Post Update")[1]
      ?.split("### Step 3b:")[0];
    expect(milestone).toContain("For `--rollup`, skip this milestone path");
    expect(content).toContain("use `change.changed` as the dedupe decision");
    expect(content).toContain("Persist the classifier's `change.fingerprint`");
    expect(content).toContain("Use `change.summary` only as display text");
    expect(content).not.toContain(
      "fingerprint and `change.summary` deduplicate"
    );
    expect(content).not.toContain(
      "prefix on the most-recent comment is the dedupe key"
    );
    expect(content).toContain(
      "use `[claude-sync] rollup` only to locate the managed comment"
    );
  });
});

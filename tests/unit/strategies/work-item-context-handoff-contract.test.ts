/**
 * Ignore contract for the work-item context handoff (CodySwannGT/lisa#4323).
 *
 * The input-resolver persists the tracker bundle verbatim to
 * `.lisa/work-item-context.md`, a worktree-local file that must never be
 * committed. These assertions pin the ignore entry in the repository's own
 * `.gitignore` and the shipped `all/copy-contents/gitignore`: the exact path is
 * ignored, the `.lisa/` directory is not, and the shipped entry sits above the
 * EAS re-include marker. Whether the file is actually ignored is adjudicated by
 * git in `copy-contents-gitignore.test.ts`. The handoff instructions in the
 * skills and agents are guidance and are reviewed, not pinned (#4867).
 * @module tests/unit/strategies/work-item-context-handoff-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CONTEXT_FILE = ".lisa/work-item-context.md";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe("the context file is ignored, not the .lisa directory", () => {
  const rules = (relativePath: string): readonly string[] =>
    read(relativePath)
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));

  it.each([".gitignore", "all/copy-contents/gitignore"])(
    "%s carries the exact path",
    file => {
      expect(rules(file)).toContain(CONTEXT_FILE);
      expect(rules(file)).not.toContain(".lisa/");
    }
  );

  it("keeps the shipped entry above the EAS re-include marker", () => {
    const lines = read("all/copy-contents/gitignore").split("\n");
    expect(lines.indexOf(CONTEXT_FILE)).toBeGreaterThan(-1);
    expect(lines.indexOf(CONTEXT_FILE)).toBeLessThan(
      lines.indexOf("### EASINCLUDE! ###")
    );
  });
});

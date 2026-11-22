/**
 * Regression contract for SHA-scoped history-rewrite authorization (#1626).
 * Git discipline is emitted differently by each supported runtime. The rule's
 * guidance prose is not pinned (#4867); what stays is structural: generated
 * Markdown projections match their source byte for byte, Cursor's frontmatter
 * keeps the invariant always-on and the detail reference-only, and the
 * Antigravity generator keeps rules out of agy artifacts.
 * @module tests/unit/strategies/git-discipline-force-lease-contract
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const SOURCE_EAGER = "plugins/src/base/rules/eager/base-rules.md";
const SOURCE_REFERENCE = "plugins/src/base/rules/reference/base-rules.md";
const SHARED_EAGER = "plugins/lisa/rules/eager/base-rules.md";
const SHARED_REFERENCE = "plugins/lisa/rules/reference/base-rules.md";
const CURSOR_EAGER = "plugins/lisa-cursor/rules/base-rules.mdc";
const CURSOR_REFERENCE = "plugins/lisa-cursor/rules/base-rules-reference.mdc";
const COPILOT_EAGER = "plugins/lisa-copilot/rules/eager/base-rules.md";
const COPILOT_REFERENCE = "plugins/lisa-copilot/rules/reference/base-rules.md";

const MARKDOWN_PARITY = [
  [SOURCE_EAGER, SHARED_EAGER, COPILOT_EAGER],
  [SOURCE_REFERENCE, SHARED_REFERENCE, COPILOT_REFERENCE],
] as const;

describe.each(MARKDOWN_PARITY)(
  "generated Markdown parity (%s)",
  (sourcePath, claudePath, copilotPath) => {
    it("keeps Claude/Codex/OpenCode and Copilot byte-aligned to source", () => {
      const source = read(sourcePath);

      expect(read(claudePath)).toBe(source);
      expect(read(copilotPath)).toBe(source);
    });
  }
);

describe("Cursor delivery", () => {
  it("keeps the invariant always-on and the operational detail reference-only", () => {
    expect(read(CURSOR_EAGER)).toMatch(
      /^---\n(?:description: .+\n)?alwaysApply: true\n---/
    );
    expect(read(CURSOR_REFERENCE)).toMatch(
      /^---\ndescription: .+\nalwaysApply: false\n---/
    );
  });
});

describe("Antigravity rule-surface gap", () => {
  it("remains explicit rather than silently dropping a claimed rule projection", () => {
    const generator = read("scripts/generate-agy-plugin-artifacts.mjs");

    expect(generator).toMatch(/Rules remain out of agy artifacts/);
    expect(generator).toMatch(/NO .*rules\//);
    expect(existsSync(path.resolve("plugins/lisa-agy/rules"))).toBe(false);
  });
});

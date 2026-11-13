/**
 * Regression contract for SHA-scoped history-rewrite authorization (#1626).
 * Git discipline is emitted differently by each supported runtime, so every
 * equivalent committed projection must retain the same safety boundary.
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

// The full contract lives in the reference body. Since the 2026-11 eager-tier
// cut the always-loaded head carries only the SHA-bound lease and the void rule
// (asserted separately below), so the detailed wording is pinned on reference
// surfaces only.
const RULE_SURFACES = [
  SOURCE_REFERENCE,
  // Shared Claude artifact; Codex and OpenCode install these same rule files.
  SHARED_REFERENCE,
  CURSOR_REFERENCE,
  COPILOT_REFERENCE,
] as const;

const REFERENCE_SURFACES = [
  SOURCE_REFERENCE,
  SHARED_REFERENCE,
  CURSOR_REFERENCE,
  COPILOT_REFERENCE,
] as const;

const MARKDOWN_PARITY = [
  [SOURCE_EAGER, SHARED_EAGER, COPILOT_EAGER],
  [SOURCE_REFERENCE, SHARED_REFERENCE, COPILOT_REFERENCE],
] as const;

describe.each(RULE_SURFACES)(
  "SHA-scoped force-lease contract (%s)",
  rulePath => {
    const rule = read(rulePath);

    it("forbids plain force and prefers an explicit SHA-bound lease", () => {
      expect(rule).toContain("Never use plain `git push --force`");
    });
  }
);

describe.each(REFERENCE_SURFACES)(
  "operational force-lease guidance (%s)",
  rulePath => {
    const rule = read(rulePath);

    it("shows an explicit ref-and-SHA command and forbids implicit renewal", () => {
      expect(rule).toContain(
        "git push --force-with-lease=refs/heads/<branch>:<approved-sha> origin HEAD:refs/heads/<branch>"
      );
      expect(rule).toMatch(/or plain `--force`/);
    });
  }
);

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

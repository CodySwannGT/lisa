/**
 * Regression contract for SHA-scoped history-rewrite authorization (#1626).
 * Git discipline is emitted differently by each supported runtime, so every
 * equivalent committed projection must retain the same safety boundary.
 * @module tests/unit/strategies/git-discipline-force-lease-contract
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const RULE_SURFACES = [
  SOURCE_EAGER,
  SOURCE_REFERENCE,
  // Shared Claude artifact; Codex and OpenCode install these same rule files.
  SHARED_EAGER,
  SHARED_REFERENCE,
  CURSOR_EAGER,
  CURSOR_REFERENCE,
  COPILOT_EAGER,
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
      expect(rule).toContain("use `--force-with-lease`");
      expect(rule).toContain("`--force-with-lease=<ref>:<sha>`");
      expect(rule).toMatch(/exact remote tip the approval covered/);
    });

    it("voids stale approval instead of re-deriving consent", () => {
      expect(rule).toMatch(
        /History-rewrite approval is SHA-scoped, not durable/
      );
      expect(rule).toMatch(/remote ref moves or the lease rejects/);
      expect(rule).toMatch(/approval is void/);
      expect(rule).toMatch(/stop and obtain fresh confirmation/i);
      expect(rule).toMatch(
        /never re-derive consent from the earlier approval/i
      );
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
      expect(rule).toMatch(/fresh fetch as renewing authorization/);
      expect(rule).toMatch(/do not retry with an updated implicit lease/);
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

describe("safety-net support for the documented command", () => {
  it("allows an explicit SHA-bound lease", () => {
    const approvedSha = "0123456789abcdef0123456789abcdef01234567";
    const command =
      `git push --force-with-lease=refs/heads/main:${approvedSha} ` +
      "origin HEAD:refs/heads/main";
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    });
    const result = spawnSync(
      "/bin/bash",
      [path.resolve("plugins/lisa/hooks/parity-safety-net.sh")],
      { input, encoding: "utf8", env: process.env }
    );

    expect(result.status).toBe(0);
  });
});

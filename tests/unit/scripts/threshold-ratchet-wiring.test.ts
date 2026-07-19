/**
 * Tests for the threshold ratchet's enforcement-layer wiring: the plugin
 * hook manifest registration, husky/lefthook pre-commit backstops, the CI
 * gate in both reusable quality workflows, and byte-identical parity
 * between the canonical modules and their stack-template copies.
 * Comparator behavior lives in threshold-ratchet.test.ts (Tier 1) and
 * threshold-ratchet-gates.test.ts (Tiers 2/3).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_REL = "plugins/src/base/hooks";
const RATCHET_MODULES = [
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const TEMPLATE_SCRIPT_DIRS = [
  "typescript/copy-overwrite/scripts",
  "rails/copy-overwrite/scripts",
];
const ENTRY_TEMPLATE_NAME = "check-threshold-ratchet.mjs";

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

describe("threshold-ratchet wiring", () => {
  it("template copies are byte-identical to the canonical modules", () => {
    for (const dir of TEMPLATE_SCRIPT_DIRS) {
      expect(
        read(`${dir}/${ENTRY_TEMPLATE_NAME}`),
        `${dir}/${ENTRY_TEMPLATE_NAME}`
      ).toBe(read(`${HOOKS_REL}/threshold-ratchet.mjs`));
      for (const module of RATCHET_MODULES) {
        expect(read(`${dir}/${module}`), `${dir}/${module}`).toBe(
          read(`${HOOKS_REL}/${module}`)
        );
      }
    }
  });

  it("registers the PostToolUse hook in the base plugin manifest", () => {
    const manifest = JSON.parse(
      read("plugins/src/base/.claude-plugin/plugin.json")
    );
    const postToolUse: Array<{
      matcher?: string;
      hooks: Array<{ command: string }>;
    }> = manifest.hooks.PostToolUse;
    const entry = postToolUse.find(e =>
      e.hooks.some(h => h.command.includes("threshold-ratchet.sh"))
    );
    expect(entry).toBeDefined();
    expect(entry?.matcher).toBe("Edit|Write|NotebookEdit|Bash");
  });

  it("wires the husky pre-commit backstop", () => {
    const preCommit = read("typescript/copy-contents/.husky/pre-commit");
    expect(preCommit).toContain(ENTRY_TEMPLATE_NAME);
    expect(preCommit).toContain("--staged");
  });

  it("wires the rails lefthook backstop", () => {
    const lefthook = read("rails/copy-overwrite/lefthook.yml");
    expect(lefthook).toContain(ENTRY_TEMPLATE_NAME);
    expect(lefthook).toContain("--staged");
  });

  it("wires the CI gate into both reusable quality workflows", () => {
    for (const workflow of [
      ".github/workflows/quality.yml",
      ".github/workflows/quality-rails.yml",
    ]) {
      const text = read(workflow);
      expect(text, workflow).toContain("threshold_ratchet:");
      expect(text, workflow).toContain(`${ENTRY_TEMPLATE_NAME} --base`);
    }
  });

  it("ships the hook wrapper alongside the comparator in the base plugin", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, HOOKS_REL, "threshold-ratchet.sh"))
    ).toBe(true);
  });
});

/**
 * Delivery identity is separate from runtime proof. Invoke the actual shipped
 * pair without source-tree helpers, and pin each native registration or gap.
 * @module tests/integration/enforcement-fallback-freshness-delivery
 */
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withoutOwnershipHeader } from "../../scripts/materialize-copy-overwrite.mjs";
import {
  cleanupScratchRoots,
  REPO_ROOT,
  scratchRoot,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
} from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

const FALLBACK = "lisa-enforcement-fallback.sh";

/**
 * Read an actual source or generated registration, not a fixture copy.
 * @param file Repository-relative artifact path.
 * @returns Artifact text.
 */
function text(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

describe("shared delivered fallback freshness", () => {
  it("delivers the canonical dispatcher and optional helper together with manifest ownership", () => {
    const manifest = JSON.parse(
      text("plugins/materialized-artifacts.json")
    ) as readonly string[];
    for (const name of [FALLBACK, "lisa-enforcement-freshness.mjs"]) {
      const delivered = `all/copy-overwrite/scripts/${name}`;
      expect(manifest).toContain(delivered);
      expect(withoutOwnershipHeader(text(delivered), delivered)).toBe(
        text(`scripts/${name}`)
      );
    }
  });

  it("runs the delivered pair in a consumer layout with no source repository dependency", () => {
    const root = currentHost();
    const scripts = scratchRoot();
    for (const name of [FALLBACK, "lisa-enforcement-freshness.mjs"]) {
      copyFileSync(
        path.join(REPO_ROOT, "all/copy-overwrite/scripts", name),
        path.join(scripts, name)
      );
    }
    const result = driveFreshness(root, undefined, {
      subject: path.join(scripts, FALLBACK),
    });
    expect(result.status).toBe(2);
    expect(result.output).toContain("matches installed template");
    expect(result.output).not.toContain("STALE");
    expect(result.output).not.toContain("npx @codyswann/lisa apply");
  });

  it.each([
    ["Claude Code", "all/merge/.claude/settings.json"],
    ["Codex", "src/codex/enforcement-fallback-installer.ts"],
  ])(
    "preserves %s's existing repository fallback registration",
    (_agent, file) => {
      expect(text(file)).toContain(FALLBACK);
      expect(text(file)).toContain("PreToolUse");
    }
  );

  it.each([
    ["Cursor", "plugins/lisa-cursor/hooks/hooks.json"],
    ["OpenCode", "src/opencode/plugin-templates/lisa-block-no-verify.ts"],
    ["Antigravity", "plugins/lisa-agy/hooks.json"],
    ["Copilot", "plugins/lisa-copilot/.claude-plugin/plugin.json"],
  ])(
    "documents %s's individual guard surface and aggregate diagnostic representation gap",
    (agent, file) => {
      expect(text(file)).toContain("block-no-verify");
      expect(text(file)).not.toContain(FALLBACK);
      expect(text("README.md")).toContain(`| ${agent} |`);
      expect(text("README.md")).toContain("aggregate diagnostic");
    }
  );
});

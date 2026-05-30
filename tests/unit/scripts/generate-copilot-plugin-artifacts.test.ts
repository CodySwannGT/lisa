/**
 * Behavior tests for scripts/generate-copilot-plugin-artifacts.mjs (issue #1056).
 *
 * Two verified-by-run mismatches against GitHub Copilot CLI 1.0.55:
 *   1. subagentStart: an emitted `subagentStart` hook (empty matcher) makes
 *      Copilot reject the ENTIRE inline hooks config, so NO hooks fire. The
 *      generator must drop the event for Copilot while keeping inject-rules.sh
 *      under sessionStart (no rule-delivery loss).
 *   2. MCP: Copilot does not auto-discover a plugin's bundled `.mcp.json`, nor a
 *      `".mcp.json"` path-string pointer; only an inline `mcpServers` OBJECT in
 *      the manifest loads. The generator must mirror `.mcp.json`'s servers inline.
 *
 * The fixture is scaffolded with the shared `scaffoldSource` helper; the
 * generator reads the repo's committed probe cache (rulesAutoLoads:false), so
 * inject-rules.sh ships — the realistic path that reproduced the bug.
 * @module tests/unit/scripts/generate-copilot-plugin-artifacts
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCopilotVariant } from "../../../scripts/generate-copilot-plugin-artifacts.mjs";
import {
  BLOCK_NO_VERIFY,
  CLAUDE_PLUGIN_DIR,
  INJECT_RULES,
  PLUGIN_JSON,
  scaffoldSource,
} from "./cursor-artifact-helpers";

const ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";

const entry = (matcher: string, ...scripts: readonly string[]) => ({
  matcher,
  hooks: scripts.map(s => ({ type: "command", command: `${ROOT}${s}` })),
});

// A base-style hook block carrying the buggy SubagentStart(inject-rules) entry.
const HOOK_BLOCK_WITH_SUBAGENT_START = {
  PreToolUse: [entry("Bash", BLOCK_NO_VERIFY)],
  SessionStart: [entry("", INJECT_RULES)],
  SubagentStart: [entry("", INJECT_RULES)],
};

const readManifest = (outDir: string): Record<string, unknown> =>
  fs.readJsonSync(path.join(outDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON));

describe("generate-copilot-plugin-artifacts (issue #1056)", () => {
  let tempDir: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-gen-test-"));
    srcDir = path.join(tempDir, "src");
    outDir = path.join(tempDir, "lisa-copilot");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("subagentStart stripping (hook-firing fix)", () => {
    beforeEach(async () => {
      await scaffoldSource(srcDir, {
        hooks: HOOK_BLOCK_WITH_SUBAGENT_START,
        withMcp: false,
      });
      generateCopilotVariant(srcDir, outDir, "1.2.3");
    });

    it("omits subagentStart but keeps camelCase preToolUse + sessionStart", () => {
      const hooks = (readManifest(outDir).hooks ?? {}) as Record<
        string,
        unknown
      >;
      expect("subagentStart" in hooks).toBe(false);
      expect("SubagentStart" in hooks).toBe(false);
      expect("preToolUse" in hooks).toBe(true);
      expect("sessionStart" in hooks).toBe(true);
    });

    it("still delivers inject-rules.sh via sessionStart (no rule-delivery loss)", () => {
      const hooks = (readManifest(outDir).hooks ?? {}) as Record<
        string,
        ReadonlyArray<{ hooks: ReadonlyArray<{ command: string }> }>
      >;
      const sessionCmds = (hooks.sessionStart ?? []).flatMap(e =>
        e.hooks.map(h => h.command)
      );
      expect(sessionCmds.some(c => c.includes(INJECT_RULES))).toBe(true);
    });
  });

  describe("MCP inline pointer", () => {
    it("mirrors a bundled .mcp.json's servers into an inline manifest mcpServers object", async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: true });
      generateCopilotVariant(srcDir, outDir, "1.2.3");
      const manifest = readManifest(outDir);
      expect(manifest.mcpServers).toEqual({
        expo: { type: "http", url: "https://mcp.expo.dev/mcp" },
      });
      // The .mcp.json file is retained as the source of truth.
      expect(fs.existsSync(path.join(outDir, ".mcp.json"))).toBe(true);
    });

    it("adds no mcpServers field when the variant ships no .mcp.json", async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: false });
      generateCopilotVariant(srcDir, outDir, "1.2.3");
      expect("mcpServers" in readManifest(outDir)).toBe(false);
    });

    it("degrades gracefully on a malformed .mcp.json (no pointer, no throw)", async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: true });
      // Corrupt the .mcp.json the scaffold wrote.
      await fs.writeFile(path.join(srcDir, ".mcp.json"), "{ not json", "utf8");
      expect(() =>
        generateCopilotVariant(srcDir, outDir, "1.2.3")
      ).not.toThrow();
      expect("mcpServers" in readManifest(outDir)).toBe(false);
    });
  });
});

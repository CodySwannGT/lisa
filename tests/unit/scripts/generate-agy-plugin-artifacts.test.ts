/**
 * Unit tests for scripts/generate-agy-plugin-artifacts.mjs.
 *
 * The agy variant generator copies + reshapes the Claude artifact AND emits a
 * PLUGIN-BUNDLED root `hooks.json` (agy 1.0.3 loads a plugin's hooks only from a
 * `hooks.json` at the installed plugin ROOT — not a `hooks/` subdir, not the
 * manifest). Schema: top-level HOOK NAME → event → handlers, matcher
 * `run_command`, command pointing at the `$HOME`-absolute installed script.
 * Only the BASE variant (whose manifest carries block-no-verify) emits a
 * hooks.json; stack variants emit none. SessionStart scripts (install-pkgs /
 * setup-jira-cli) are NOT portable to agy. MCP is user-global (no mcp_config in
 * the artifact); `.mcp.json` and `rules/` are stripped.
 * @module tests/unit/scripts/generate-agy-plugin-artifacts
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAgyVariant } from "../../../scripts/generate-agy-plugin-artifacts.mjs";

const ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";
const PLUGIN_JSON = "plugin.json";
const CLAUDE_PLUGIN_DIR = ".claude-plugin";
const HOOKS_JSON = "hooks.json";
const BLOCK_NO_VERIFY = "block-no-verify.sh";
const BLOCK_NO_VERIFY_AGY = "block-no-verify.agy.sh";
const INSTALL_PKGS = "install-pkgs.sh";
const SETUP_JIRA = "setup-jira-cli.sh";

const scriptEntry = (...scripts: readonly string[]) => ({
  matcher: "",
  hooks: scripts.map(s => ({ type: "command", command: `${ROOT}${s}` })),
});

// Base manifest hook block: block-no-verify (PreToolUse) is the only agy-portable
// one; the SessionStart scripts must be ignored by the agy hooks emission.
const BASE_HOOK_BLOCK = {
  PreToolUse: [{ ...scriptEntry(BLOCK_NO_VERIFY), matcher: "Bash" }],
  SessionStart: [scriptEntry(INSTALL_PKGS, SETUP_JIRA)],
};

/**
 * Scaffold a built-Claude-plugin fixture under srcDir.
 * @param srcDir Absolute source plugin dir to populate.
 * @param opts Options.
 * @param opts.hooks Manifest hook block (omit/`{}` to simulate a stack variant).
 * @param opts.withMcp Whether to write a `.mcp.json`.
 * @returns Promise resolved once the fixture is written.
 */
async function scaffoldSource(
  srcDir: string,
  opts: { readonly hooks?: object; readonly withMcp?: boolean }
): Promise<void> {
  await fs.ensureDir(path.join(srcDir, CLAUDE_PLUGIN_DIR));
  await fs.writeJson(path.join(srcDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON), {
    name: "lisa-test",
    version: "0.0.0",
    hooks: opts.hooks ?? {},
    mcpServers: { stale: { type: "http", url: "https://x.example/mcp" } },
  });
  // The built Claude plugin's hooks/ holds the agy-protocol script the
  // generator copies into the variant.
  await fs.ensureDir(path.join(srcDir, "hooks"));
  await fs.writeFile(
    path.join(srcDir, "hooks", BLOCK_NO_VERIFY_AGY),
    '#!/usr/bin/env bash\necho \'{"decision":"allow"}\'\n',
    "utf8"
  );
  // A stale Codex-shaped hooks/hooks.json that must NOT survive.
  await fs.writeJson(path.join(srcDir, "hooks", HOOKS_JSON), { hooks: {} });
  await fs.ensureDir(path.join(srcDir, "rules", "eager"));
  await fs.writeFile(path.join(srcDir, "rules", "eager", "core.md"), "# r\n");
  if (opts.withMcp) {
    await fs.writeJson(path.join(srcDir, ".mcp.json"), {
      mcpServers: { expo: { type: "http", url: "https://mcp.expo.dev/mcp" } },
    });
  }
}

describe("generate-agy-plugin-artifacts (plugin-bundled root hooks.json)", () => {
  let tempDir: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-gen-test-"));
    srcDir = path.join(tempDir, "src");
    // outDir basename is the variant name baked into the command path.
    outDir = path.join(tempDir, "lisa-agy");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("base variant (manifest carries block-no-verify)", () => {
    beforeEach(async () => {
      await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK, withMcp: true });
      generateAgyVariant(srcDir, outDir, "1.2.3");
    });

    it("emits a root hooks.json in agy schema (hook-name → PreToolUse → run_command)", () => {
      const cfg = fs.readJsonSync(path.join(outDir, HOOKS_JSON));
      expect(Object.keys(cfg)).toEqual(["lisa-block-no-verify"]);
      const group = cfg["lisa-block-no-verify"].PreToolUse[0];
      expect(group.matcher).toBe("run_command");
      const command = group.hooks[0].command;
      expect(group.hooks[0].type).toBe("command");
      // $HOME-absolute path into the installed plugin, with the variant baked in.
      expect(command).toContain(
        `$HOME/.gemini/config/plugins/lisa-agy/hooks/${BLOCK_NO_VERIFY_AGY}`
      );
    });

    it("does NOT include SessionStart scripts (agy lacks SessionStart)", () => {
      const cfg = fs.readJsonSync(path.join(outDir, HOOKS_JSON));
      const serialized = JSON.stringify(cfg);
      expect(serialized).not.toContain(INSTALL_PKGS);
      expect(serialized).not.toContain(SETUP_JIRA);
      expect(serialized).not.toContain("SessionStart");
    });

    it("ships the agy-protocol script under hooks/ (executable), no subdir hooks.json", () => {
      const scriptPath = path.join(outDir, "hooks", BLOCK_NO_VERIFY_AGY);
      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.statSync(scriptPath).mode & 0o100).toBe(0o100);
      // The stale Codex-shaped hooks/hooks.json must NOT survive.
      expect(fs.existsSync(path.join(outDir, "hooks", HOOKS_JSON))).toBe(false);
    });

    it("ships NO mcp_config.json, NO .mcp.json, NO rules/", () => {
      expect(fs.existsSync(path.join(outDir, "mcp_config.json"))).toBe(false);
      expect(fs.existsSync(path.join(outDir, ".mcp.json"))).toBe(false);
      expect(fs.existsSync(path.join(outDir, "rules"))).toBe(false);
    });

    it("writes a bare plugin.json with no hooks/mcpServers and no .claude-plugin/", () => {
      const manifest = fs.readJsonSync(path.join(outDir, PLUGIN_JSON));
      expect(manifest.version).toBe("1.2.3");
      expect("hooks" in manifest).toBe(false);
      expect("mcpServers" in manifest).toBe(false);
      expect(fs.existsSync(path.join(outDir, CLAUDE_PLUGIN_DIR))).toBe(false);
    });
  });

  describe("stack variant (empty manifest hooks)", () => {
    it("emits NO hooks.json and NO hooks/ dir", async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: true });
      generateAgyVariant(srcDir, outDir, "1.2.3");
      expect(fs.existsSync(path.join(outDir, HOOKS_JSON))).toBe(false);
      expect(fs.existsSync(path.join(outDir, "hooks"))).toBe(false);
      // Still drops MCP/rules.
      expect(fs.existsSync(path.join(outDir, "mcp_config.json"))).toBe(false);
      expect(fs.existsSync(path.join(outDir, ".mcp.json"))).toBe(false);
      expect(fs.existsSync(path.join(outDir, "rules"))).toBe(false);
    });
  });

  describe("error handling: missing agy hook script", () => {
    it("throws when a mapped agy script is referenced in source hooks but absent from srcDir/hooks/", async () => {
      // Scaffold a source that references block-no-verify in its hooks, but
      // does NOT include block-no-verify.agy.sh in hooks/ — simulating a
      // corrupted or incomplete build artifact.
      await fs.ensureDir(path.join(srcDir, CLAUDE_PLUGIN_DIR));
      await fs.writeJson(path.join(srcDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON), {
        name: "lisa-test",
        version: "0.0.0",
        hooks: BASE_HOOK_BLOCK,
        mcpServers: {},
      });
      await fs.ensureDir(path.join(srcDir, "hooks"));
      // Intentionally do NOT write block-no-verify.agy.sh.

      expect(() => generateAgyVariant(srcDir, outDir, "1.2.3")).toThrow(
        /Missing agy hook script/
      );
    });

    it("does NOT emit a hooks.json when the mapped script is missing (no broken artifact)", async () => {
      await fs.ensureDir(path.join(srcDir, CLAUDE_PLUGIN_DIR));
      await fs.writeJson(path.join(srcDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON), {
        name: "lisa-test",
        version: "0.0.0",
        hooks: BASE_HOOK_BLOCK,
        mcpServers: {},
      });
      await fs.ensureDir(path.join(srcDir, "hooks"));
      // No agy script present.

      try {
        generateAgyVariant(srcDir, outDir, "1.2.3");
      } catch {
        // Expected throw — assert no partial artifact was written.
      }
      expect(fs.existsSync(path.join(outDir, HOOKS_JSON))).toBe(false);
    });
  });
});

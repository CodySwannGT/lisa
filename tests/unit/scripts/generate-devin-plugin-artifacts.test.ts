/**
 * Behavior tests for scripts/generate-devin-plugin-artifacts.mjs
 * (CodySwannGT/lisa#4426).
 *
 * Each assertion pins a Devin CLI behavior measured by run on 3000.11.3:
 *   - plugin hooks load only from a ROOT `hooks.json` (inline manifest hooks are ignored);
 *   - Devin's tools are named `exec` / `write` / `edit` / …, so Claude matchers never fire;
 *   - Lisa's guards test `tool_name == "Bash"`, so a firing hook without the
 *     tool-name shim still stands down (the shim test below is the A/B control).
 * @module tests/unit/scripts/generate-devin-plugin-artifacts
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDevinVariant } from "../../../scripts/generate-devin-plugin-artifacts.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  BASE_HOOK_BLOCK,
  BLOCK_NO_VERIFY,
  CLAUDE_PLUGIN_DIR,
  DOT_MCP_JSON,
  HOOKS_JSON,
  ENFORCE_TEAM_FIRST,
  PLUGIN_JSON,
  scaffoldSource,
} from "./cursor-artifact-helpers.js";

const SHIM = "devin-tool-name-shim.sh";
const ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";
const VERSION = "9.9.9";

interface DevinHandler {
  readonly type: string;
  readonly command: string;
}
interface DevinEntry {
  readonly matcher?: string;
  readonly hooks: readonly DevinHandler[];
}
type DevinHooks = Record<string, readonly DevinEntry[]>;

const readHooks = (outDir: string): DevinHooks =>
  (fs.readJsonSync(path.join(outDir, HOOKS_JSON)) as { hooks: DevinHooks })
    .hooks;

describe("generate-devin-plugin-artifacts (#4426)", () => {
  let tempDir: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "devin-gen-test-"));
    srcDir = path.join(tempDir, "src");
    outDir = path.join(tempDir, "lisa-devin");
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("writes a native .devin-plugin manifest that keeps the Claude plugin name", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    generateDevinVariant(srcDir, outDir, VERSION);

    const manifest = fs.readJsonSync(
      path.join(outDir, ".devin-plugin", PLUGIN_JSON)
    );
    expect(manifest).toEqual({ name: "lisa-test", version: VERSION });
  });

  it("moves hooks out of the Claude manifest into a root hooks.json", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    generateDevinVariant(srcDir, outDir, VERSION);

    const claudeCopy = fs.readJsonSync(
      path.join(outDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON)
    );
    expect(claudeCopy.hooks).toBeUndefined();
    expect(
      Object.keys(readHooks(outDir)).sort((a: string, b: string) =>
        a.localeCompare(b)
      )
    ).toEqual(["PreToolUse", "SessionStart"]);
  });

  it("translates Claude tool matchers to anchored Devin tool names", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    generateDevinVariant(srcDir, outDir, VERSION);

    const [preToolUse] = readHooks(outDir).PreToolUse ?? [];
    expect(preToolUse?.matcher).toBe("^(exec)$");
  });

  it("drops session-source matchers because Devin tests matchers against tool_name only", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    generateDevinVariant(srcDir, outDir, VERSION);

    const sessionStart = readHooks(outDir).SessionStart ?? [];
    expect(sessionStart.every(entry => entry.matcher === undefined)).toBe(true);
  });

  it("routes every handler through the tool-name shim", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    generateDevinVariant(srcDir, outDir, VERSION);

    const commands = Object.values(readHooks(outDir)).flatMap(entries =>
      entries.flatMap(entry => entry.hooks.map(h => h.command))
    );
    expect(commands).toContain(`${ROOT}${SHIM} ${ROOT}${BLOCK_NO_VERIFY}`);
    expect(commands.every(c => c.startsWith(`${ROOT}${SHIM} `))).toBe(true);
  });

  it("strips Claude-only hooks, entire calls, and commands", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
    await fs.outputFile(path.join(srcDir, "commands", "lisa", "x.md"), "# x\n");
    generateDevinVariant(srcDir, outDir, VERSION);

    const raw = fs.readFileSync(path.join(outDir, HOOKS_JSON), "utf8");
    expect(raw).not.toContain("entire hooks");
    expect(raw).not.toContain(ENFORCE_TEAM_FIRST);
    expect(fs.existsSync(path.join(outDir, "hooks", ENFORCE_TEAM_FIRST))).toBe(
      false
    );
    expect(fs.existsSync(path.join(outDir, "commands"))).toBe(false);
  });

  it("keeps skills, the nested rules tree, and the root .mcp.json", async () => {
    await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK, withMcp: true });
    generateDevinVariant(srcDir, outDir, VERSION);

    expect(
      fs.existsSync(path.join(outDir, "skills", "lisa-demo", "SKILL.md"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outDir, "rules", "eager", "base-rules.md"))
    ).toBe(true);
    expect(fs.existsSync(path.join(outDir, DOT_MCP_JSON))).toBe(true);
  });

  it("emits neither hooks.json nor the shim for a plugin without hooks", async () => {
    await scaffoldSource(srcDir, {});
    await fs.remove(path.join(srcDir, "hooks"));
    generateDevinVariant(srcDir, outDir, VERSION);

    expect(fs.existsSync(path.join(outDir, HOOKS_JSON))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "hooks", SHIM))).toBe(false);
  });

  it("does nothing when the source has no Claude manifest", async () => {
    await fs.ensureDir(srcDir);
    generateDevinVariant(srcDir, outDir, VERSION);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  describe("tool-name shim", () => {
    const captureGuard = async (dir: string): Promise<string> => {
      const guard = path.join(dir, "capture.sh");
      await fs.writeFile(
        guard,
        '#!/bin/sh\njq -r .tool_name\n[ "$1" = arg ] || exit 7\nexit 2\n',
        { mode: 0o755 }
      );
      return guard;
    };

    it("rewrites a Devin tool_name to the Claude name and preserves the guard's exit status", async () => {
      await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
      generateDevinVariant(srcDir, outDir, VERSION);
      const guard = await captureGuard(tempDir);

      const result = boundedSpawnSync({
        label: "devin tool-name shim (exec)",
        command: path.join(outDir, "hooks", SHIM),
        args: [guard, "arg"],
        input: JSON.stringify({
          tool_name: "exec",
          tool_input: { command: "ls" },
        }),
      });

      expect(result.stdout.trim()).toBe("Bash");
      expect(result.status).toBe(2);
    });

    it("passes names it does not know through unchanged", async () => {
      await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK });
      generateDevinVariant(srcDir, outDir, VERSION);
      const guard = await captureGuard(tempDir);

      const result = boundedSpawnSync({
        label: "devin tool-name shim (mcp passthrough)",
        command: path.join(outDir, "hooks", SHIM),
        args: [guard, "arg"],
        input: JSON.stringify({ tool_name: "mcp__github__create_issue" }),
      });

      expect(result.stdout.trim()).toBe("mcp__github__create_issue");
    });
  });
});

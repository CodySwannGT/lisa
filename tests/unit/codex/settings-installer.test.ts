/**
 * Unit tests for the .codex/config.toml settings installer.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILENAME,
  LISA_REQUIRED_SETTINGS,
  installSettings,
  mergeSettings,
} from "../../../src/codex/settings-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/settings-installer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("mergeSettings (pure)", () => {
    it("emits Lisa-required keys when input is empty", () => {
      const out = mergeSettings("");
      const parsed = parseToml(out) as Record<string, unknown>;
      for (const [key, value] of Object.entries(LISA_REQUIRED_SETTINGS)) {
        expect(parsed[key]).toBe(value);
      }
    });

    it("includes a managed-by-Lisa header in fresh files", () => {
      const out = mergeSettings("");
      expect(out).toMatch(/managed by Lisa/i);
    });

    it("preserves host keys when merging into existing TOML", () => {
      const existing = `model = "gpt-5"\napproval_policy = "on-request"\n`;
      const out = mergeSettings(existing);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.model).toBe("gpt-5");
      expect(parsed.approval_policy).toBe("on-request");
      // And Lisa's keys are added on top
      expect(parsed.project_doc_max_bytes).toBe(65536);
    });

    it("Lisa keys win on conflict with host keys", () => {
      const existing = `project_doc_max_bytes = 1024\n`;
      const out = mergeSettings(existing);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.project_doc_max_bytes).toBe(65536);
    });

    it("preserves existing comments through round-trip", () => {
      const existing = `# This is my host config
# Important comment here
model = "gpt-5"
`;
      const out = mergeSettings(existing);
      expect(out).toContain("# This is my host config");
      expect(out).toContain("# Important comment here");
    });

    it("preserves nested tables", () => {
      const existing = `[mcp_servers.linear]
command = "linear-mcp"
`;
      const out = mergeSettings(existing);
      const parsed = parseToml(out) as Record<string, unknown>;
      const mcp = parsed.mcp_servers as Record<string, unknown>;
      const linear = mcp.linear as Record<string, unknown>;
      expect(linear.command).toBe("linear-mcp");
      expect(parsed.project_doc_max_bytes).toBe(65536);
    });

    it("emits a trailing newline", () => {
      const out = mergeSettings("");
      expect(out.endsWith("\n")).toBe(true);
    });

    it("preserves trailing newline through merge", () => {
      const out = mergeSettings(`model = "gpt-5"\n`);
      expect(out.endsWith("\n")).toBe(true);
    });
  });

  describe("installSettings (I/O)", () => {
    it("creates .codex/config.toml when absent", async () => {
      const result = await installSettings(tempDir);
      expect(result.created).toBe(true);
      expect(result.managedFiles).toEqual([CONFIG_FILENAME]);
      const content = await fs.readFile(
        path.join(tempDir, ".codex", CONFIG_FILENAME),
        "utf8"
      );
      const parsed = parseToml(content) as Record<string, unknown>;
      expect(parsed.project_doc_max_bytes).toBe(65536);
    });

    it("merges into existing config.toml", async () => {
      const codexDir = path.join(tempDir, ".codex");
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, CONFIG_FILENAME),
        `# Host-authored\nmodel = "gpt-5.4-mini"\n`,
        "utf8"
      );
      const result = await installSettings(tempDir);
      expect(result.created).toBe(false);
      const content = await fs.readFile(
        path.join(codexDir, CONFIG_FILENAME),
        "utf8"
      );
      expect(content).toContain("# Host-authored");
      expect(content).toContain('model = "gpt-5.4-mini"');
      const parsed = parseToml(content) as Record<string, unknown>;
      expect(parsed.project_doc_max_bytes).toBe(65536);
    });

    it("idempotent: running twice produces the same content", async () => {
      await installSettings(tempDir);
      const first = await fs.readFile(
        path.join(tempDir, ".codex", CONFIG_FILENAME),
        "utf8"
      );
      await installSettings(tempDir);
      const second = await fs.readFile(
        path.join(tempDir, ".codex", CONFIG_FILENAME),
        "utf8"
      );
      expect(second).toBe(first);
    });

    it("creates the .codex directory if absent", async () => {
      await installSettings(tempDir);
      expect(await fs.pathExists(path.join(tempDir, ".codex"))).toBe(true);
    });
  });
});

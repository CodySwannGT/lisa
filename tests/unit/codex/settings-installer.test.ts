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
      expect((parsed.features as Record<string, unknown>).hooks).toBe(true);
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
      expect((parsed.features as Record<string, unknown>).hooks).toBe(true);
    });

    it("Lisa keys win on conflict with host keys", () => {
      const existing = `project_doc_max_bytes = 1024\n`;
      const out = mergeSettings(existing);
      const parsed = parseToml(out) as Record<string, unknown>;
      expect(parsed.project_doc_max_bytes).toBe(65536);
      expect((parsed.features as Record<string, unknown>).hooks).toBe(true);
    });

    it("preserves a host inline comment while overwriting the value via toml-patch", () => {
      // A value different from Lisa's 65536 forces the toml-patch update path
      // (applyUpdatedKeys → patchToml), which is the ONLY reason
      // @decimalturn/toml-patch is a dependency: it must rewrite the value in
      // place without dropping the surrounding comment. A comment-dropping
      // regression in that library would break this and nothing else caught it.
      const existing = `project_doc_max_bytes = 1024  # keep this comment\n`;
      const out = mergeSettings(existing);
      const parsed = parseToml(out) as Record<string, unknown>;
      // (a) Lisa's winning numeric value replaced the host's 1024
      expect(parsed.project_doc_max_bytes).toBe(65536);
      // (b) ...and the host's inline comment survived the in-place patch
      expect(out).toContain("# keep this comment");
    });

    it("adds hooks to an existing features table", () => {
      const out = mergeSettings(`[features]\nmodel_reasoning_summary = true\n`);
      const parsed = parseToml(out) as Record<string, unknown>;
      const features = parsed.features as Record<string, unknown>;
      expect(features.model_reasoning_summary).toBe(true);
      expect(features.hooks).toBe(true);
    });

    it("migrates codex_hooks in place and preserves its inline comment", () => {
      const out = mergeSettings(
        `[features]\ncodex_hooks = false # disabled while debugging\n`
      );
      expect(out).toContain("hooks = true # disabled while debugging");
      expect(out).not.toContain("codex_hooks");
      const parsed = parseToml(out) as Record<string, unknown>;
      expect((parsed.features as Record<string, unknown>).hooks).toBe(true);
    });

    it("leaves matching hooks lines unchanged", () => {
      const existing = `[features]\nhooks = true # keep this note\n`;
      const out = mergeSettings(existing);
      expect(out).toContain("hooks = true # keep this note");
      expect(out.match(/^hooks\s*=/gm)).toHaveLength(1);
    });

    it("removes codex_hooks when hooks already exists", () => {
      const existing = `[features]\nhooks = false # current key\ncodex_hooks = true # legacy key\nmodel_reasoning_summary = true\n`;
      const out = mergeSettings(existing);
      const features = (parseToml(out) as Record<string, unknown>)
        .features as Record<string, unknown>;
      expect(out).toContain("hooks = true # current key");
      expect(out).toContain("model_reasoning_summary = true");
      expect(out).not.toContain("codex_hooks");
      expect(features.hooks).toBe(true);
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

    it("preserves inline comments when updating an existing features key", () => {
      const existing = `[features]\nhooks = false # disabled while debugging\n`;
      const out = mergeSettings(existing);
      expect(out).toContain("# disabled while debugging");
      const parsed = parseToml(out) as Record<string, unknown>;
      expect((parsed.features as Record<string, unknown>).hooks).toBe(true);
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

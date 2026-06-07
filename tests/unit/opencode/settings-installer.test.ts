/**
 * Unit tests for src/opencode/settings-installer.ts.
 *
 * Covers the pure `mergeSettings` merge (fresh file, host-preserving merge,
 * forced `share: "disabled"`, default-only `$schema`, JSONC tolerance,
 * malformed-input rejection) and the `installSettings` I/O wrapper.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILENAME,
  OPENCODE_SCHEMA_URL,
  installSettings,
  mergeSettings,
} from "../../../src/opencode/settings-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("opencode/settings-installer", () => {
  describe("mergeSettings", () => {
    it("synthesizes a clean Lisa-authored document for empty input", () => {
      const out = mergeSettings("");
      const parsed = parseJsonc(out) as Record<string, unknown>;
      expect(parsed).toEqual({
        $schema: OPENCODE_SCHEMA_URL,
        share: "disabled",
      });
      expect(out.endsWith("\n")).toBe(true);
    });

    it("treats whitespace-only input as empty", () => {
      const parsed = parseJsonc(mergeSettings("   \n\t ")) as Record<
        string,
        unknown
      >;
      expect(parsed["share"]).toBe("disabled");
    });

    it("forces share to disabled even when the host enabled sharing", () => {
      const host = `{
  "$schema": "${OPENCODE_SCHEMA_URL}",
  "share": "auto",
  "model": "anthropic/claude-sonnet-4-5"
}`;
      const out = mergeSettings(host);
      const parsed = parseJsonc(out) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
      // Host key preserved.
      expect(parsed["model"]).toBe("anthropic/claude-sonnet-4-5");
    });

    it("preserves host comments while merging (JSONC round-trip)", () => {
      const host = `{
  // host's own model pin
  "model": "anthropic/claude-sonnet-4-5",
  "share": "manual"
}`;
      const out = mergeSettings(host);
      expect(out).toContain("// host's own model pin");
      const parsed = parseJsonc(out) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
      expect(parsed["model"]).toBe("anthropic/claude-sonnet-4-5");
    });

    it("adds $schema only when the host omitted it", () => {
      const out = mergeSettings(`{ "share": "manual" }`);
      const parsed = parseJsonc(out) as Record<string, unknown>;
      expect(parsed["$schema"]).toBe(OPENCODE_SCHEMA_URL);
    });

    it("does NOT clobber a host-pinned $schema", () => {
      const host = `{ "$schema": "https://example.com/custom.json", "share": "manual" }`;
      const parsed = parseJsonc(mergeSettings(host)) as Record<string, unknown>;
      expect(parsed["$schema"]).toBe("https://example.com/custom.json");
      expect(parsed["share"]).toBe("disabled");
    });

    it("is a no-op (idempotent) when already correct", () => {
      const settled = mergeSettings("");
      expect(mergeSettings(settled)).toBe(settled);
    });

    it("throws on malformed JSON rather than overwriting host config", () => {
      expect(() => mergeSettings(`{ "share": }`)).toThrow(/not valid JSONC/u);
    });

    it("tolerates trailing commas", () => {
      const parsed = parseJsonc(
        mergeSettings(`{ "model": "x", "share": "manual", }`)
      ) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
      expect(parsed["model"]).toBe("x");
    });
  });

  describe("installSettings", () => {
    let destDir: string;

    beforeEach(async () => {
      destDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(destDir);
    });

    it("creates opencode.json when absent and reports created=true", async () => {
      const result = await installSettings(destDir);
      expect(result.created).toBe(true);
      expect(result.managedFiles).toEqual([CONFIG_FILENAME]);
      const written = await fs.readFile(
        path.join(destDir, CONFIG_FILENAME),
        "utf8"
      );
      const parsed = parseJsonc(written) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
    });

    it("merges into an existing file and reports created=false", async () => {
      const configPath = path.join(destDir, CONFIG_FILENAME);
      await fs.writeFile(
        configPath,
        `{ "share": "auto", "theme": "dark" }`,
        "utf8"
      );
      const result = await installSettings(destDir);
      expect(result.created).toBe(false);
      const parsed = parseJsonc(
        await fs.readFile(configPath, "utf8")
      ) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
      expect(parsed["theme"]).toBe("dark");
    });
  });
});

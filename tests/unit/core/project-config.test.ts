/**
 * Unit tests for the per-project `.lisa.config.json` reader/writer and
 * harness-resolution precedence chain.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HARNESS,
  HARNESS_VALUES,
  harnessIncludesAgent,
} from "../../../src/core/config.js";
import {
  PROJECT_CONFIG_FILENAME,
  isHarness,
  normalizeHarness,
  projectConfigExists,
  readProjectConfig,
  resolveHarness,
  shouldPersistProjectConfig,
  writeProjectConfig,
} from "../../../src/core/project-config.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("project-config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("readProjectConfig", () => {
    it("returns empty object when file is absent", async () => {
      const result = await readProjectConfig(tempDir);
      expect(result).toEqual({});
    });

    it("parses a valid config file", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "codex" }),
        "utf8"
      );
      const result = await readProjectConfig(tempDir);
      expect(result).toEqual({ harness: "codex" });
    });

    it("parses each canonical harness value", async () => {
      for (const harness of HARNESS_VALUES) {
        await fs.writeFile(
          path.join(tempDir, PROJECT_CONFIG_FILENAME),
          JSON.stringify({ harness }),
          "utf8"
        );
        const result = await readProjectConfig(tempDir);
        expect(result).toEqual({ harness });
      }
    });

    it("ignores unknown fields without erroring", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "claude", futureField: "x" }),
        "utf8"
      );
      const result = await readProjectConfig(tempDir);
      expect(result).toEqual({ harness: "claude" });
    });

    it("returns empty object when file has no harness key", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({}),
        "utf8"
      );
      const result = await readProjectConfig(tempDir);
      expect(result).toEqual({});
    });

    it("normalizes the 'all' alias to 'fleet'", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "all" }),
        "utf8"
      );
      const result = await readProjectConfig(tempDir);
      expect(result).toEqual({ harness: "fleet" });
    });

    it("throws on an invalid harness value", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "windsurf" }),
        "utf8"
      );
      await expect(readProjectConfig(tempDir)).rejects.toThrow(
        /Invalid harness/
      );
    });

    it("throws on non-string harness value", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: 42 }),
        "utf8"
      );
      await expect(readProjectConfig(tempDir)).rejects.toThrow(
        /Invalid harness/
      );
    });

    it("throws on malformed JSON", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        "{not json",
        "utf8"
      );
      await expect(readProjectConfig(tempDir)).rejects.toThrow();
    });

    it("throws when top-level value is not an object", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify("claude"),
        "utf8"
      );
      await expect(readProjectConfig(tempDir)).rejects.toThrow(
        /expected JSON object/
      );
    });
  });

  describe("writeProjectConfig", () => {
    it("creates the file when it does not exist", async () => {
      await writeProjectConfig(tempDir, { harness: "codex" });
      const written = await fs.readFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        "utf8"
      );
      expect(JSON.parse(written)).toEqual({ harness: "codex" });
    });

    it("ends file with a trailing newline", async () => {
      await writeProjectConfig(tempDir, { harness: "codex" });
      const written = await fs.readFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        "utf8"
      );
      expect(written.endsWith("\n")).toBe(true);
    });

    it("preserves unknown fields on round-trip", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "claude", futureField: { nested: 1 } }),
        "utf8"
      );
      await writeProjectConfig(tempDir, { harness: "codex" });
      const written = JSON.parse(
        await fs.readFile(path.join(tempDir, PROJECT_CONFIG_FILENAME), "utf8")
      );
      expect(written).toEqual({
        harness: "codex",
        futureField: { nested: 1 },
      });
    });

    it("merges into existing config without dropping other fields", async () => {
      await writeProjectConfig(tempDir, { harness: "claude" });
      await writeProjectConfig(tempDir, { harness: "fleet" });
      const written = JSON.parse(
        await fs.readFile(path.join(tempDir, PROJECT_CONFIG_FILENAME), "utf8")
      );
      expect(written).toEqual({ harness: "fleet" });
    });
  });

  describe("projectConfigExists", () => {
    it("returns false when the file is absent", async () => {
      expect(await projectConfigExists(tempDir)).toBe(false);
    });

    it("returns true when the file is present", async () => {
      await writeProjectConfig(tempDir, { harness: "claude" });
      expect(await projectConfigExists(tempDir)).toBe(true);
    });

    it("returns true even for a file with no recognized keys", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ deploy: { branches: { production: "main" } } }),
        "utf8"
      );
      expect(await projectConfigExists(tempDir)).toBe(true);
    });
  });

  describe("shouldPersistProjectConfig", () => {
    it("backfills when the config file is absent (no flag)", () => {
      expect(
        shouldPersistProjectConfig({
          fileExists: false,
          flagHarness: undefined,
          existingHarness: undefined,
          resolvedHarness: DEFAULT_HARNESS,
        })
      ).toBe(true);
    });

    it("does not rewrite an existing file on a routine apply (no flag)", () => {
      expect(
        shouldPersistProjectConfig({
          fileExists: true,
          flagHarness: undefined,
          existingHarness: "claude",
          resolvedHarness: "claude",
        })
      ).toBe(false);
    });

    it("does not rewrite an existing file when --harness matches the persisted value", () => {
      expect(
        shouldPersistProjectConfig({
          fileExists: true,
          flagHarness: "fleet",
          existingHarness: "fleet",
          resolvedHarness: "fleet",
        })
      ).toBe(false);
    });

    it("rewrites an existing file when --harness changes the value", () => {
      expect(
        shouldPersistProjectConfig({
          fileExists: true,
          flagHarness: "codex",
          existingHarness: "claude",
          resolvedHarness: "codex",
        })
      ).toBe(true);
    });

    it("backfills a missing file even when --harness is supplied", () => {
      expect(
        shouldPersistProjectConfig({
          fileExists: false,
          flagHarness: "codex",
          existingHarness: undefined,
          resolvedHarness: "codex",
        })
      ).toBe(true);
    });
  });

  describe("resolveHarness", () => {
    it("prefers CLI flag over config file", () => {
      expect(resolveHarness("codex", { harness: "claude" })).toBe("codex");
    });

    it("falls back to config file when no flag", () => {
      expect(resolveHarness(undefined, { harness: "codex" })).toBe("codex");
    });

    it("falls back to default when neither provided", () => {
      expect(resolveHarness(undefined, {})).toBe(DEFAULT_HARNESS);
      expect(resolveHarness(undefined, {})).toBe("claude");
    });

    it("respects flag value 'fleet'", () => {
      expect(resolveHarness("fleet", {})).toBe("fleet");
    });
  });

  describe("isHarness", () => {
    it.each(["claude", "codex", "fleet"] as const)(
      "accepts %s as a valid harness",
      value => {
        expect(isHarness(value)).toBe(true);
      }
    );

    it.each([
      ["windsurf"],
      ["Claude"],
      ["all"],
      ["both"],
      [""],
      [42],
      [null],
      [undefined],
      [["claude"]],
      [{ harness: "claude" }],
    ])("rejects %p", value => {
      expect(isHarness(value)).toBe(false);
    });
  });

  describe("normalizeHarness", () => {
    it("passes canonical values through, maps aliases, rejects the rest", () => {
      for (const value of HARNESS_VALUES) {
        expect(normalizeHarness(value)).toBe(value);
      }
      expect(normalizeHarness("all")).toBe("fleet");
      // The CLI normalizer stays strict on retired values; the config-read path
      // migrates "both" separately (see readProjectConfig / detectLegacyHarnessMigration).
      expect(normalizeHarness("both")).toBeUndefined();
      expect(normalizeHarness("windsurf")).toBeUndefined();
      expect(normalizeHarness("")).toBeUndefined();
    });
  });

  describe("harnessIncludesAgent", () => {
    it("fleet includes every emit agent (regression: Codex was once excluded)", () => {
      for (const agent of ["claude", "codex", "agy", "copilot"] as const) {
        expect(harnessIncludesAgent("fleet", agent)).toBe(true);
      }
    });

    it("a single-agent harness matches only itself", () => {
      expect(harnessIncludesAgent("codex", "codex")).toBe(true);
      expect(harnessIncludesAgent("codex", "claude")).toBe(false);
      expect(harnessIncludesAgent("agy", "agy")).toBe(true);
      expect(harnessIncludesAgent("copilot", "copilot")).toBe(true);
      expect(harnessIncludesAgent("claude", "copilot")).toBe(false);
    });
  });
});

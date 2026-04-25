/**
 * Unit tests for the per-project `.lisa.config.json` reader/writer and
 * harness-resolution precedence chain.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HARNESS } from "../../../src/core/config.js";
import {
  PROJECT_CONFIG_FILENAME,
  isHarness,
  readProjectConfig,
  resolveHarness,
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
      for (const harness of ["claude", "codex", "both"] as const) {
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

    it("throws on invalid harness value", async () => {
      await fs.writeFile(
        path.join(tempDir, PROJECT_CONFIG_FILENAME),
        JSON.stringify({ harness: "cursor" }),
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
      await writeProjectConfig(tempDir, { harness: "both" });
      const written = JSON.parse(
        await fs.readFile(path.join(tempDir, PROJECT_CONFIG_FILENAME), "utf8")
      );
      expect(written).toEqual({ harness: "both" });
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

    it("respects flag value 'both'", () => {
      expect(resolveHarness("both", {})).toBe("both");
    });
  });

  describe("isHarness", () => {
    it.each(["claude", "codex", "both"] as const)(
      "accepts %s as a valid harness",
      value => {
        expect(isHarness(value)).toBe(true);
      }
    );

    it.each([
      "cursor",
      "Claude",
      "",
      42,
      null,
      undefined,
      ["claude"],
      { harness: "claude" },
    ])("rejects %p", value => {
      expect(isHarness(value)).toBe(false);
    });
  });
});

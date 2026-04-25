/**
 * Unit tests for the Lisa-managed manifest reader/writer.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_MANAGED_MANIFEST_FILENAME,
  diffManifests,
  readManagedManifest,
  writeManagedManifest,
} from "../../../src/codex/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("codex/manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("readManagedManifest", () => {
    it("returns empty file list when manifest does not exist", async () => {
      const result = await readManagedManifest(tempDir);
      expect(result.files).toEqual([]);
    });

    it("parses a valid manifest", async () => {
      const codexDir = path.join(tempDir, ".codex");
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME),
        JSON.stringify({
          updatedAt: "2026-04-25T00:00:00.000Z",
          files: ["agents/lisa/bug-fixer.toml", "agents/lisa/builder.toml"],
        }),
        "utf8"
      );
      const result = await readManagedManifest(tempDir);
      expect(result.files).toEqual([
        "agents/lisa/bug-fixer.toml",
        "agents/lisa/builder.toml",
      ]);
      // Unknown fields like updatedAt from older manifest versions are
      // tolerated (silently dropped) on read for forward compatibility.
    });

    it("throws on invalid JSON", async () => {
      const codexDir = path.join(tempDir, ".codex");
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME),
        "not json",
        "utf8"
      );
      await expect(readManagedManifest(tempDir)).rejects.toThrow();
    });

    it("throws when files is not an array", async () => {
      const codexDir = path.join(tempDir, ".codex");
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME),
        JSON.stringify({ files: "nope" }),
        "utf8"
      );
      await expect(readManagedManifest(tempDir)).rejects.toThrow(
        /"files" array/
      );
    });

    it("throws when files contains non-strings", async () => {
      const codexDir = path.join(tempDir, ".codex");
      await fs.ensureDir(codexDir);
      await fs.writeFile(
        path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME),
        JSON.stringify({ files: ["good.toml", 42] }),
        "utf8"
      );
      await expect(readManagedManifest(tempDir)).rejects.toThrow(
        /must contain only strings/
      );
    });
  });

  describe("writeManagedManifest", () => {
    it("creates the .codex directory if missing", async () => {
      await writeManagedManifest(tempDir, ["a.toml"]);
      expect(
        await fs.pathExists(
          path.join(tempDir, ".codex", LISA_MANAGED_MANIFEST_FILENAME)
        )
      ).toBe(true);
    });

    it("writes files sorted alphabetically", async () => {
      await writeManagedManifest(tempDir, [
        "agents/lisa/zeta.toml",
        "agents/lisa/alpha.toml",
        "agents/lisa/mu.toml",
      ]);
      const result = await readManagedManifest(tempDir);
      expect(result.files).toEqual([
        "agents/lisa/alpha.toml",
        "agents/lisa/mu.toml",
        "agents/lisa/zeta.toml",
      ]);
    });

    it("write is idempotent (no timestamp churn)", async () => {
      // Important: the manifest is checked into git. A timestamp would
      // produce a spurious diff on every run. Only the file list matters.
      await writeManagedManifest(tempDir, ["a.toml"]);
      const first = await fs.readFile(
        path.join(tempDir, ".codex", LISA_MANAGED_MANIFEST_FILENAME),
        "utf8"
      );
      await writeManagedManifest(tempDir, ["a.toml"]);
      const second = await fs.readFile(
        path.join(tempDir, ".codex", LISA_MANAGED_MANIFEST_FILENAME),
        "utf8"
      );
      expect(second).toBe(first);
    });

    it("ends file with a trailing newline", async () => {
      await writeManagedManifest(tempDir, ["a.toml"]);
      const raw = await fs.readFile(
        path.join(tempDir, ".codex", LISA_MANAGED_MANIFEST_FILENAME),
        "utf8"
      );
      expect(raw.endsWith("\n")).toBe(true);
    });

    it("round-trips: write then read returns same files", async () => {
      const files = ["x.toml", "y.toml", "z.toml"];
      await writeManagedManifest(tempDir, files);
      const result = await readManagedManifest(tempDir);
      expect(result.files).toEqual(files);
    });
  });

  describe("diffManifests", () => {
    it("returns files in previous but not in current (stale)", () => {
      const previous = { files: ["a.toml", "b.toml", "c.toml"] };
      expect(diffManifests(previous, ["a.toml", "c.toml"])).toEqual(["b.toml"]);
    });

    it("returns empty when current is a superset of previous", () => {
      const previous = { files: ["a.toml"] };
      expect(diffManifests(previous, ["a.toml", "b.toml"])).toEqual([]);
    });

    it("returns all previous when current is empty", () => {
      const previous = { files: ["a.toml", "b.toml"] };
      expect(diffManifests(previous, [])).toEqual(["a.toml", "b.toml"]);
    });

    it("returns empty when previous is empty", () => {
      expect(diffManifests({ files: [] }, ["a.toml"])).toEqual([]);
    });
  });
});

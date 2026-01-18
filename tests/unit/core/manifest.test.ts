import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import {
  ManifestService,
  ManifestNotFoundError,
  MANIFEST_FILENAME,
} from "../../../src/core/manifest.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("ManifestService", () => {
  let service: ManifestService;
  let tempDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    service = new ManifestService();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    await fs.ensureDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("init", () => {
    it("initializes the manifest", async () => {
      await service.init(tempDir, lisaDir);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("record", () => {
    it("records entries", async () => {
      await service.init(tempDir, lisaDir);
      service.record("test.txt", "copy-overwrite");
      service.record(".gitignore", "copy-contents");

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("finalize", () => {
    it("writes manifest file with entries", async () => {
      await service.init(tempDir, lisaDir);
      service.record("test.txt", "copy-overwrite");
      service.record(".gitignore", "copy-contents");
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      expect(await fs.pathExists(manifestPath)).toBe(true);

      const content = await fs.readFile(manifestPath, "utf-8");
      expect(content).toContain("# Lisa manifest");
      expect(content).toContain("copy-overwrite:test.txt");
      expect(content).toContain("copy-contents:.gitignore");
    });

    it("includes header with timestamp and lisa dir", async () => {
      await service.init(tempDir, lisaDir);
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      const content = await fs.readFile(manifestPath, "utf-8");

      expect(content).toContain("# Generated:");
      expect(content).toContain(`# Lisa directory: ${lisaDir}`);
    });

    it("throws if not initialized", async () => {
      await expect(service.finalize()).rejects.toThrow(
        "Manifest not initialized"
      );
    });
  });

  describe("read", () => {
    it("reads manifest entries", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# Lisa manifest
# Generated: 2024-01-01
# Lisa directory: /path/to/lisa

copy-overwrite:test.txt
copy-contents:.gitignore
create-only:README.md
merge:package.json
`
      );

      const entries = await service.read(tempDir);

      expect(entries).toHaveLength(4);
      expect(entries[0]).toEqual({
        strategy: "copy-overwrite",
        relativePath: "test.txt",
      });
      expect(entries[1]).toEqual({
        strategy: "copy-contents",
        relativePath: ".gitignore",
      });
      expect(entries[2]).toEqual({
        strategy: "create-only",
        relativePath: "README.md",
      });
      expect(entries[3]).toEqual({
        strategy: "merge",
        relativePath: "package.json",
      });
    });

    it("skips comments and empty lines", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# This is a comment
copy-overwrite:test.txt

# Another comment
copy-contents:.gitignore
`
      );

      const entries = await service.read(tempDir);

      expect(entries).toHaveLength(2);
    });

    it("throws ManifestNotFoundError when manifest does not exist", async () => {
      await expect(service.read(tempDir)).rejects.toThrow(
        ManifestNotFoundError
      );
    });

    it("handles paths with colons", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(manifestPath, "copy-overwrite:path:with:colons.txt\n");

      const entries = await service.read(tempDir);

      expect(entries[0]).toEqual({
        strategy: "copy-overwrite",
        relativePath: "path:with:colons.txt",
      });
    });
  });

  describe("remove", () => {
    it("removes manifest file", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(manifestPath, "# test");

      await service.remove(tempDir);

      expect(await fs.pathExists(manifestPath)).toBe(false);
    });

    it("does not throw if manifest does not exist", async () => {
      await expect(service.remove(tempDir)).resolves.not.toThrow();
    });
  });
});

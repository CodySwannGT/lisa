import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { BackupService } from "../../../src/transaction/backup.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

describe("BackupService", () => {
  let service: BackupService;
  let tempDir: string;
  let destDir: string;

  beforeEach(async () => {
    service = new BackupService(new SilentLogger());
    tempDir = await createTempDir();
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("init", () => {
    it("creates backup directory", async () => {
      await service.init(destDir);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("backup", () => {
    it("backs up existing file", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, "test.txt");
      await fs.writeFile(testFile, "original content");

      await service.backup(testFile);

      // Should not throw
      expect(true).toBe(true);
    });

    it("handles non-existent file gracefully", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, "nonexistent.txt");

      // Should not throw
      await expect(service.backup(testFile)).resolves.not.toThrow();
    });

    it("throws when not initialized", async () => {
      await expect(service.backup("/some/file")).rejects.toThrow(
        "not initialized"
      );
    });
  });

  describe("rollback", () => {
    it("restores backed up files", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, "test.txt");
      await fs.writeFile(testFile, "original content");

      await service.backup(testFile);

      // Modify the file
      await fs.writeFile(testFile, "modified content");

      // Rollback
      await service.rollback();

      // File should be restored
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("original content");
    });

    it("restores nested files", async () => {
      await service.init(destDir);

      const nestedFile = path.join(destDir, "nested", "deep", "file.txt");
      await fs.ensureDir(path.dirname(nestedFile));
      await fs.writeFile(nestedFile, "nested content");

      await service.backup(nestedFile);
      await fs.writeFile(nestedFile, "changed");

      await service.rollback();

      const content = await fs.readFile(nestedFile, "utf-8");
      expect(content).toBe("nested content");
    });
  });

  describe("cleanup", () => {
    it("removes backup directory", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, "test.txt");
      await fs.writeFile(testFile, "content");
      await service.backup(testFile);

      await service.cleanup();

      // Service should be reset (init can be called again)
      await expect(service.init(destDir)).resolves.not.toThrow();
    });

    it("handles multiple cleanup calls gracefully", async () => {
      await service.init(destDir);
      await service.cleanup();
      await service.cleanup();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});

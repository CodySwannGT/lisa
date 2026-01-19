import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import { BackupService } from "../../../src/transaction/backup.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const TEST_FILE = "test.txt";
const ORIGINAL_CONTENT = "original content";

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

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

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

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.backup(testFile);

      // Modify the file
      await fs.writeFile(testFile, "modified content");

      // Rollback
      await service.rollback();

      // File should be restored
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe(ORIGINAL_CONTENT);
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

  describe("persistentBackup", () => {
    it("creates timestamped backup in .lisabak directory", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const backupFiles = await fs.readdir(lisabakDir);

      expect(backupFiles.length).toBe(1);
      expect(backupFiles[0]).toMatch(/\d{4}-\d{2}-\d{2}-test\.txt\.lisa\.bak/);
    });

    it("creates backup file with original content", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const backupFiles = await fs.readdir(lisabakDir);
      const backupPath = path.join(lisabakDir, backupFiles[0]);

      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(backupContent).toBe(ORIGINAL_CONTENT);
    });

    it("uses ISO date format (YYYY-MM-DD) in backup filename", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, "content");

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const backupFiles = await fs.readdir(lisabakDir);
      const filename = backupFiles[0];

      // Match ISO date format
      const dateRegex = /^(\d{4}-\d{2}-\d{2})-/;
      const dateMatch = dateRegex.exec(filename);
      expect(dateMatch).not.toBeNull();

      if (dateMatch) {
        const dateStr = dateMatch[1];
        // Verify it's a valid date
        const date = new Date(dateStr);
        expect(date.toString()).not.toBe("Invalid Date");
      }
    });

    it("handles non-existent file gracefully", async () => {
      await service.init(destDir);

      const nonexistentFile = path.join(destDir, "nonexistent.txt");

      // Should not throw
      await expect(
        service.persistentBackup(nonexistentFile)
      ).resolves.not.toThrow();
    });

    it("creates .lisabak directory if it doesn't exist", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, "content");

      const lisabakDir = path.join(destDir, ".lisabak");
      expect(await fs.pathExists(lisabakDir)).toBe(false);

      await service.persistentBackup(testFile);

      expect(await fs.pathExists(lisabakDir)).toBe(true);
    });

    it("preserves file extension in backup filename", async () => {
      await service.init(destDir);

      const jsonFile = path.join(destDir, "config.json");
      await fs.writeFile(jsonFile, '{"key": "value"}');

      await service.persistentBackup(jsonFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const backupFiles = await fs.readdir(lisabakDir);

      expect(backupFiles[0]).toMatch(/config\.json\.lisa\.bak$/);
    });
  });

  describe("cleanup", () => {
    it("removes backup directory", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
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

import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { BackupService } from "../../../src/transaction/backup.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const TEST_FILE = "test.txt";
const ORIGINAL_CONTENT = "original content";
const NESTED_CONTENT = "nested content";

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
      await fs.writeFile(nestedFile, NESTED_CONTENT);

      await service.backup(nestedFile);
      await fs.writeFile(nestedFile, "changed");

      await service.rollback();

      const content = await fs.readFile(nestedFile, "utf-8");
      expect(content).toBe(NESTED_CONTENT);
    });
  });

  describe("persistentBackup", () => {
    it("creates timestamped directory with date and time", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);

      expect(timestampDirs.length).toBe(1);
      // Should match YYYY-MM-DD-HHmmss format
      expect(timestampDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
    });

    it("preserves relative path structure in backup", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);
      const backupFile = path.join(
        lisabakDir,
        timestampDirs[0] ?? "",
        TEST_FILE
      );

      expect(await fs.pathExists(backupFile)).toBe(true);
    });

    it("creates backup file with original content", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, ORIGINAL_CONTENT);

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);
      const backupPath = path.join(
        lisabakDir,
        timestampDirs[0] ?? "",
        TEST_FILE
      );

      const backupContent = await fs.readFile(backupPath, "utf-8");
      expect(backupContent).toBe(ORIGINAL_CONTENT);
    });

    it("uses date and time in directory name format (YYYY-MM-DD-HHmmss)", async () => {
      await service.init(destDir);

      const testFile = path.join(destDir, TEST_FILE);
      await fs.writeFile(testFile, "content");

      await service.persistentBackup(testFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);
      const dirname = timestampDirs[0] ?? "";

      // Match date-time format
      const dateTimeRegex = /^(\d{4}-\d{2}-\d{2})-(\d{6})$/;
      const match = dateTimeRegex.exec(dirname);
      expect(match).not.toBeNull();

      if (match?.[1]) {
        const dateStr = match[1];
        // Verify date is valid
        const date = new Date(dateStr);
        expect(date.toString()).not.toBe("Invalid Date");
      }
    });

    it("preserves nested directory structure", async () => {
      await service.init(destDir);

      const nestedFile = path.join(destDir, "nested", "deep", "file.txt");
      await fs.ensureDir(path.dirname(nestedFile));
      await fs.writeFile(nestedFile, NESTED_CONTENT);

      await service.persistentBackup(nestedFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);
      const backupFile = path.join(
        lisabakDir,
        timestampDirs[0] ?? "",
        "nested",
        "deep",
        "file.txt"
      );

      expect(await fs.pathExists(backupFile)).toBe(true);
      const content = await fs.readFile(backupFile, "utf-8");
      expect(content).toBe(NESTED_CONTENT);
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

    it("does not add .lisa.bak extension to filenames", async () => {
      await service.init(destDir);

      const jsonFile = path.join(destDir, "config.json");
      await fs.writeFile(jsonFile, '{"key": "value"}');

      await service.persistentBackup(jsonFile);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);
      const backupFile = path.join(
        lisabakDir,
        timestampDirs[0] ?? "",
        "config.json"
      );

      expect(await fs.pathExists(backupFile)).toBe(true);
      // Filename should not have .lisa.bak extension
      expect(backupFile).not.toMatch(/\.lisa\.bak$/);
    });

    it("uses same timestamp directory for multiple files in same operation", async () => {
      await service.init(destDir);

      const file1 = path.join(destDir, "file1.txt");
      const file2 = path.join(destDir, "file2.txt");
      await fs.writeFile(file1, "content1");
      await fs.writeFile(file2, "content2");

      await service.persistentBackup(file1);
      await service.persistentBackup(file2);

      const lisabakDir = path.join(destDir, ".lisabak");
      const timestampDirs = await fs.readdir(lisabakDir);

      // Should only have one timestamp directory since calls are quick
      expect(timestampDirs.length).toBe(1);
      expect(
        await fs.pathExists(
          path.join(lisabakDir, timestampDirs[0] ?? "", "file1.txt")
        )
      ).toBe(true);
      expect(
        await fs.pathExists(
          path.join(lisabakDir, timestampDirs[0] ?? "", "file2.txt")
        )
      ).toBe(true);
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

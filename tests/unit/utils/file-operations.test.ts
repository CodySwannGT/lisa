import { describe, it, expect } from "vitest";
import { generateBackupFilename } from "../../../src/utils/file-operations.js";

describe("file-operations utilities", () => {
  describe("generateBackupFilename", () => {
    it("generates filename with ISO date format", () => {
      const filename = generateBackupFilename("/path/to/config.json");

      // Should match YYYY-MM-DD pattern
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-config\.json\.lisa\.bak$/);
    });

    it("uses today's date", () => {
      const today = new Date().toISOString().split("T")[0];
      const filename = generateBackupFilename("/path/to/file.txt");

      expect(filename).toContain(today);
    });

    it("preserves filename and extension", () => {
      const filename = generateBackupFilename("/path/to/package.json");

      expect(filename).toContain("package.json");
      expect(filename).toMatch(/\.lisa\.bak$/);
    });

    it("handles simple filenames without path", () => {
      const filename = generateBackupFilename("config.yml");

      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-config\.yml\.lisa\.bak$/);
    });

    it("handles files with multiple dots in name", () => {
      const filename = generateBackupFilename(
        "/path/to/app.config.production.json"
      );

      expect(filename).toContain("app.config.production.json");
      expect(filename).toMatch(/\.lisa\.bak$/);
    });

    it("handles files with no extension", () => {
      const filename = generateBackupFilename("/path/to/Dockerfile");

      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-Dockerfile\.lisa\.bak$/);
    });

    it("handles absolute and relative paths", () => {
      const absFilename = generateBackupFilename("/absolute/path/file.txt");
      const relFilename = generateBackupFilename("relative/path/file.txt");

      // Both should extract just the filename
      expect(absFilename).toContain("file.txt");
      expect(relFilename).toContain("file.txt");
    });

    it("generates valid date that can be parsed", () => {
      const filename = generateBackupFilename("/path/to/file.txt");

      // Extract date portion
      const dateRegex = /^(\d{4}-\d{2}-\d{2})-/;
      const dateMatch = dateRegex.exec(filename);
      expect(dateMatch).not.toBeNull();

      if (dateMatch) {
        const dateStr = dateMatch[1];
        const date = new Date(dateStr);
        expect(date.toString()).not.toBe("Invalid Date");
      }
    });
  });
});

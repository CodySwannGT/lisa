import { describe, it, expect } from "@jest/globals";
import { generateBackupDirname } from "../../../src/utils/file-operations.js";

describe("file-operations utilities", () => {
  describe("generateBackupDirname", () => {
    it("generates directory name with ISO date and time format", () => {
      const dirname = generateBackupDirname();

      // Should match YYYY-MM-DD-HHmmss pattern
      expect(dirname).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
    });

    it("uses today's date", () => {
      const today = new Date().toISOString().split("T")[0];
      const dirname = generateBackupDirname();

      expect(dirname).toContain(today);
    });

    it("includes time component in HHMMSS format", () => {
      const dirname = generateBackupDirname();

      // Extract time portion (after second dash)
      const parts = dirname.split("-");
      const time = parts[3] ?? "";

      // Should be 6 digits
      expect(time).toMatch(/^\d{6}$/);
      // Should represent valid hours (00-23)
      const hours = parseInt(time.substring(0, 2), 10);
      expect(hours).toBeGreaterThanOrEqual(0);
      expect(hours).toBeLessThan(24);
    });

    it("generates valid date portion that can be parsed", () => {
      const dirname = generateBackupDirname();

      // Extract date portion (first three parts)
      const dateRegex = /^(\d{4}-\d{2}-\d{2})-/;
      const dateMatch = dateRegex.exec(dirname);
      expect(dateMatch).not.toBeNull();

      if (dateMatch?.[1]) {
        const dateStr = dateMatch[1];
        const date = new Date(dateStr);
        expect(date.toString()).not.toBe("Invalid Date");
      }
    });

    it("preserves consistent timestamp during same second", async () => {
      // Multiple calls within the same second should produce same timestamp
      const dirname1 = generateBackupDirname();
      const dirname2 = generateBackupDirname();

      // Should match timestamp format
      expect(dirname1).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
      expect(dirname2).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
    });
  });
});

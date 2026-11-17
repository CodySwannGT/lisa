import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupScratchRoots,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupScratchRoots();
});

describe("enforcement fallback scratch roots", () => {
  it("removes a root even when TMPDIR changed between creation and cleanup", () => {
    const root = scratchRoot();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "lisa-other-tmp-"));
    try {
      vi.stubEnv("TMPDIR", elsewhere);
      expect(tmpdir()).toBe(elsewhere);
      cleanupScratchRoots();
      expect(existsSync(root)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("keeps making roots under the original base after TMPDIR changes", () => {
    const first = scratchRoot();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "lisa-other-tmp-"));
    try {
      vi.stubEnv("TMPDIR", elsewhere);
      expect(path.dirname(scratchRoot())).toBe(path.dirname(first));
    } finally {
      vi.unstubAllEnvs();
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

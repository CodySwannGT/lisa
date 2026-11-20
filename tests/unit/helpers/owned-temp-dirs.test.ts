/**
 * The recorder fixtures use to remove their temp folders (CodySwannGT/lisa#5095).
 * @module tests/unit/helpers/owned-temp-dirs
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ownedTempDirs,
  useOwnedTempDirs,
} from "../../helpers/owned-temp-dirs.js";

/** The prefix every case here creates its folders with. */
const PREFIX = "lisa-owned-";

const fileScoped = useOwnedTempDirs();

/** A folder the file-scoped recorder made; its removal is the afterAll's job. */
const fileScopedDir = fileScoped("lisa-owned-file-");

describe("ownedTempDirs", () => {
  it("creates folders under the platform temp root with the given prefix", () => {
    const owned = ownedTempDirs();
    const dir = owned.make(PREFIX);
    try {
      expect(path.dirname(dir)).toBe(tmpdir());
      expect(path.basename(dir)).toMatch(/^lisa-owned-[A-Za-z0-9]{6}$/u);
      expect(existsSync(dir)).toBe(true);
    } finally {
      owned.removeAll();
    }
  });

  it("removes every folder it made, contents and all", () => {
    const owned = ownedTempDirs();
    const first = owned.make(PREFIX);
    const second = owned.make(PREFIX);
    mkdirSync(path.join(first, "nested", "deeper"), { recursive: true });
    writeFileSync(path.join(second, "file.txt"), "x");

    owned.removeAll();

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it("is safe to call twice and after a folder was already removed", () => {
    const owned = ownedTempDirs();
    owned.make(PREFIX);

    owned.removeAll();

    expect(() => owned.removeAll()).not.toThrow();
  });
});

describe("useOwnedTempDirs", () => {
  it("leaves its folders in place until the file finishes", () => {
    // The integration guard (tests/integration/fixture-temp-cleanup.test.ts)
    // proves the afterAll removes them; here they must still exist mid-file.
    expect(existsSync(fileScopedDir)).toBe(true);
  });
});

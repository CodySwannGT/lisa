/**
 * Unit tests for the OpenCode Lisa-managed manifest.
 *
 * Covers round-trip read/write, the empty-when-absent default, deterministic
 * sorting, and validation throwing on corrupt input.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_MANAGED_MANIFEST_FILENAME,
  OPENCODE_CONFIG_DIR,
  readManagedManifest,
  writeManagedManifest,
} from "../../../src/opencode/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("opencode/manifest", () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(destDir);
  });

  /**
   * Absolute path of the manifest file under the test destination.
   * @returns Path to `.opencode/.lisa-managed.json`.
   */
  function manifestPath(): string {
    return path.join(
      destDir,
      OPENCODE_CONFIG_DIR,
      LISA_MANAGED_MANIFEST_FILENAME
    );
  }

  it("returns an empty manifest when none exists", async () => {
    expect(await readManagedManifest(destDir)).toEqual({ files: [] });
  });

  it("writes and reads back a sorted file list", async () => {
    await writeManagedManifest(destDir, [
      "skills/lisa/zebra/SKILL.md",
      "skills/lisa/alpha/SKILL.md",
    ]);
    const manifest = await readManagedManifest(destDir);
    expect(manifest.files).toEqual([
      "skills/lisa/alpha/SKILL.md",
      "skills/lisa/zebra/SKILL.md",
    ]);
  });

  it("writes JSON with a trailing newline", async () => {
    await writeManagedManifest(destDir, ["skills/lisa/a/SKILL.md"]);
    expect(await fs.readFile(manifestPath(), "utf8")).toMatch(/}\n$/);
  });

  it("throws on a corrupt manifest (missing files array)", async () => {
    await fs.ensureDir(path.join(destDir, OPENCODE_CONFIG_DIR));
    await fs.writeFile(manifestPath(), JSON.stringify({ nope: 1 }), "utf8");
    await expect(readManagedManifest(destDir)).rejects.toThrow(
      /expected "files" array/
    );
  });

  it("rejects traversal and absolute path entries", async () => {
    await fs.ensureDir(path.join(destDir, OPENCODE_CONFIG_DIR));
    const cases = [
      "skills/lisa/../../etc/passwd",
      "/abs/skills/lisa/x/SKILL.md",
      "skills/./lisa/x/SKILL.md",
    ];
    for (const bad of cases) {
      await fs.writeFile(
        manifestPath(),
        JSON.stringify({ files: [bad] }),
        "utf8"
      );
      await expect(readManagedManifest(destDir)).rejects.toThrow(
        /normalized relative path/
      );
    }
  });

  it("rejects non-string file entries", async () => {
    await fs.ensureDir(path.join(destDir, OPENCODE_CONFIG_DIR));
    await fs.writeFile(manifestPath(), JSON.stringify({ files: [42] }), "utf8");
    await expect(readManagedManifest(destDir)).rejects.toThrow(
      /must be a string/
    );
  });
});

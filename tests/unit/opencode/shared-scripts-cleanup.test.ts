/**
 * Stale cleanup of OpenCode shared modules (CodySwannGT/lisa#4642).
 *
 * The manifest stores forward slashes; `path.relative` yields backslashes on
 * Windows. The keep-check must compare both in one form, or the second apply
 * deletes the shared modules it just copied.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readManagedManifest,
  writeManagedManifest,
} from "../../../src/opencode/manifest.js";
import {
  selectStaleSharedEntries,
  toManifestPath,
} from "../../../src/opencode/shared-scripts-cleanup.js";
import { installSkills } from "../../../src/opencode/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** OpenCode config dir all artifacts land under. */
const OPENCODE_DIR = ".opencode";
/** Manifest form of the synthetic shared module. */
const SHARED_ENTRY = "skills/scripts/shared.mjs";
/** Manifest form of a shared module no longer emitted. */
const RETIRED_ENTRY = "skills/scripts/retired.mjs";

describe("opencode/shared-scripts-cleanup selection", () => {
  it("keeps a module emitted with Windows separators when the manifest holds slashes", () => {
    const emittedOnWindows = path.win32.join("skills", "scripts", "shared.mjs");
    expect(emittedOnWindows).toBe("skills\\scripts\\shared.mjs");
    expect(
      selectStaleSharedEntries([SHARED_ENTRY], [emittedOnWindows])
    ).toEqual([]);
    expect(toManifestPath(emittedOnWindows)).toBe(SHARED_ENTRY);
  });

  it("never selects skill-folder entries or other installers' entries", () => {
    expect(
      selectStaleSharedEntries(
        [
          "skills/lisa/demo-skill/SKILL.md",
          "skills\\lisa\\demo-skill\\scripts\\main.mjs",
          "agents/lisa-builder.md",
          "plugin/lisa-guard.ts",
          "skills/host/host-skill/SKILL.md",
          RETIRED_ENTRY,
        ],
        []
      )
    ).toEqual([RETIRED_ENTRY]);
  });
});

describe("opencode/shared-scripts-cleanup on disk", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Seed one skill whose script imports the plugin's `scripts/shared.mjs`.
   * @param imports - Whether the skill script imports the shared module.
   */
  async function seed(imports: boolean): Promise<void> {
    const pluginDir = path.join(lisaDir, "plugins", "lisa");
    const skillDir = path.join(pluginDir, "skills", "demo-skill");
    await fs.outputFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo\n---\n"
    );
    await fs.outputFile(
      path.join(skillDir, "scripts", "main.mjs"),
      imports ? 'import "../../../scripts/shared.mjs";\n' : "export {};\n"
    );
    await fs.outputFile(path.join(pluginDir, "scripts", "shared.mjs"), "");
  }

  /**
   * Absolute path of a manifest entry in the scratch project.
   * @param entry - Manifest-form path relative to `.opencode/`.
   * @returns Absolute path.
   */
  function abs(entry: string): string {
    return path.join(destDir, OPENCODE_DIR, ...entry.split("/"));
  }

  it("keeps shared modules across a manifest round trip", async () => {
    await seed(true);
    const first = await installSkills(lisaDir, destDir, []);
    await writeManagedManifest(destDir, first.managedFiles);
    const previous = await readManagedManifest(destDir);

    const second = await installSkills(lisaDir, destDir, previous.files);

    expect(first.managedFiles).toContain(SHARED_ENTRY);
    expect(second.managedFiles).toContain(SHARED_ENTRY);
    expect(await fs.pathExists(abs(SHARED_ENTRY))).toBe(true);
  });

  it("leaves an unmanaged sibling alone while deleting a stale managed module", async () => {
    await seed(true);
    const host = "skills/scripts/host-owned.mjs";
    const stale = RETIRED_ENTRY;
    await fs.outputFile(abs(host), "");
    await fs.outputFile(abs(stale), "");

    const result = await installSkills(lisaDir, destDir, [stale]);

    expect(await fs.pathExists(abs(host))).toBe(true);
    expect(await fs.pathExists(abs(stale))).toBe(false);
    expect(result.deleted).toEqual([RETIRED_ENTRY]);
  });

  it("does not touch previous skill-folder entries through the shared cleanup", async () => {
    await seed(false);
    const skillFile = "skills/lisa/demo-skill/SKILL.md";

    await installSkills(lisaDir, destDir, [skillFile, SHARED_ENTRY]);

    expect(await fs.pathExists(abs(skillFile))).toBe(true);
  });

  it("removes the shared directory once its last module is retired", async () => {
    await seed(true);
    const first = await installSkills(lisaDir, destDir, []);
    await seed(false);

    const second = await installSkills(lisaDir, destDir, first.managedFiles);

    expect(second.managedFiles).not.toContain(SHARED_ENTRY);
    expect(await fs.pathExists(abs("skills/scripts"))).toBe(false);
    expect(await fs.pathExists(abs("skills/lisa"))).toBe(true);
  });
});

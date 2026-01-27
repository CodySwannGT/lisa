import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import {
  ManifestService,
  ManifestNotFoundError,
  MANIFEST_FILENAME,
} from "../../../src/core/manifest.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const COPY_OVERWRITE = "copy-overwrite";
const COPY_CONTENTS = "copy-contents";
const CREATE_ONLY = "create-only";
const MERGE = "merge";
const TEST_TXT = "test.txt";
const GITIGNORE = ".gitignore";
const README_MD = "README.md";
const PACKAGE_JSON = "package.json";

describe("ManifestService", () => {
  let service: ManifestService;
  let tempDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    service = new ManifestService();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    await fs.ensureDir(lisaDir);
    // Create package.json in lisaDir so getVersion() can read it
    await fs.writeFile(
      path.join(lisaDir, "package.json"),
      JSON.stringify({ version: "1.3.0" })
    );
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
      service.record(TEST_TXT, COPY_OVERWRITE);
      service.record(GITIGNORE, COPY_CONTENTS);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("finalize", () => {
    it("writes manifest file with entries", async () => {
      await service.init(tempDir, lisaDir);
      service.record(TEST_TXT, COPY_OVERWRITE);
      service.record(GITIGNORE, COPY_CONTENTS);
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      expect(await fs.pathExists(manifestPath)).toBe(true);

      const content = await fs.readFile(manifestPath, "utf-8");
      expect(content).toContain("# Lisa manifest");
      expect(content).toContain(`${COPY_OVERWRITE}:${TEST_TXT}`);
      expect(content).toContain(`${COPY_CONTENTS}:${GITIGNORE}`);
    });

    it("includes header with timestamp and lisa dir", async () => {
      await service.init(tempDir, lisaDir);
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      const content = await fs.readFile(manifestPath, "utf-8");

      expect(content).toContain("# Generated:");
      expect(content).toContain(`# Lisa directory: ${lisaDir}`);
    });

    it("includes lisa version in header", async () => {
      await service.init(tempDir, lisaDir);
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      const content = await fs.readFile(manifestPath, "utf-8");

      expect(content).toContain("# Lisa version: 1.3.0");
    });

    it("includes unknown version if package.json is missing", async () => {
      const lisaDirWithoutPackage = path.join(tempDir, "lisa-no-pkg");
      await fs.ensureDir(lisaDirWithoutPackage);
      await service.init(tempDir, lisaDirWithoutPackage);
      await service.finalize();

      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      const content = await fs.readFile(manifestPath, "utf-8");

      expect(content).toContain("# Lisa version: unknown");
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

${COPY_OVERWRITE}:${TEST_TXT}
${COPY_CONTENTS}:${GITIGNORE}
${CREATE_ONLY}:${README_MD}
${MERGE}:${PACKAGE_JSON}
`
      );

      const entries = await service.read(tempDir);

      expect(entries).toHaveLength(4);
      expect(entries[0]).toEqual({
        strategy: COPY_OVERWRITE,
        relativePath: TEST_TXT,
      });
      expect(entries[1]).toEqual({
        strategy: COPY_CONTENTS,
        relativePath: GITIGNORE,
      });
      expect(entries[2]).toEqual({
        strategy: CREATE_ONLY,
        relativePath: README_MD,
      });
      expect(entries[3]).toEqual({
        strategy: MERGE,
        relativePath: PACKAGE_JSON,
      });
    });

    it("skips comments and empty lines", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# This is a comment
${COPY_OVERWRITE}:${TEST_TXT}

# Another comment
${COPY_CONTENTS}:${GITIGNORE}
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
      await fs.writeFile(
        manifestPath,
        `${COPY_OVERWRITE}:path:with:colons.txt\n`
      );

      const entries = await service.read(tempDir);

      expect(entries[0]).toEqual({
        strategy: COPY_OVERWRITE,
        relativePath: "path:with:colons.txt",
      });
    });
  });

  describe("readVersion", () => {
    it("reads version from manifest header", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# Lisa manifest - DO NOT EDIT
# Generated: 2024-01-01
# Lisa version: 1.5.0
# Lisa directory: /path/to/lisa

${COPY_OVERWRITE}:${TEST_TXT}
`
      );

      const version = await service.readVersion(tempDir);

      expect(version).toBe("1.5.0");
    });

    it("returns null when manifest does not exist", async () => {
      const version = await service.readVersion(tempDir);

      expect(version).toBeNull();
    });

    it("returns null when version header is missing", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# Lisa manifest - DO NOT EDIT
# Generated: 2024-01-01
# Lisa directory: /path/to/lisa

${COPY_OVERWRITE}:${TEST_TXT}
`
      );

      const version = await service.readVersion(tempDir);

      expect(version).toBeNull();
    });

    it("handles version with trailing whitespace", async () => {
      const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
      await fs.writeFile(
        manifestPath,
        `# Lisa manifest - DO NOT EDIT
# Lisa version: 1.6.0
# Lisa directory: /path/to/lisa

${COPY_OVERWRITE}:${TEST_TXT}
`
      );

      const version = await service.readVersion(tempDir);

      expect(version).toBe("1.6.0");
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

/**
 * Unit tests for Lisa source-repo self-apply detection.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_PACKAGE_NAME,
  isLisaSourceRepo,
} from "../../../src/core/self-apply.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";

describe("isLisaSourceRepo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("returns true when package.json name is the Lisa package", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      name: LISA_PACKAGE_NAME,
    });
    expect(await isLisaSourceRepo(tempDir)).toBe(true);
  });

  it("returns false for a host project with a different name", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      name: "some-host-project",
    });
    expect(await isLisaSourceRepo(tempDir)).toBe(false);
  });

  it("returns false when package.json is absent", async () => {
    expect(await isLisaSourceRepo(tempDir)).toBe(false);
  });

  it("returns false when package.json has no name field", async () => {
    await fs.writeJson(path.join(tempDir, PACKAGE_JSON), {
      version: "1.0.0",
    });
    expect(await isLisaSourceRepo(tempDir)).toBe(false);
  });
});

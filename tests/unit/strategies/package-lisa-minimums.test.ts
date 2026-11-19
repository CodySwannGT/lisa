/**
 * Lisa's library minimums reach only a host's own direct ranges
 * (CodySwannGT/lisa#4932). These load the REAL Expo template, so a minimum that
 * drifts back into `overrides` or `resolutions` fails here.
 * @module tests/unit/strategies/package-lisa-minimums
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import {
  cleanupTempDir,
  createExpoProject,
  createTempDir,
} from "../../helpers/test-utils.js";
import {
  APPLYING_VERSION,
  buildStrategyContext,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON,
} from "./package-lisa-fixtures.js";

const REPO_ROOT = process.cwd();
const EXPO_SOURCE = path.join(
  REPO_ROOT,
  "expo",
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON
);

describe("Expo library minimums", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    await createExpoProject(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Apply the real Expo template over a host manifest.
   * @param manifest - The host's package.json
   * @returns The package.json the apply wrote
   */
  async function applyExpo(
    manifest: Record<string, unknown>
  ): Promise<Record<string, Record<string, string> | undefined>> {
    const destPath = path.join(projectDir, PACKAGE_JSON);
    await fs.writeJson(destPath, manifest);
    await new PackageLisaStrategy(() => APPLYING_VERSION).apply(
      EXPO_SOURCE,
      destPath,
      PACKAGE_JSON,
      buildStrategyContext(REPO_ROOT, projectDir, { lisaDir: REPO_ROOT })
    );
    return fs.readJson(destPath);
  }

  it("adds no library, and no floor for one, to a host that does not list it", async () => {
    const written = await applyExpo({ scripts: {} });
    expect(written.dependencies?.["date-fns"]).toBeUndefined();
    expect(written.overrides?.["date-fns"]).toBeUndefined();
    expect(written.resolutions?.["date-fns"]).toBeUndefined();
  });

  it("raises a host's direct range in the same major without touching transitive copies", async () => {
    const written = await applyExpo({
      dependencies: { "date-fns": "^3.0.0", "react-hook-form": "7.50.0" },
      scripts: {},
    });
    expect(written.dependencies?.["date-fns"]).toBe("^3.6.0");
    expect(written.dependencies?.["react-hook-form"]).toBe("7.70.0");
    expect(written.overrides?.["date-fns"]).toBeUndefined();
    expect(written.resolutions?.["react-hook-form"]).toBeUndefined();
  });
});

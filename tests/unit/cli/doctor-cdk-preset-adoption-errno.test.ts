/**
 * Which filesystem failures the CDK preset-adoption doctor check calls an
 * absence.
 *
 * Only `ENOENT` and `ENOTDIR` may read as "this artifact is not there". Any
 * other errno means the check could not look and must FAIL: a repository
 * nested past the platform's path limit can carry the very preset this check
 * exists to catch, and `ENAMETOOLONG` used to pass it as a repository with no
 * preset artifacts (CodySwannGT/lisa#4629).
 *
 * The repository on disk really carries what each case refuses, so a case
 * that stopped going through the replaced call would produce a different line.
 * @module tests/unit/cli/doctor-cdk-preset-adoption-errno
 */
import * as fse from "fs-extra";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkCdkPresetAdoption } from "../../../src/cli/doctor-cdk-preset-adoption.js";
import { CDK_APP_MARKER } from "../../../src/core/cdk-preset-adoption.js";
import {
  ABSENT_CODES,
  type FsPromises,
  realFsPromises,
  refusingAt,
  UNDETERMINABLE_CODES,
} from "../../helpers/fs-errno.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<FsPromises>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    stat: vi.fn(actual.stat),
  };
});

/** The one preset artifact the repository carries. */
const PRESET_ARTIFACT = "eslint.cdk.ts";

/** The application entry the seeded marker names. */
const APP_ENTRY = "bin/infrastructure.ts";

describe("doctor CDK preset-adoption check — filesystem failures", () => {
  let tempDir: string;
  let artifact: string;
  let marker: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    artifact = path.join(tempDir, PRESET_ARTIFACT);
    marker = path.join(tempDir, CDK_APP_MARKER);
    await fse.outputFile(artifact, "// preset\n");
    await fse.outputJson(marker, { app: `npx tsx ${APP_ENTRY}` });
    await fse.outputFile(path.join(tempDir, APP_ENTRY), "// app\n");
  });

  afterEach(async () => {
    vi.mocked(stat).mockReset();
    vi.mocked(readFile).mockReset();
    await cleanupTempDir(tempDir);
  });

  describe("probing a preset artifact", () => {
    /**
     * Refuse the preset artifact's probe with one errno.
     * @param code - Errno code to reject with
     */
    async function refuseArtifact(code: string): Promise<void> {
      const actual = await realFsPromises();
      vi.mocked(stat).mockImplementation(
        refusingAt(actual.stat, artifact, code)
      );
    }

    /**
     * Every path the check passed to `stat`.
     * @returns The probed paths, in call order
     */
    function probedPaths(): readonly unknown[] {
      return vi.mocked(stat).mock.calls.map(([target]) => target);
    }

    it.each(UNDETERMINABLE_CODES)(
      "fails, naming %s, when the check cannot probe a preset artifact",
      async code => {
        await refuseArtifact(code);

        const check = await checkCdkPresetAdoption(tempDir);

        expect(probedPaths()).toContain(artifact);
        expect(check.status).toBe("fail");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      "reads %s as a repository with no preset artifacts",
      async code => {
        await refuseArtifact(code);

        const check = await checkCdkPresetAdoption(tempDir);

        expect(probedPaths()).toContain(artifact);
        expect(check.status).toBe("ok");
        expect(check.detail).toBe(
          "No CDK application preset artifacts in this repository"
        );
      }
    );
  });

  describe(`reading ${CDK_APP_MARKER}`, () => {
    /**
     * Refuse the marker's read with one errno.
     * @param code - Errno code to reject with
     */
    async function refuseMarker(code: string): Promise<void> {
      const actual = await realFsPromises();
      vi.mocked(readFile).mockImplementation(
        refusingAt(actual.readFile, marker, code)
      );
    }

    it.each(UNDETERMINABLE_CODES)(
      `fails, naming %s, when the check cannot read ${CDK_APP_MARKER}`,
      async code => {
        await refuseMarker(code);

        const check = await checkCdkPresetAdoption(tempDir);

        expect(vi.mocked(readFile).mock.calls.map(([p]) => p)).toContain(
          marker
        );
        expect(check.status).toBe("fail");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      `reads %s as a repository with no ${CDK_APP_MARKER}`,
      async code => {
        await refuseMarker(code);

        const check = await checkCdkPresetAdoption(tempDir);

        expect(vi.mocked(readFile).mock.calls.map(([p]) => p)).toContain(
          marker
        );
        expect(check.status).toBe("fail");
        expect(check.detail).toContain("never eligible");
        expect(check.detail).toContain(`there is no ${CDK_APP_MARKER}`);
      }
    );
  });
});

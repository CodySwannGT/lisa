/**
 * Doctor coverage for repositories mis-detected as CDK apps.
 *
 * The detection fix reaches the next decision only. A repository admitted by
 * the old `aws-cdk*`-dependency arm keeps the preset's artifacts, its
 * force-merged runtime dependencies, and a dead-code gate whose entry globs
 * cover a fraction of its source and pass. These tests pin the check that lets
 * such a repository find ITSELF, and pin just as hard that a tree the check
 * was refused never renders as a repository with nothing to report
 * (CodySwannGT/lisa#3711).
 * @module tests/unit/cli/doctor-cdk-preset-adoption
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CDK_PRESET_ADOPTION_CHECK_NAME,
  checkCdkPresetAdoption,
} from "../../../src/cli/doctor-cdk-preset-adoption.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import {
  CDK_APP_MARKER,
  CDK_PRESET_ARTIFACTS,
} from "../../../src/core/cdk-preset-adoption.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** How the check spells "I could not answer that". */
const UNDETERMINABLE = "Could not determine";

/** The `app` command the CDK template seeds. */
const SEEDED_APP = "npx tsx bin/infrastructure.ts";

/**
 * Plant the CDK-exclusive copy-overwrite artifacts the preset delivers.
 * @param projectRoot - Absolute project root
 * @returns Nothing
 */
async function seedPresetArtifacts(projectRoot: string): Promise<void> {
  for (const artifact of CDK_PRESET_ARTIFACTS) {
    await fse.outputFile(path.join(projectRoot, artifact), "// preset\n");
  }
}

/**
 * Plant the package.json entries the CDK preset force-merges.
 * @param projectRoot - Absolute project root
 * @returns Nothing
 */
async function seedMergedManifest(projectRoot: string): Promise<void> {
  await fse.writeJson(path.join(projectRoot, "package.json"), {
    name: "a-repository",
    bin: { infrastructure: "bin/infrastructure.js" },
    dependencies: {
      "aws-cdk-github-oidc": "^2.4.1",
      constructs: "^10.4.5",
    },
  });
}

describe("doctor CDK preset-adoption check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reports a repository carrying the preset with no marker", async () => {
    await seedPresetArtifacts(tempDir);
    await seedMergedManifest(tempDir);

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("tsconfig.cdk.json");
    expect(check.detail).toContain("aws-cdk-github-oidc");
    expect(check.detail).toContain("bin/infrastructure.js");
    expect(check.detail).toContain("knip");
  });

  it("reports a repository holding a marker Lisa seeded for it", async () => {
    // The population the naive signature misses. `cdk.json` ships with the
    // preset under create-only, so a mis-detected repository that received an
    // apply HAS one — and would read as a genuine CDK app to a check that
    // stopped at the marker.
    await seedPresetArtifacts(tempDir);
    await seedMergedManifest(tempDir);
    await fse.writeJson(path.join(tempDir, CDK_APP_MARKER), {
      app: SEEDED_APP,
    });

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("bin/infrastructure.ts");
    expect(check.detail).toContain("seeded");
  });

  it("stays quiet for a real CDK app", async () => {
    await seedPresetArtifacts(tempDir);
    await seedMergedManifest(tempDir);
    await fse.writeJson(path.join(tempDir, CDK_APP_MARKER), {
      app: SEEDED_APP,
    });
    await fse.outputFile(
      path.join(tempDir, "bin", "infrastructure.ts"),
      "// app\n"
    );

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("ok");
  });

  it("stays quiet for a repository that never received the preset", async () => {
    await seedMergedManifest(tempDir);

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("aws-cdk-github-oidc");
  });

  it("says so rather than guessing when the marker names no entry it can find", async () => {
    await seedPresetArtifacts(tempDir);
    await fse.writeJson(path.join(tempDir, CDK_APP_MARKER), {
      app: "dotnet run --project Infra",
    });

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("could not be settled");
  });

  it("fails rather than passing when an artifact cannot be probed", async () => {
    // The failure mode this check exists to end, aimed at the check itself: a
    // tree it was refused must not read as a tree with no preset in it.
    const nested = path.join(tempDir, "nested");
    await fse.ensureDir(nested);
    await seedPresetArtifacts(nested);
    await fse.chmod(nested, 0o000);
    try {
      const check = await checkCdkPresetAdoption(nested);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain(UNDETERMINABLE);
      expect(check.detail).toContain("EACCES");
    } finally {
      await fse.chmod(nested, 0o700);
    }
  });

  it("fails rather than passing when the marker will not parse", async () => {
    await seedPresetArtifacts(tempDir);
    await fse.outputFile(path.join(tempDir, CDK_APP_MARKER), "{ not json");

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("keeps the verdict when only the manifest will not read", async () => {
    // A manifest it cannot list does not unsettle a verdict already reached
    // from the artifacts and the marker.
    await seedPresetArtifacts(tempDir);
    await fse.outputFile(path.join(tempDir, "package.json"), "{ not json");

    const check = await checkCdkPresetAdoption(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("never eligible for");
    expect(check.detail).not.toContain(UNDETERMINABLE);
  });

  it("fails rather than passing when the project path is absent", async () => {
    const check = await checkCdkPresetAdoption(
      path.join(tempDir, "no-such-project")
    );

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("runs as part of lisa doctor", async () => {
    await seedPresetArtifacts(tempDir);
    await seedMergedManifest(tempDir);
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });

    const result = await runDoctor(
      tempDir,
      { offline: true },
      {
        write: vi.fn(),
        setExitCode: vi.fn(),
        runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
      }
    );

    const check = result.checks.find(
      candidate => candidate.name === CDK_PRESET_ADOPTION_CHECK_NAME
    );

    expect(check?.status).toBe("fail");
  });
});

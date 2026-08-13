/**
 * The fleet's way to notice it is running an old enforcement guard.
 *
 * Apply delivers Lisa-owned artifacts on a version bump, so this check is
 * normally quiet — but a project that pinned an old Lisa, or that never
 * re-applied after upgrading, still runs whatever it has, and before this check
 * nothing anywhere said so.
 * @module tests/unit/cli/doctor-lisa-owned-artifacts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkLisaOwnedArtifacts } from "../../../src/cli/doctor-lisa-owned-artifacts.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const HOST_CONFIG = "tsconfig.json";
const SHIPPED_GUARD = "#!/usr/bin/env bash\n# closed\n";
const OLD_GUARD = "#!/usr/bin/env bash\n# fails open\n";

describe("checkLisaOwnedArtifacts", () => {
  let tempDir: string;
  let lisaRoot: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaRoot = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.outputFile(
      path.join(lisaRoot, "all", "copy-overwrite", GUARD),
      SHIPPED_GUARD
    );
    await fs.outputFile(
      path.join(lisaRoot, "all", "copy-overwrite", HOST_CONFIG),
      '{"strict":true}'
    );
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("warns and names the guard when the project has an older copy", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(GUARD);
  });

  it("passes when the guard matches what Lisa ships", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe("ok");
  });

  it("passes when the project never installed the guard", async () => {
    // A missing artifact means the stack does not apply here, not drift.
    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe("ok");
  });

  it("ignores drift in host-owned managed config", async () => {
    // Customised build config is exactly what a project is allowed to do; this
    // check is only about the files Lisa owns.
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);
    await fs.outputFile(path.join(projectDir, HOST_CONFIG), "{}");

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe("ok");
  });

  it("respects .lisaignore", async () => {
    // A project that deliberately holds its own copy said so already.
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);
    await fs.outputFile(
      path.join(projectDir, ".lisaignore"),
      "scripts/lisa-hooks/\n"
    );

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe("ok");
  });
});

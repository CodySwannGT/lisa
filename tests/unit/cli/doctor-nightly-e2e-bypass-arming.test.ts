/**
 * The doctor must surface a nightly bypass caller that no longer re-evaluates
 * when the pull-request body changes (#3476, #3485).
 *
 * The migration repairs the installed base once, on upgrade. It cannot see a
 * consumer who afterwards hand-edits `edited` back out of the trigger list, or
 * reverts a file they own. That repo is then back in the original state with no
 * signal anywhere — the gate still runs and still reports, and is merely
 * half-armed, so a waiver's body evidence can be deleted under a green check.
 * This check is the only thing that says so.
 *
 * The negative cases matter as much as the positive one. A check that fires on
 * workflows this defect does not concern is a check somebody switches off, and
 * then it finds nothing at all.
 * @module tests/unit/cli/doctor-nightly-e2e-bypass-arming
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkNightlyE2eBypassArming } from "../../../src/cli/doctor-nightly-e2e-bypass-arming.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The nightly health caller's file name, and the name doctor reports. */
const HEALTH_CALLER_FILE = "nightly-e2e-health.yml";
/** The `on.pull_request` key line every trigger fixture opens with. */
const PULL_REQUEST_KEY = "  pull_request:";

/**
 * A caller of the nightly health reusable, with the given trigger block.
 * @param triggers - Lines forming the `on:` block body
 * @returns Workflow YAML
 */
const caller = (triggers: readonly string[]): string =>
  [
    "name: Nightly E2E Health",
    "",
    "on:",
    ...triggers,
    "",
    "jobs:",
    "  gate:",
    `    uses: CodySwannGT/lisa/.github/workflows/${HEALTH_CALLER_FILE}@v4.33.0`,
    "",
  ].join("\n");

describe("doctor: nightly E2E bypass arming", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write one workflow into the temporary project.
   * @param name - Workflow file name
   * @param source - Workflow YAML
   */
  async function write(name: string, source: string): Promise<void> {
    await fs.writeFile(
      path.join(projectDir, ".github", "workflows", name),
      source
    );
  }

  it("fails a caller whose types omit edited", async () => {
    await write(
      HEALTH_CALLER_FILE,
      caller([
        PULL_REQUEST_KEY,
        "    types: [opened, synchronize, reopened, labeled, unlabeled]",
      ])
    );

    const result = await checkNightlyE2eBypassArming(projectDir);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain(HEALTH_CALLER_FILE);
    expect(result.detail).toContain("green and merge-eligible");
  });

  it("names the repair, not just the problem", async () => {
    await write(
      HEALTH_CALLER_FILE,
      caller([PULL_REQUEST_KEY, "    types: [opened, synchronize]"])
    );

    const result = await checkNightlyE2eBypassArming(projectDir);

    expect(result.detail).toContain("`edited`");
    expect(result.detail).toContain("on.pull_request.types");
  });

  it("fails a caller that declares no types, and says why that is not neutral", async () => {
    // GitHub's implicit default is [opened, synchronize, reopened], which does
    // not include `edited` — so declaring nothing is exactly as exposed as
    // declaring a list that leaves it out.
    await write(
      HEALTH_CALLER_FILE,
      caller([PULL_REQUEST_KEY, "    branches: [dev]"])
    );

    const result = await checkNightlyE2eBypassArming(projectDir);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("implicit default");
  });

  it("passes a caller that re-evaluates on a body change", async () => {
    await write(
      HEALTH_CALLER_FILE,
      caller([
        PULL_REQUEST_KEY,
        "    types: [opened, synchronize, reopened, labeled, unlabeled, edited]",
      ])
    );

    expect((await checkNightlyE2eBypassArming(projectDir)).status).toBe("ok");
  });

  it("passes the shipped caller template as it now ships", async () => {
    // The strongest form of the check: what Lisa seeds must satisfy what Lisa
    // audits, or a fresh adoption is born failing its own doctor.
    await write(
      HEALTH_CALLER_FILE,
      await fs.readFile(
        path.join(
          process.cwd(),
          "expo",
          "create-only",
          ".github",
          "workflows",
          HEALTH_CALLER_FILE
        ),
        "utf8"
      )
    );

    expect((await checkNightlyE2eBypassArming(projectDir)).status).toBe("ok");
  });

  it("ignores workflows that do not call the health reusable", async () => {
    await write(
      "some-other.yml",
      [
        "on:",
        PULL_REQUEST_KEY,
        "    types: [opened]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n")
    );

    expect((await checkNightlyE2eBypassArming(projectDir)).status).toBe("ok");
  });

  it("ignores a health caller that gates no merge", async () => {
    // No `pull_request` trigger at all means it is not a merge gate, so it is
    // not this defect. Reporting it would be noise, and a noisy check is one
    // somebody switches off.
    await write(
      HEALTH_CALLER_FILE,
      caller(["  workflow_dispatch:", "  schedule:", "    - cron: '0 3 * * *'"])
    );

    expect((await checkNightlyE2eBypassArming(projectDir)).status).toBe("ok");
  });

  it("reports an absent workflows directory as absent, not as clean", async () => {
    await fs.remove(path.join(projectDir, ".github"));

    const result = await checkNightlyE2eBypassArming(projectDir);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("No .github/workflows directory");
  });
});

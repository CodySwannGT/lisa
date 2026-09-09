/**
 * Doctor coverage for Rails projects seeded before the deploy-intent fix.
 *
 * The seed fix reaches new adoptions only — the deploy workflow is
 * `create-only`, so a project that received it earlier keeps the bare
 * `# - main` forever and has nothing that would ever raise the question. These
 * tests pin the check that lets such a project find ITSELF, and pin just as
 * hard that a workflow the check could not read never renders as a project
 * with nothing to report (CodySwannGT/lisa#3779).
 * @module tests/unit/cli/doctor-rails-deploy-intent
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkRailsDeployIntent,
  RAILS_DEPLOY_INTENT_CHECK_NAME,
} from "../../../src/cli/doctor-rails-deploy-intent.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";

/** How the check spells "I could not answer that". */
const UNDETERMINABLE = "Could not determine";

/** The trigger block a project seeded before the fix still carries. */
const BARE_WORKFLOW = `name: Release and Deploy

on:
  push:
    branches:
      - staging
      # - main
  workflow_dispatch:
`;

/**
 * Make a temp directory look like a Rails checkout carrying one workflow.
 * @param projectRoot - Absolute project root
 * @param workflowText - Deploy workflow source, or null to omit the file
 * @param marker - Rails marker to plant
 * @returns Nothing
 */
async function seedRailsProject(
  projectRoot: string,
  workflowText: string | null,
  marker: string = "bin/rails"
): Promise<void> {
  await fse.outputFile(path.join(projectRoot, marker), "#!/usr/bin/env ruby\n");
  if (workflowText !== null) {
    await fse.outputFile(path.join(projectRoot, DEPLOY_WORKFLOW), workflowText);
  }
}

describe("doctor rails deploy-intent check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reports the bare marker and names what enabling production needs", async () => {
    await seedRailsProject(tempDir, BARE_WORKFLOW);

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(DEPLOY_WORKFLOW);
    expect(check.detail).toContain("AWS_ACCOUNT_ID_MAIN");
    expect(check.detail).toContain("DeployServiceRole");
  });

  it("stays quiet when the workflow says why production is withheld", async () => {
    await seedRailsProject(
      tempDir,
      BARE_WORKFLOW.replace(
        "      # - main",
        `      # Opt-in: needs an AWS_ACCOUNT_ID_MAIN secret first.
      # - main`
      )
    );

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("ok");
  });

  it("stays quiet when the project deliberately deploys production", async () => {
    await seedRailsProject(
      tempDir,
      BARE_WORKFLOW.replace("# - main", "- main")
    );

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("ok");
  });

  it("reads config/application.rb as the Rails marker too", async () => {
    await seedRailsProject(tempDir, BARE_WORKFLOW, "config/application.rb");

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("warn");
  });

  it("stays quiet for a project that is not Rails", async () => {
    // The remedy this check names is Rails-specific — an AWS account secret
    // and an ECS role. Aiming it at a workflow from another stack that happens
    // to comment out a branch would send someone to configure infrastructure
    // their project does not have.
    await fse.outputFile(path.join(tempDir, DEPLOY_WORKFLOW), BARE_WORKFLOW);

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("AWS_ACCOUNT_ID_MAIN");
  });

  it("stays quiet for a Rails project with no deploy workflow", async () => {
    await seedRailsProject(tempDir, null);

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("ok");
  });

  it("fails rather than passing when the workflow cannot be read", async () => {
    // The failure mode this check exists to end, aimed at the check itself: a
    // file it was refused must not read as a file with nothing in it.
    await seedRailsProject(tempDir, BARE_WORKFLOW);
    const workflowPath = path.join(tempDir, DEPLOY_WORKFLOW);
    await fse.chmod(workflowPath, 0o000);
    try {
      const check = await checkRailsDeployIntent(tempDir);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain(UNDETERMINABLE);
      expect(check.detail).toContain("EACCES");
    } finally {
      await fse.chmod(workflowPath, 0o600);
    }
  });

  it("fails rather than passing when the Rails marker cannot be probed", async () => {
    await seedRailsProject(tempDir, BARE_WORKFLOW);
    const binDir = path.join(tempDir, "bin");
    await fse.chmod(binDir, 0o000);
    try {
      const check = await checkRailsDeployIntent(tempDir);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain(UNDETERMINABLE);
    } finally {
      await fse.chmod(binDir, 0o700);
    }
  });

  it("fails rather than passing when the workflow will not parse", async () => {
    await seedRailsProject(tempDir, "on:\n  push:\n  - [unbalanced\n");

    const check = await checkRailsDeployIntent(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("fails rather than passing when the project path is absent", async () => {
    const check = await checkRailsDeployIntent(
      path.join(tempDir, "no-such-project")
    );

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("runs as part of lisa doctor", async () => {
    await seedRailsProject(tempDir, BARE_WORKFLOW);
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
      candidate => candidate.name === RAILS_DEPLOY_INTENT_CHECK_NAME
    );
    expect(check?.status).toBe("warn");
  });
});

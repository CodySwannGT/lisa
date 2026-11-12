/**
 * Which filesystem failures the Rails deploy-intent doctor check calls an
 * absence.
 *
 * Only `ENOENT` and `ENOTDIR` may read as "not a Rails project" or "no deploy
 * workflow". Any other errno means the check could not look and must FAIL: a
 * project root nested past the platform's path limit can be a Rails checkout
 * carrying the very workflow this check exists to catch, and `ENAMETOOLONG`
 * used to pass it as "Not a Rails project" (CodySwannGT/lisa#4629).
 *
 * The project on disk really is a Rails checkout carrying the bare `# - main`
 * workflow, so a case that stopped going through the replaced call would warn
 * instead of producing the expected line.
 * @module tests/unit/cli/doctor-rails-deploy-intent-errno
 */
import * as fse from "fs-extra";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRailsDeployIntent } from "../../../src/cli/doctor-rails-deploy-intent.js";
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

const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";

/** The trigger block a project seeded before the fix still carries. */
const BARE_WORKFLOW = [
  "name: Release and Deploy",
  "",
  "on:",
  "  push:",
  "    branches:",
  "      - staging",
  "      # - main",
  "  workflow_dispatch:",
  "",
].join("\n");

describe("doctor Rails deploy-intent check — filesystem failures", () => {
  let tempDir: string;
  let binRails: string;
  let application: string;
  let workflow: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    binRails = path.join(tempDir, "bin/rails");
    application = path.join(tempDir, "config/application.rb");
    workflow = path.join(tempDir, DEPLOY_WORKFLOW);
    await fse.outputFile(binRails, "#!/usr/bin/env ruby\n");
    await fse.outputFile(application, "module App; end\n");
    await fse.outputFile(workflow, BARE_WORKFLOW);
  });

  afterEach(async () => {
    vi.mocked(stat).mockReset();
    vi.mocked(readFile).mockReset();
    await cleanupTempDir(tempDir);
  });

  /**
   * Every path the check passed to `stat`.
   * @returns The probed paths, in call order
   */
  function probedPaths(): readonly unknown[] {
    return vi.mocked(stat).mock.calls.map(([target]) => target);
  }

  describe("probing the Rails markers", () => {
    /**
     * Refuse both Rails markers with one errno.
     * @param code - Errno code to reject with
     */
    async function refuseMarkers(code: string): Promise<void> {
      const actual = await realFsPromises();
      vi.mocked(stat).mockImplementation(
        refusingAt(refusingAt(actual.stat, binRails, code), application, code)
      );
    }

    it.each(UNDETERMINABLE_CODES)(
      "fails, naming %s, when the check cannot probe a Rails marker",
      async code => {
        await refuseMarkers(code);

        const check = await checkRailsDeployIntent(tempDir);

        expect(probedPaths()).toContain(binRails);
        expect(check.status).toBe("fail");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      "reads %s on both markers as a project that is not Rails",
      async code => {
        await refuseMarkers(code);

        const check = await checkRailsDeployIntent(tempDir);

        expect(probedPaths()).toEqual(
          expect.arrayContaining([binRails, application])
        );
        expect(check.status).toBe("ok");
        expect(check.detail).toBe("Not a Rails project");
      }
    );
  });

  describe("reading the deploy workflow", () => {
    /**
     * Refuse the deploy workflow's read with one errno.
     * @param code - Errno code to reject with
     */
    async function refuseWorkflow(code: string): Promise<void> {
      const actual = await realFsPromises();
      vi.mocked(readFile).mockImplementation(
        refusingAt(actual.readFile, workflow, code)
      );
    }

    it.each(UNDETERMINABLE_CODES)(
      "fails, naming %s, when the check cannot read the workflow",
      async code => {
        await refuseWorkflow(code);

        const check = await checkRailsDeployIntent(tempDir);

        expect(vi.mocked(readFile).mock.calls.map(([p]) => p)).toContain(
          workflow
        );
        expect(check.status).toBe("fail");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      "reads %s as a project with no deploy workflow",
      async code => {
        await refuseWorkflow(code);

        const check = await checkRailsDeployIntent(tempDir);

        expect(vi.mocked(readFile).mock.calls.map(([p]) => p)).toContain(
          workflow
        );
        expect(check.status).toBe("ok");
        expect(check.detail).toBe(`No ${DEPLOY_WORKFLOW} in this project`);
      }
    );
  });
});

/**
 * Regression coverage for promoted-artifact integrity in B2.
 * @module tests/unit/cli/doctor-readiness-delivery-promotion
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import {
  asFindings,
  JOBS,
  makeScratchRepo,
  ON,
  PINNED_DOWNLOAD_ARTIFACT,
  PUBLISH_JOB,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUN_PUBLISH,
  RUNS_ON,
  STEPS,
  TAGS,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("promotion");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — promoted artifact integrity", () => {
  it("SKIPs when a downloaded artifact has no validating job tied to it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("SKIP");
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(String(asFindings(record.findings)[0].reason)).toContain(
      "cannot be tied to anything that was validated"
    );
  });
});

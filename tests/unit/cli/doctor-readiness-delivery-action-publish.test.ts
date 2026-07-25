/**
 * Regression coverage for B2 action-based publish steps from #1903.
 * @module tests/unit/cli/doctor-readiness-delivery-action-publish
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import {
  asFindings,
  FAIL,
  JOBS,
  makeScratchRepo,
  ON,
  PUBLISH_JOB,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUN_PACK,
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
  tempDir ??= await makeScratchRepo("action-publish");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B2 action publish steps", () => {
  it("FAILs when PyPI publish action ships a locally built artifact", async () => {
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
      RUN_PACK,
      "      - uses: pypa/gh-action-pypi-publish@release/v1",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(String(asFindings(record.findings)[0].evidence)).toContain(
      "pypa/gh-action-pypi-publish@release/v1"
    );
  });

  it("FAILs when GitHub release action ships a locally built artifact", async () => {
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
      RUN_PACK,
      "      - uses: softprops/action-gh-release@v2",
      "        with:",
      "          files: dist/*.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(String(asFindings(record.findings)[0].evidence)).toContain(
      "softprops/action-gh-release@v2"
    );
  });
});

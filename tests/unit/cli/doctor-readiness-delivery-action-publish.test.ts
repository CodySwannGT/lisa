/**
 * Regression coverage for B2 action-based publish steps from #1903.
 * @module tests/unit/cli/doctor-readiness-delivery-action-publish
 */
import { fail } from "node:assert/strict";
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

/**
 * The first entry of a list the assertion requires to be non-empty.
 * @param items - The list under test
 * @returns Its first entry, failing loudly when there is none
 */
const first = <T>(items: readonly T[]): T =>
  items[0] ?? fail("expected at least one entry");

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
    expect(first(assessReadiness([record]).blockers).id).toBe("B2");
    expect(String(first(asFindings(record.findings)).evidence)).toContain(
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
    expect(first(assessReadiness([record]).blockers).id).toBe("B2");
    expect(String(first(asFindings(record.findings)).evidence)).toContain(
      "softprops/action-gh-release@v2"
    );
  });
});

/**
 * Regression coverage for B2 jobs that publish more than one artifact.
 *
 * A release job can ship multiple things to different registries. The delivery
 * authority producer must assess each publish step, because a clean first
 * publish must not hide an unvalidated second one.
 * @module tests/unit/cli/doctor-readiness-delivery-multiple-publish
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
  RUNS_ON,
  STEPS,
  TAGS,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

const DOWNLOAD_ARTIFACT_STEP = "      - uses: actions/download-artifact@v4";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("multi-publish");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — multiple publish steps", () => {
  it("FAILs when a later publish step ships an unvalidated second artifact", async () => {
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
      "      - run: npm test",
      DOWNLOAD_ARTIFACT_STEP,
      "      - run: npm publish --provenance",
      "      - run: docker build -t ghcr.io/acme/app:latest .",
      "      - run: docker push ghcr.io/acme/app:latest",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);
    const findings = asFindings(record.findings);
    const evidence = String(findings[0].evidence);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers).toHaveLength(1);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(findings).toHaveLength(1);
    expect(evidence).toContain("docker push ghcr.io/acme/app:latest");
    expect(evidence).not.toContain("npm publish --provenance");
  });
});

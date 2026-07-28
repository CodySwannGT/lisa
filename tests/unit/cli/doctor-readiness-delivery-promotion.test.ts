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
  FAIL,
  JOBS,
  makeScratchRepo,
  ON,
  PINNED_DOWNLOAD_ARTIFACT,
  PUBLISH_JOB,
  PUSH,
  RUN_PACK,
  RELEASE_NAME,
  RELEASE_YML,
  RUN_PUBLISH,
  RUN_TEST,
  RUNS_ON,
  STEPS,
  TAGS,
  TEST_JOB,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

const PINNED_UPLOAD_ARTIFACT =
  "      - uses: actions/upload-artifact@0123456789abcdef0123456789abcdef01234567";
const ARTIFACT_WITH = "        with:";
const ARTIFACT_PATH_DIST = "          path: dist";
const NEEDS_TEST = "    needs: [test]";
const APP_PACKAGE_NAME = "          name: app-package";

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

  it("FAILs when a lookalike download-artifact action precedes a self-built publish", async () => {
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
      "      - uses: acme/actions/download-artifact@v1",
      RUN_PACK,
      "      - run: npm publish ./spoofed.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0]?.id).toBe("B2");
    expect(asFindings(record.findings)[0].evidence).toContain(
      "builds its own artifact and ships it"
    );
  });

  it("FAILs when release downloads a different named artifact than CI uploaded", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      PINNED_UPLOAD_ARTIFACT,
      ARTIFACT_WITH,
      "          name: tested-package",
      ARTIFACT_PATH_DIST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      ARTIFACT_WITH,
      "          name: untested-package",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0]?.id).toBe("B2");
    expect(String(asFindings(record.findings)[0].evidence)).toContain(
      "no validating ancestor uploads"
    );
  });

  it("FAILs when only a non-validating ancestor uploaded the downloaded artifact", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      "  package:",
      RUNS_ON,
      STEPS,
      PINNED_UPLOAD_ARTIFACT,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      ARTIFACT_PATH_DIST,
      PUBLISH_JOB,
      "    needs: [test, package]",
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0]?.id).toBe("B2");
    expect(String(asFindings(record.findings)[0].evidence)).toContain(
      "no validating ancestor uploads"
    );
  });

  // Test hardened to kill mutant M001 (Risk Factor: Release artifact integrity).
  it("SKIPs when a matching named artifact lacks digest or attestation verification", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      PINNED_UPLOAD_ARTIFACT,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      ARTIFACT_PATH_DIST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("SKIP");
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(String(asFindings(record.findings)[0].reason)).toContain(
      "no digest or attestation verification"
    );
  });

  // Test hardened to kill mutant M002 (Risk Factor: Release artifact integrity).
  it("PASSes a matching named artifact with attestation verification before publish", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      PINNED_UPLOAD_ARTIFACT,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      ARTIFACT_PATH_DIST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      "      - run: gh attestation verify dist/app.tgz --repo acme/app",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  // Test hardened to kill mutant M003 (Risk Factor: Release artifact integrity).
  // An attestation check that runs BEFORE the artifact is downloaded cannot
  // have verified the downloaded bytes, so it must not clear the finding.
  it("SKIPs a matching named artifact with attestation verification only before the download", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      TEST_JOB,
      RUNS_ON,
      STEPS,
      RUN_TEST,
      PINNED_UPLOAD_ARTIFACT,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      ARTIFACT_PATH_DIST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      STEPS,
      "      - run: gh attestation verify dist/app.tgz --repo acme/app",
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      ARTIFACT_WITH,
      APP_PACKAGE_NAME,
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe("SKIP");
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(String(asFindings(record.findings)[0].reason)).toContain(
      "no digest or attestation verification"
    );
  });
});

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
      "  test:",
      RUNS_ON,
      STEPS,
      "      - run: npm test",
      "      - uses: actions/upload-artifact@0123456789abcdef0123456789abcdef01234567",
      "        with:",
      "          name: tested-package",
      "          path: dist",
      PUBLISH_JOB,
      "    needs: [test]",
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      "        with:",
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
      "  test:",
      RUNS_ON,
      STEPS,
      "      - run: npm test",
      "  package:",
      RUNS_ON,
      STEPS,
      "      - uses: actions/upload-artifact@0123456789abcdef0123456789abcdef01234567",
      "        with:",
      "          name: app-package",
      "          path: dist",
      PUBLISH_JOB,
      "    needs: [test, package]",
      RUNS_ON,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      "        with:",
      "          name: app-package",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0]?.id).toBe("B2");
    expect(String(asFindings(record.findings)[0].evidence)).toContain(
      "no validating ancestor uploads"
    );
  });
});

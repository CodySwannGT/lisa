/**
 * Regression coverage for CICD-SEC-7 mutable action refs in release jobs.
 * @module tests/unit/cli/doctor-readiness-delivery-action-pins
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import {
  asFindings,
  CONTENTS_READ,
  FAIL,
  JOBS,
  makeScratchRepo,
  ON,
  PASS,
  PERMISSIONS,
  PINNED_DOWNLOAD_ARTIFACT,
  PUBLISH_JOB,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUNS_ON,
  STEPS,
  TAGS,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

const RUN_NPM_TEST = "      - run: npm test";
const ID_TOKEN_WRITE = "      id-token: write";
const RUN_NPM_PUBLISH = "      - run: npm publish --provenance";
const NEEDS_TEST = "    needs: [test]";
const CHECKOUT_V4_REF = "actions/checkout@v4";
const CHECKOUT_V4_ACTION = `      - uses: ${CHECKOUT_V4_REF}`;
const PINNED_DOCKER_IMAGE =
  "docker://ghcr.io/acme/releaser@sha256:" +
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("action-pins");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — release action pinning", () => {
  it("FAILs when a publishing job uses a mutable third-party action ref", async () => {
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
      RUN_NPM_TEST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      ID_TOKEN_WRITE,
      STEPS,
      "      - uses: actions/download-artifact@v4",
      "      - uses: softprops/action-gh-release@main",
      "        with:",
      "          files: dist/*.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);
    const evidence = String(asFindings(record.findings)[0].evidence);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(evidence).toContain("actions/download-artifact@v4");
    expect(evidence).toContain("softprops/action-gh-release@main");
    expect(evidence).toContain("full commit SHA");
  });

  it("PASSes a publishing job whose action refs are pinned to full SHAs", async () => {
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
      RUN_NPM_TEST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      ID_TOKEN_WRITE,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      RUN_NPM_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("FAILs when a validating ancestor uses a mutable action ref", async () => {
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
      CHECKOUT_V4_ACTION,
      RUN_NPM_TEST,
      PUBLISH_JOB,
      NEEDS_TEST,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      ID_TOKEN_WRITE,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      RUN_NPM_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);
    const evidence = String(asFindings(record.findings)[0].evidence);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(evidence).toContain(CHECKOUT_V4_REF);
    expect(evidence).toContain("validating ancestor");
  });

  it("FAILs when a publishing job uses a tagged Docker action ref", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      ID_TOKEN_WRITE,
      STEPS,
      '      - uses: "docker://ghcr.io/acme/releaser:v1"',
      RUN_NPM_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);
    const evidence = String(asFindings(record.findings)[0].evidence);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
    expect(evidence).toContain("docker://ghcr.io/acme/releaser:v1");
  });

  it("PASSes a publishing job whose Docker action ref is digest pinned", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      ID_TOKEN_WRITE,
      STEPS,
      `      - uses: ${PINNED_DOWNLOAD_ARTIFACT}`,
      `      - uses: "${PINNED_DOCKER_IMAGE}"`,
      RUN_NPM_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("does not report mutable refs in non-publishing jobs", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      "  quality:",
      RUNS_ON,
      STEPS,
      CHECKOUT_V4_ACTION,
      RUN_NPM_TEST,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).not.toBe(FAIL);
    expect(JSON.stringify(record.findings)).not.toContain(CHECKOUT_V4_REF);
  });
});

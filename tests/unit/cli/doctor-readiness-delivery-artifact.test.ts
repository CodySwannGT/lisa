/**
 * Unit coverage for B2's artifact chain: does the thing that ships equal the
 * thing that was validated (PRD #1739, #1896)?
 *
 * These cases are the ones provable from a workflow file alone — the `needs:`
 * traversal that finds validation (including transitively, and without looping
 * on a cycle), the rebuild-past-validation bypass that no trigger excuses, the
 * refusal to accept a loose `test` substring as proof, and the evidence
 * hygiene that keeps a shell script out of the persisted report.
 * @module tests/unit/cli/doctor-readiness-delivery-artifact
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  makeScratchRepo,
  FAIL,
  JOBS,
  ON,
  PASS,
  PUBLISH_JOB,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUN_BUILD,
  RUN_PACK,
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
  tempDir ??= await makeScratchRepo("artifact");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B2 artifact chain", () => {
  it("PASSes a validation performed transitively two needs levels up", async () => {
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
      "      - run: npm run test",
      "  package:",
      "    needs: [test]",
      RUNS_ON,
      STEPS,
      RUN_PACK,
      PUBLISH_JOB,
      "    needs: [package]",
      RUNS_ON,
      STEPS,
      "      - uses: actions/download-artifact@v4",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("FAILs when the release job repacks its own artifact even though CI validated the source", async () => {
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
      "      - run: npm run test",
      PUBLISH_JOB,
      "    needs: [test]",
      RUNS_ON,
      STEPS,
      RUN_PACK,
      "      - run: npm publish ./repacked.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Validating the SOURCE then repacking at release time is the classic
    // bypass: the bytes that ship were never the bytes that were checked. It is
    // provable from this file alone, so no trigger exempts it.
    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
  });

  it("truncates a very long step label instead of carrying it whole", async () => {
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
      "      - name: Publish the package to the public registry after packing " +
        "it locally in this very same job which is exactly the problem",
      "        run: npm publish ./unvalidated-fresh-build.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    const evidence = String(asFindings(record.findings)[0].evidence);
    expect(record.status).toBe(FAIL);
    expect(evidence).toContain("…");
    expect(evidence).not.toContain("exactly the problem");
  });

  it("terminates on a needs: cycle rather than recursing forever", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      "  a:",
      "    needs: [b]",
      RUNS_ON,
      STEPS,
      RUN_PACK,
      "  b:",
      "    needs: [a]",
      RUNS_ON,
      STEPS,
      "      - run: npm publish ./from-cycle.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
  });

  it("PASSes a single job that validates before it publishes", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, [
      RELEASE_NAME,
      ON,
      PUSH,
      TAGS,
      JOBS,
      "  release:",
      RUNS_ON,
      STEPS,
      "      - run: npm test",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("still FAILs when a rebuild happens AFTER the artifact was downloaded", async () => {
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
      "      - uses: actions/download-artifact@v4",
      RUN_BUILD,
      "      - run: npm publish ./rebuilt.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
  });

  it("does not accept a loose 'test' substring as validation", async () => {
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
      '      - run: echo "test the release notes"',
      RUN_PACK,
      "      - run: npm publish ./unvalidated-fresh-build.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    expect(assessReadiness([record]).blockers[0].id).toBe("B2");
  });

  it("quotes a readable step label rather than dumping a multi-line script", async () => {
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
      "      - name: Publish the package",
      "        run: |",
      "          set -euo pipefail",
      "          npm pack",
      "          npm publish ./unvalidated-fresh-build.tgz",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    const evidence = String(asFindings(record.findings)[0].evidence);
    expect(record.status).toBe(FAIL);
    expect(evidence).toContain("Publish the package");
    expect(evidence).not.toContain("set -euo pipefail");
    expect(evidence).not.toContain("\n");
  });
});

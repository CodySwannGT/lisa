/**
 * Unit coverage for B2's conservatism: the readiness producers must never
 * manufacture RED from absence (PRD #1739, #1896).
 *
 * Reading workflow files offline cannot see a calling workflow, an upstream
 * `workflow_run`, or a branch protection rule. So when the file alone does not
 * PROVE that what ships bypassed what was validated, the honest answer is a
 * stated-reason SKIP — a FAIL there would report correct repositories as unsafe,
 * which is exactly how a gate loses its authority. This suite pins each case
 * where silence must not be read as a bypass, plus the traversal and evidence
 * details B2 depends on.
 * @module tests/unit/cli/doctor-readiness-delivery-triggers
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";

/** The shape a persisted readiness finding is read back as in assertions. */
type Finding = Record<string, unknown>;

let tempDir: string | undefined;

/**
 * Resolve a temporary directory for one trigger test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-readiness-triggers-"));
  return tempDir;
}

/**
 * Write one workflow file into the scratch repository.
 * @param root - Repository root
 * @param fileName - Workflow file name
 * @param lines - Raw YAML lines
 */
async function writeWorkflow(
  root: string,
  fileName: string,
  lines: readonly string[]
): Promise<void> {
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), `${lines.join("\n")}\n`, "utf8");
}

/**
 * Read a dimension record's findings as plain objects.
 * @param findings - The raw findings array
 * @returns The findings as records
 */
function asFindings(findings: readonly unknown[]): readonly Finding[] {
  return findings.map(finding => finding as Finding);
}

/** Repeated YAML fixture lines, named once so the fixtures stay readable. */
const JOBS = "jobs:";
const ON_PUSH = "on: [push]";
const ON = "on:";
const PUSH = "  push:";
const TAGS = "    tags: ['v*']";
const RUNS_ON = "    runs-on: ubuntu-latest";
const PERMISSIONS = "    permissions:";
const CONTENTS_READ = "      contents: read";
const STEPS = "    steps:";
const PUBLISH_JOB = "  publish:";
const SHIP_JOB = "  ship:";

/** Statuses and file names reused across the fixtures. */
const SKIP = "SKIP";
const FAIL = "FAIL";
const PASS = "PASS";
const CI_YML = "ci.yml";
const DEPLOY_YML = "deploy.yml";
const RELEASE_YML = "release.yml";
const RELEASE_NAME = "name: Release";

/** Repeated step lines. */
const RUN_PUBLISH = "      - run: npm publish --provenance";
const RUN_BUILD = "      - run: npm run build";
const RUN_PACK = "      - run: npm pack";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B2 never manufactures RED from absence", () => {
  it("SKIPs a workflow_call publish workflow instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, "publish-to-npm.yml", [
      "name: Publish to npm",
      ON,
      "  workflow_call:",
      "    inputs:",
      "      tag:",
      "        required: true",
      "        type: string",
      JOBS,
      PUBLISH_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      "      - run: bun run build:dist",
      RUN_PUBLISH,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Validation is the caller's obligation, and callers are not resolved
    // offline — absence of an in-file validating job proves nothing here.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
    const findings = asFindings(record.findings);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("SKIPs a workflow_run-triggered deploy instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      "name: Deploy",
      ON,
      "  workflow_run:",
      "    workflows: [CI]",
      "    types: [completed]",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_BUILD,
      "      - run: aws s3 sync ./dist s3://bucket",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs a default-branch push deploy instead of failing it", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      "name: Deploy",
      ON,
      "  push:",
      "    branches: [main]",
      JOBS,
      SHIP_JOB,
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_BUILD,
      "      - run: cdk deploy",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Branch protection may require the validating checks upstream; that is not
    // visible in the workflow file, so silence is not evidence of a bypass.
    expect(record.status).toBe(SKIP);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs with a stated reason when workflows exist but nothing publishes", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  test:",
      RUNS_ON,
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      "      - run: npm run test",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // A repository that ships nothing has not proved that what ships equals what
    // was validated — it has proved nothing at all. PASS here is a false green.
    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(JSON.stringify(record.findings)).not.toContain(
      "every publishing job is preceded by validation"
    );
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

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

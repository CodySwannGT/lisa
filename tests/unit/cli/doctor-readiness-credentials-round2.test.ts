/**
 * Round-2 regression coverage for B3 credential-authority detection from #1903.
 *
 * These cases pin common credential spellings that the v1 producer missed while
 * keeping the broader delivery-authority suite under its file-size budget.
 * @module tests/unit/cli/doctor-readiness-credentials-round2
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDeliveryAuthorityDimension } from "../../../src/cli/doctor-readiness-delivery.js";
import {
  asFindings,
  CONTENTS_READ,
  DEPLOY_NAME,
  DEPLOY_YML,
  FAIL,
  JOBS,
  makeScratchRepo,
  ON_PUSH,
  PERMISSIONS,
  RUN_DEPLOY,
  STEPS,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary repository path
 */
async function getTempDir(): Promise<string> {
  tempDir = await makeScratchRepo("credentials-round2");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessDeliveryAuthorityDimension — B3 round-2 credentials", () => {
  // Test hardened to kill mutant M001 (Risk Factor: Data security / credential authority).
  it("FAILs with B3 when gh CLI uses GH_TOKEN with no permissions block", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  comment:",
      STEPS,
      "      - run: gh pr comment 1 --body hi",
      "        env:",
      "          GH_TOKEN: ${{ github.token }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("GH_TOKEN");
  });

  // Test hardened to kill mutant M002 (Risk Factor: Data security / credential authority).
  it.each([
    ["NPM_TOKEN", "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}"],
    [
      "GCP_SERVICE_ACCOUNT_JSON",
      "          GCP_SERVICE_ACCOUNT_JSON: ${{ secrets.GCP_SERVICE_ACCOUNT_JSON }}",
    ],
    [
      "AZURE_CREDENTIALS",
      "          AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}",
    ],
    ["ADMIN_PAT", "          GH_TOKEN: ${{ secrets.ADMIN_PAT }}"],
  ])("FAILs with B3 on static %s deployment credentials", async (key, line) => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  ship:",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_DEPLOY,
      "        env:",
      line,
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain(key);
  });

  // Test hardened to kill mutant M003 (Risk Factor: Data security / credential authority).
  it("reports a non-exempt static credential after an OIDC-exempt cloud key", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  ship:",
      "    permissions:",
      "      contents: read",
      "      id-token: write",
      STEPS,
      "      - uses: aws-actions/configure-aws-credentials@v4",
      "        with:",
      "          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}",
      "      - run: npm publish --provenance",
      "        env:",
      "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("NPM_TOKEN");
    expect(finding?.evidence).not.toContain("aws-access-key-id");
  });

  it("FAILs with B3 when a reusable workflow call maps a static credential via with:", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  publish:",
      "    uses: ./.github/workflows/publish.yml",
      "    with:",
      "      registry-token: ${{ secrets.NPM_TOKEN }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("NPM_TOKEN");
    expect(finding?.evidence).toContain("job `publish`");
  });

  // Covers the secrets:-only path CodeRabbit flagged as untested on PR #1990:
  // jobText() previously omitted job-level `secrets:` mappings entirely, so a
  // reusable-workflow call that only passes a static credential through
  // `secrets:` (no `with:`) went undetected.
  it("FAILs with B3 when a reusable workflow call maps a static credential via secrets:", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  publish:",
      "    uses: ./.github/workflows/publish.yml",
      "    secrets:",
      "      npm-token: ${{ secrets.NPM_TOKEN }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("NPM_TOKEN");
    expect(finding?.evidence).toContain("job `publish`");
  });
});

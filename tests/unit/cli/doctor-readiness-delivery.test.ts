/**
 * Unit coverage for the delivery/authority readiness producers (B2 + B3,
 * PRD #1739, #1896).
 *
 * Dimension 7 asks two questions the rest of the readiness report cannot answer:
 * does the thing that ships equal the thing that was validated (blocker B2), and
 * does the shipping credential carry only the authority it needs (blocker B3)?
 * This suite pins both, entirely offline, over real `.github/workflows/*.yml`
 * fixtures written into a scratch repository.
 *
 * The load-bearing negative case is the clean repository: the blocker engine
 * stands a blocker on ANY finding that names a blocker id and carries evidence,
 * regardless of the finding's status, so a PASS finding must carry no `blocker`
 * key at all — otherwise a healthy repository would be reported NOT_READY.
 * @module tests/unit/cli/doctor-readiness-delivery
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DELIVERY_AUTHORITY_DIMENSION_ID,
  assessDeliveryAuthorityDimension,
} from "../../../src/cli/doctor-readiness-delivery.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  CI_YML,
  CONTENTS_READ,
  DEPLOY_NAME,
  DEPLOY_YML,
  FAIL,
  JOBS,
  makeScratchRepo,
  ON,
  ON_PUSH,
  PASS,
  PERMISSIONS,
  PUBLISH_JOB,
  PUSH,
  RELEASE_NAME,
  RELEASE_YML,
  RUN_DEPLOY,
  RUN_PACK,
  RUN_PUBLISH,
  RUN_TEST,
  RUNS_ON,
  SKIP,
  STEPS,
  TAGS,
  TEST_JOB,
  USES_DOWNLOAD,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "delivery-authority";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("delivery");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

/** A release workflow whose publish job ships an unvalidated local build. */
const B2_VIOLATION_WORKFLOW = [
  RELEASE_NAME,
  ON,
  PUSH,
  TAGS,
  JOBS,
  PUBLISH_JOB,
  RUNS_ON,
  PERMISSIONS,
  CONTENTS_READ,
  STEPS,
  "      - uses: actions/checkout@v4",
  RUN_PACK,
  "      - run: npm publish ./unvalidated-fresh-build.tgz",
];

/** A release workflow that validates first and promotes the CI-built artifact. */
const CLEAN_RELEASE_WORKFLOW = [
  RELEASE_NAME,
  ON,
  PUSH,
  TAGS,
  JOBS,
  TEST_JOB,
  RUNS_ON,
  PERMISSIONS,
  CONTENTS_READ,
  STEPS,
  RUN_TEST,
  PUBLISH_JOB,
  "    needs: [test]",
  RUNS_ON,
  PERMISSIONS,
  CONTENTS_READ,
  "      id-token: write",
  STEPS,
  USES_DOWNLOAD,
  RUN_PUBLISH,
];

describe("assessDeliveryAuthorityDimension — B2 (release path bypasses validation)", () => {
  it("FAILs with an evidenced B2 finding when a publish job ships a locally built artifact", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, B2_VIOLATION_WORKFLOW);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.id).toBe(DIMENSION_ID);
    expect(record.status).toBe(FAIL);
    const findings = asFindings(record.findings);
    expect(findings[0].blocker).toBe("B2");
    expect(typeof findings[0].evidence).toBe("string");
    expect(findings[0].evidence).not.toBe("");
    expect(findings[0].evidence).toContain("publish");
    expect(findings[0].evidence).toContain(
      "npm publish ./unvalidated-fresh-build.tgz"
    );
    expect(findings[0].invariant_violated).not.toBe("");
    expect(typeof findings[0].why_proof_missed).toBe("string");
    expect(typeof findings[0].root_correction).toBe("string");
    expect(Array.isArray(findings[0].machinery_to_remove)).toBe(true);
  });

  it("flips the readiness verdict to NOT_READY with B2 standing on dimension 7", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, B2_VIOLATION_WORKFLOW);

    const record = await assessDeliveryAuthorityDimension(cwd);
    const assessment = assessReadiness([record]);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers[0].id).toBe("B2");
    expect(assessment.blockers[0].dimension_id).toBe(DIMENSION_ID);
    expect(assessment.blockers[0].label).toBe(
      "A release path bypasses the validated artifact"
    );
    expect(assessment.narrowed_claim).toContain("NOT ready");
  });

  it("PASSes and attaches NO blocker key when validation precedes a promoted artifact", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, CLEAN_RELEASE_WORKFLOW);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(PASS);
    // Load-bearing: the engine stands a blocker on any finding naming an id with
    // evidence, so a clean finding must not name one at all.
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(assessReadiness([record]).verdict).toBe("READY");
  });

  it("SKIPs with a stated reason when the repository has no workflows to assess", async () => {
    const cwd = await getTempDir();

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].skip).toBe(true);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });
});

describe("assessDeliveryAuthorityDimension — B3 (credential over-authority)", () => {
  it("FAILs with an evidenced B3 finding on secrets: inherit", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "    secrets: inherit",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding).toBeDefined();
    expect(finding?.evidence).toContain("secrets: inherit");
    expect(finding?.evidence).toContain("ci.yml");
    expect(finding?.invariant_violated).not.toBe("");

    const assessment = assessReadiness([record]);
    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers[0].id).toBe("B3");
    expect(assessment.blockers[0].dimension_id).toBe(DIMENSION_ID);
  });

  it("FAILs with B3 on a write-all permissions grant", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      "permissions: write-all",
      JOBS,
      "  build:",
      STEPS,
      "      - run: npm run build",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("write-all");
  });

  it("FAILs with B3 when a job uses GITHUB_TOKEN with no permissions block", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, CI_YML, [
      "name: CI",
      ON_PUSH,
      JOBS,
      "  comment:",
      STEPS,
      "      - run: gh pr comment 1 --body hi",
      "        env:",
      "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("GITHUB_TOKEN");
  });

  it("FAILs with B3 on static AWS keys where OIDC would do", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  ship:",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      "      - uses: aws-actions/configure-aws-credentials@v4",
      "        with:",
      "          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}",
      "          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === "B3"
    );
    expect(finding?.evidence).toContain("aws-access-key-id");
  });

  it("does NOT stand a blocker when one secret name appears in two environments", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  staging:",
      "    environment: staging",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_DEPLOY,
      "        env:",
      "          DEPLOY_KEY: ${{ secrets.SHARED_DEPLOY_KEY }}",
      "  production:",
      "    environment: production",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_DEPLOY,
      "        env:",
      "          DEPLOY_KEY: ${{ secrets.SHARED_DEPLOY_KEY }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // Environment secrets are SUPPOSED to reuse one name across environments —
    // that is the recommended least-privilege pattern, and repo-scope vs
    // environment-scope is not decidable from YAML. Surface it, never block on it.
    expect(record.status).not.toBe(FAIL);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).toContain("SHARED_DEPLOY_KEY");
  });

  it("never treats GITHUB_TOKEN as a secret shared across environments", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, DEPLOY_YML, [
      DEPLOY_NAME,
      ON_PUSH,
      JOBS,
      "  staging:",
      "    environment: staging",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_DEPLOY,
      "        env:",
      "          TOKEN: ${{ secrets.GITHUB_TOKEN }}",
      "  production:",
      "    environment: production",
      PERMISSIONS,
      CONTENTS_READ,
      STEPS,
      RUN_DEPLOY,
      "        env:",
      "          TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    ]);

    const record = await assessDeliveryAuthorityDimension(cwd);

    // GITHUB_TOKEN is minted per job per run: sharing it across environments is
    // not a thing that can happen, so it must never be reported as one.
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).not.toContain("GITHUB_TOKEN");
  });

  it("attaches no blocker key when credentials are scoped and OIDC is used", async () => {
    const cwd = await getTempDir();
    await writeWorkflow(cwd, RELEASE_YML, CLEAN_RELEASE_WORKFLOW);

    const record = await assessDeliveryAuthorityDimension(cwd);

    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});

describe("delivery/authority dimension identity", () => {
  it("owns the delivery-authority dimension id from the readiness rubric", () => {
    expect(DELIVERY_AUTHORITY_DIMENSION_ID).toBe("delivery-authority");
  });
});

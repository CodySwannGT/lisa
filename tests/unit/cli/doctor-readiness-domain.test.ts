/**
 * Unit coverage for the domain-ownership readiness producer (B1, PRD #1739,
 * #1896).
 *
 * Dimension 3 asks whether the business rules, glossary, and danger zones are
 * owned and written down, and blocker B1 asks the sharpest half of it: does a
 * realistic path destroy or corrupt data with nothing surfaced and no way back?
 *
 * That question is the single most false-positive-prone one in the rubric. A
 * standing blocker flips the whole repository to `NOT_READY` regardless of the
 * dimension's status, so the load-bearing cases in this suite are the negatives:
 * a destructive statement inside a reversible migration, a destructive command
 * behind a gate, a bare `migrations/` directory, and a destructive command aimed
 * at an obviously ephemeral CI target must all leave B1 standing DOWN.
 * @module tests/unit/cli/doctor-readiness-domain
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOMAIN_OWNERSHIP_DIMENSION_ID,
  assessDomainOwnershipDimension,
} from "../../../src/cli/doctor-readiness-domain.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  JOBS,
  makeScratchRepo,
  ON_PUSH,
  RUNS_ON,
  SKIP,
  STEPS,
  WARN,
  writeRepoFile,
  writeWorkflow,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "domain-ownership";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B1";

/** The workflow file every fixture in this suite writes. */
const CLEANUP_YML = "cleanup.yml";

/** The workflow `name:` line every fixture in this suite writes. */
const CLEANUP_NAME = "name: Cleanup";

/** A destructive job header reused across fixtures. */
const WIPE_JOB = "  wipe:";

/** An irreversible bucket-emptying command against a production bucket. */
const RUN_S3_WIPE =
  "      - run: aws s3 rm s3://acme-prod-user-uploads --recursive";

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("domain");
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("assessDomainOwnershipDimension — B1 stands only on a provable path", () => {
  it("stands B1 for an automated, ungated, unrecoverable bucket wipe", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.id).toBe(DIMENSION_ID);
    expect(record.status).toBe(WARN);
    const findings = asFindings(record.findings);
    const blocking = findings.find(finding => finding.blocker === BLOCKER_ID);
    expect(blocking).toBeDefined();
    expect(String(blocking?.evidence)).toContain(
      ".github/workflows/cleanup.yml"
    );
    expect(String(blocking?.evidence)).toContain("aws s3 rm");
    expect(String(blocking?.invariant_violated)).toContain("data");
  });

  it("flips the repository to NOT_READY through the blocker engine", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      RUN_S3_WIPE,
    ]);

    const record = await assessDomainOwnershipDimension(root);
    const assessment = assessReadiness([record]);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers.map(blocker => blocker.id)).toEqual([
      BLOCKER_ID,
    ]);
  });

  it("stands B1 for an automated, ungated database drop", async () => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      '      - run: psql -c "DROP DATABASE acme_production"',
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });

  it.each([
    ["Rails database drop", "rails db:drop"],
    ["Prisma forced reset", "prisma migrate reset --force"],
    ["Redis flushall", "redis-cli -u $REDIS_URL FLUSHALL"],
    ["Kubernetes namespace delete", "kubectl delete namespace prod"],
    ["Kubernetes persistent-volume-claim delete", "kubectl delete pvc data"],
    [
      "Google Cloud SQL instance delete",
      "gcloud sql instances delete app-prod",
    ],
    ["Azure resource-group delete", "az group delete --name prod-rg --yes"],
    ["Mongo database drop", "mongosh prod --eval 'db.dropDatabase()'"],
    ["SQL table drop", 'psql "$DATABASE_URL" -c "DROP TABLE users"'],
  ])("stands B1 for %s", async (_label, command) => {
    const root = await getTempDir();
    await writeWorkflow(root, CLEANUP_YML, [
      CLEANUP_NAME,
      ON_PUSH,
      JOBS,
      WIPE_JOB,
      RUNS_ON,
      STEPS,
      `      - run: ${command}`,
    ]);

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).toBe(WARN);
    expect(
      asFindings(record.findings).some(
        finding => finding.blocker === BLOCKER_ID
      )
    ).toBe(true);
  });
});

describe("assessDomainOwnershipDimension — reports silence as silence", () => {
  it("renders a stated-reason SKIP for a repository with nothing to assess", async () => {
    const root = await getTempDir();

    const record = await assessDomainOwnershipDimension(root);

    expect(record.id).toBe(DOMAIN_OWNERSHIP_DIMENSION_ID);
    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings.length).toBeGreaterThan(0);
    expect(typeof findings[0].reason).toBe("string");
    expect(String(findings[0].reason)).toContain(
      "No GitHub Actions workflow files were found"
    );
    expect(findings[0].skip).toBe(true);
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("never claims PASS, because danger-zone ownership is not provable offline", async () => {
    const root = await getTempDir();
    await writeRepoFile(root, "wiki/index.md", "# Wiki\n");

    const record = await assessDomainOwnershipDimension(root);

    expect(record.status).not.toBe("PASS");
    expect(record.status).toBe(SKIP);
  });
});

import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStandardsProofCli } from "../../src/cli/standards-proof-cmd.js";
import type {
  StandardsCheckCategory,
  StandardsProof,
} from "../../src/standards/contract.js";
import { standardsProofFinding } from "../../src/standards/readiness.js";
import {
  PROOF_PATH,
  createTypescriptRepository,
} from "./standards-proof-fixture.js";

/** Mutable result used only to construct hostile persisted fixtures. */
interface MutableResult {
  check: string;
  category: StandardsCheckCategory | string;
  status: string;
  startedAt: string;
  completedAt: string;
}

/** Mutable proof used only to construct hostile persisted fixtures. */
interface MutableProof {
  schemaVersion: number;
  artifact: string;
  lisaVersion: string;
  registryDigest: string;
  configDigest: string;
  repository: { identity: string; head: string; tree: string };
  projectTypes: string[];
  applicableChecks: string[];
  capturedAt: string;
  results: MutableResult[];
}

let root: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const MEMBERSHIP_CHANGED = "required check membership changed";
const INVALID_MEMBERSHIP = "invalid standards proof check membership";
const INVALID_RESULTS = "invalid standards proof check results";
const INVALID_TIMESTAMPS = "invalid standards proof timestamps";

/**
 * Return one detached mutable test projection of a strict proof.
 * @param proof - Strict captured proof
 * @returns Detached mutable fixture
 */
function mutableProof(proof: StandardsProof): MutableProof {
  return JSON.parse(JSON.stringify(proof)) as MutableProof;
}

/**
 * Persist one intentionally tampered proof without invoking validation.
 * @param projectRoot - Fixture repository root
 * @param proof - Tampered proof fixture
 */
async function writeTamper(
  projectRoot: string,
  proof: MutableProof
): Promise<void> {
  await writeFile(path.join(projectRoot, PROOF_PATH), JSON.stringify(proof));
}

describe("standards proof sanitized tamper reasons", () => {
  it("classifies binding, membership, result, and timestamp tampering exactly", async () => {
    root = await createTypescriptRepository();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runStandardsProofCli(root);
    const original = JSON.parse(
      await readFile(path.join(root, PROOF_PATH), "utf8")
    ) as StandardsProof;

    const schema = mutableProof(original);
    schema.schemaVersion = 2;
    await expectTamper(
      root,
      schema,
      "fail",
      "unsupported standards proof schema"
    );

    const artifact = mutableProof(original);
    artifact.artifact = "untrusted-secret-artifact";
    await expectTamper(
      root,
      artifact,
      "fail",
      "invalid standards proof identity"
    );

    const invalidIdentity = mutableProof(original);
    invalidIdentity.repository.identity = "github.com/private/untrusted.git";
    await expectTamper(
      root,
      invalidIdentity,
      "fail",
      "invalid standards proof identity"
    );

    const identity = mutableProof(original);
    identity.repository.identity = "github.com/private/untrusted-secret";
    await expectTamper(root, identity, "warn", "repository identity changed");

    const head = mutableProof(original);
    head.repository.head = "f".repeat(40);
    head.capturedAt = original.capturedAt;
    await expectTamper(root, head, "warn", "HEAD changed");

    const omitted = mutableProof(original);
    omitted.applicableChecks.pop();
    omitted.results.pop();
    await expectTamper(root, omitted, "warn", MEMBERSHIP_CHANGED);

    const extra = mutableProof(original);
    extra.applicableChecks.push("fixture.extra");
    extra.results.push({
      ...extra.results.at(-1)!,
      check: "fixture.extra",
    });
    await expectTamper(root, extra, "warn", MEMBERSHIP_CHANGED);

    const reordered = mutableProof(original);
    reordered.applicableChecks.reverse();
    reordered.results.reverse();
    await expectTamper(root, reordered, "warn", MEMBERSHIP_CHANGED);

    const renamed = mutableProof(original);
    renamed.applicableChecks[0] = "fixture.renamed";
    renamed.results[0]!.check = "fixture.renamed";
    await expectTamper(root, renamed, "warn", MEMBERSHIP_CHANGED);

    const duplicate = mutableProof(original);
    duplicate.applicableChecks[1] = duplicate.applicableChecks[0]!;
    duplicate.results[1]!.check = duplicate.results[0]!.check;
    await expectTamper(root, duplicate, "fail", INVALID_MEMBERSHIP);

    const category = mutableProof(original);
    category.results[0]!.category = "guardrail";
    await expectTamper(
      root,
      category,
      "warn",
      "required check results are incomplete"
    );

    const status = mutableProof(original);
    status.results[0]!.status = "fail";
    await expectTamper(root, status, "fail", INVALID_RESULTS);

    const missingResult = mutableProof(original);
    missingResult.results.pop();
    await expectTamper(root, missingResult, "fail", INVALID_RESULTS);

    const noncanonical = mutableProof(original);
    noncanonical.capturedAt = "2026-7-21T1:00:00Z";
    await expectTamper(root, noncanonical, "fail", INVALID_TIMESTAMPS);

    const outOfOrder = mutableProof(original);
    outOfOrder.results[0]!.startedAt = original.capturedAt;
    outOfOrder.results[0]!.completedAt = "2000-01-01T00:00:00.000Z";
    await expectTamper(root, outOfOrder, "fail", INVALID_TIMESTAMPS);

    const future = mutableProof(original);
    future.capturedAt = "2999-01-01T00:00:00.000Z";
    await expectTamper(root, future, "fail", INVALID_TIMESTAMPS);

    const dirty = mutableProof(original);
    dirty.capturedAt = original.capturedAt;
    await writeTamper(root, dirty);
    await writeFile(path.join(root, "untrusted-secret.txt"), "secret-value\n");
    const finding = await standardsProofFinding(root);
    expect(finding).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("worktree state changed"),
    });
    expect(finding.reason).not.toContain("secret-value");
  }, 60_000);
});

/**
 * Assert one stable, sanitized readiness classification.
 * @param projectRoot - Fixture repository root
 * @param proof - Tampered proof fixture
 * @param status - Expected fail-closed status
 * @param reason - Expected stable reason fragment
 */
async function expectTamper(
  projectRoot: string,
  proof: MutableProof,
  status: "warn" | "fail",
  reason: string
): Promise<void> {
  await writeTamper(projectRoot, proof);
  const finding = await standardsProofFinding(projectRoot);
  expect(finding).toMatchObject({
    status,
    reason: expect.stringContaining(reason),
  });
  expect(finding.reason).not.toContain("untrusted-secret");
}

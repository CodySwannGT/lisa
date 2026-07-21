/**
 * Unit coverage for the dependencies/supply-chain readiness producer (B5,
 * PRD #1739, #1896).
 *
 * Dimension 6 asks whether belief that the owned surface still works rests on
 * more than hope. The producer answers it offline from the repository's own
 * manifest, lockfile, CI declarations, and audit allowlist — so this suite
 * writes those real files into a scratch repository and pins each answer.
 *
 * The load-bearing negative case is the clean repository: the blocker engine
 * stands a blocker on ANY finding that names a blocker id and carries evidence,
 * regardless of the finding's status, so a PASS finding must carry no `blocker`
 * key at all — otherwise a healthy repository would be reported NOT_READY.
 * @module tests/unit/cli/doctor-readiness-supply-chain
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID,
  assessDependenciesSupplyChainDimension,
} from "../../../src/cli/doctor-readiness-supply-chain.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  FAIL,
  makeScratchRepo,
  PASS,
  SKIP,
  writeRepoFile,
  writeRepoJson,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "dependencies-supply-chain";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The manifest every fixture writes. */
const PACKAGE_JSON = "package.json";

/** The lockfile most fixtures commit. */
const BUN_LOCK = "bun.lock";

/** The update-bot config most fixtures use as their audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** A manifest whose dependency specs are all exactly pinned or caret-ranged. */
const PINNED_MANIFEST = {
  name: "scratch",
  version: "1.0.0",
  dependencies: { "js-yaml": "^4.1.0" },
  devDependencies: { vitest: "3.2.4" },
};

/** A dependabot config: the cheapest form of a real dependency-audit gate. */
const DEPENDABOT_YML = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: npm",
  '    directory: "/"',
  "    schedule:",
  "      interval: weekly",
  "",
].join("\n");

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("supply-chain");
  return tempDir;
}

/**
 * Write a repository that is clean on every B5 axis: pinned manifest, a
 * lockfile, and a dependency-audit gate.
 * @param root - Repository root
 */
async function writeCleanRepo(root: string): Promise<void> {
  await writeRepoJson(root, PACKAGE_JSON, PINNED_MANIFEST);
  await writeRepoFile(root, BUN_LOCK, '{"lockfileVersion": 1}\n');
  await writeRepoFile(root, DEPENDABOT_PATH, DEPENDABOT_YML);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — B5 violations", () => {
  it("FAILs with an evidenced B5 finding when no lockfile is committed", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, DEPENDABOT_PATH, DEPENDABOT_YML);

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.id).toBe(DIMENSION_ID);
    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding).toBeDefined();
    expect(typeof finding?.evidence).toBe("string");
    expect(finding?.evidence).not.toBe("");
    expect(finding?.evidence).toContain("lockfile");
    expect(finding?.evidence).toContain(PACKAGE_JSON);
    expect(finding?.invariant_violated).not.toBe("");
    expect(typeof finding?.why_proof_missed).toBe("string");
    expect(typeof finding?.root_correction).toBe("string");
    expect(Array.isArray(finding?.machinery_to_remove)).toBe(true);
  });

  it("flips the readiness verdict to NOT_READY with B5 standing on dimension 6", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, DEPENDABOT_PATH, DEPENDABOT_YML);

    const record = await assessDependenciesSupplyChainDimension(cwd);
    const assessment = assessReadiness([record]);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers[0].id).toBe(BLOCKER_ID);
    expect(assessment.blockers[0].dimension_id).toBe(DIMENSION_ID);
    expect(assessment.blockers[0].label).toBe(
      "An owned compatibility or security surface has no confidence model"
    );
    expect(assessment.narrowed_claim).toContain("NOT ready");
  });

  it("FAILs with B5 when a dependency spec floats instead of naming a version", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: { "left-pad": "*", "js-yaml": "^4.1.0" },
      devDependencies: { vitest: "latest" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("left-pad");
    expect(finding?.evidence).toContain("vitest");
    expect(finding?.evidence).not.toContain("js-yaml");
  });

  it("FAILs with B5 when an override floats to whatever resolves today", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: { "js-yaml": "^4.1.0" },
      overrides: { axios: ">=1.15.2", minimist: "*" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("minimist");
    // A `>=` security floor in `overrides` is the recommended way to force a
    // patched transitive dependency — it must never be reported as floating.
    expect(finding?.evidence).not.toContain("axios");
  });

  it("FAILs with B5 when nothing anywhere audits the dependency tree", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, BUN_LOCK, '{"lockfileVersion": 1}\n');

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("audit");
  });

  it("FAILs with B5 when an audit exclusion carries no decision record", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, "audit.ignore.config.json", {
      exclusions: [
        { id: "GHSA-1111-aaaa-bbbb", package: "left-pad", reason: "dev only" },
        { id: "GHSA-2222-cccc-dddd", package: "minimist" },
      ],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("GHSA-2222-cccc-dddd");
    expect(finding?.evidence).not.toContain("GHSA-1111-aaaa-bbbb");
  });
});

describe("assessDependenciesSupplyChainDimension — clean and unassessable repositories", () => {
  it("PASSes and attaches NO blocker key when pinned, locked, and audited", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    // Load-bearing: the engine stands a blocker on any finding naming an id with
    // evidence, so a clean finding must not name one at all.
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(assessReadiness([record]).verdict).toBe("READY");
  });

  it("accepts an audit gate declared only in a CI workflow", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, "package-lock.json", '{"lockfileVersion": 3}\n');
    await writeRepoFile(
      cwd,
      ".github/workflows/quality.yml",
      [
        "name: Quality",
        "jobs:",
        "  scan:",
        "    steps:",
        "      - run: npm audit --audit-level=high",
        "",
      ].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("accepts an audit gate declared only in a git hook", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, "yarn.lock", "# yarn lockfile v1\n");
    await writeRepoFile(
      cwd,
      ".husky/pre-push",
      "#!/bin/sh\nnpm audit --audit-level=moderate\n"
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs with a stated reason when the repository declares no manifest", async () => {
    const cwd = await getTempDir();

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].skip).toBe(true);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs with a stated reason when the manifest declares no dependencies", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].skip).toBe(true);
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("SKIPs with a stated reason when the manifest cannot be parsed", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, PACKAGE_JSON, "{ this is not json ");

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].skip).toBe(true);
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });
});

describe("dependencies/supply-chain dimension identity", () => {
  it("owns the dependencies-supply-chain dimension id from the readiness rubric", () => {
    expect(DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID).toBe(
      "dependencies-supply-chain"
    );
  });
});

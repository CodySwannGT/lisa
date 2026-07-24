/**
 * Workspace-child manifest coverage for the dependencies/supply-chain readiness
 * producer (B5, PRD #1739, #1896).
 *
 * The root manifest can be clean while workspace package manifests carry the
 * actual dependency surface. These regressions pin that B5 walks those child
 * manifests without breaking the normal local-workspace-link exemption.
 * @module tests/unit/cli/doctor-readiness-supply-chain-workspaces
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDependenciesSupplyChainDimension } from "../../../src/cli/doctor-readiness-supply-chain.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  FAIL,
  makeScratchRepo,
  PASS,
  writeRepoFile,
  writeRepoJson,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The manifest every fixture writes. */
const PACKAGE_JSON = "package.json";

/** The workspace child manifest path the tests inspect. */
const WORKSPACE_MANIFEST = "packages/utils/package.json";

/** The monorepo fixture's root package name. */
const MONOREPO_NAME = "scratch-monorepo";

/** The workspace package name used by the fixtures. */
const WORKSPACE_PACKAGE_NAME = "@acme/utils";

/** The workspace glob the monorepo fixtures declare. */
const WORKSPACE_GLOB = "packages/*";

/** The lockfile most fixtures commit. */
const BUN_LOCK = "bun.lock";

/** A minimal lockfile body; presence is what the check reads. */
const LOCKFILE_BODY = '{"lockfileVersion": 1}\n';

/** The update-bot config most fixtures use as their audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** The CI workflow path used by dependency-confidence fixtures. */
const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";

/** Minimal CI install step that proves the committed lockfile is honored. */
const LOCKFILE_INSTALL_WORKFLOW =
  "jobs:\n  test:\n    steps:\n      - run: npm ci\n";

/** A dependabot config that watches the JavaScript dependency tree. */
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
  tempDir ??= await makeScratchRepo("supply-chain-workspaces");
  return tempDir;
}

/**
 * Write the shared clean B5 confidence gates.
 * @param root - Repository root
 */
async function writeConfidenceGates(root: string): Promise<void> {
  await writeRepoFile(root, BUN_LOCK, LOCKFILE_BODY);
  await writeRepoFile(root, DEPENDABOT_PATH, DEPENDABOT_YML);
  await writeRepoFile(root, QUALITY_WORKFLOW_PATH, LOCKFILE_INSTALL_WORKFLOW);
}

/**
 * Write a workspace root whose local child is linked with the `*` workspace idiom.
 * @param root - Repository root
 */
async function writeWorkspaceRoot(root: string): Promise<void> {
  await writeRepoJson(root, PACKAGE_JSON, {
    name: MONOREPO_NAME,
    version: "1.0.0",
    workspaces: [WORKSPACE_GLOB],
    dependencies: { [WORKSPACE_PACKAGE_NAME]: "*" },
  });
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — workspace child manifests", () => {
  it("FAILs when a workspace child manifest declares a floating dependency", async () => {
    const cwd = await getTempDir();
    await writeConfidenceGates(cwd);
    await writeWorkspaceRoot(cwd);
    await writeRepoJson(cwd, WORKSPACE_MANIFEST, {
      name: WORKSPACE_PACKAGE_NAME,
      version: "1.0.0",
      dependencies: { "left-pad": "*" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(WORKSPACE_MANIFEST);
    expect(finding?.evidence).toContain("left-pad");
  });

  it("PASSes and says so when workspace child dependencies are pinned", async () => {
    const cwd = await getTempDir();
    await writeConfidenceGates(cwd);
    await writeWorkspaceRoot(cwd);
    await writeRepoJson(cwd, WORKSPACE_MANIFEST, {
      name: WORKSPACE_PACKAGE_NAME,
      version: "1.0.0",
      dependencies: { "left-pad": "1.3.0" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(asFindings(record.findings)[0].evidence).toContain(
      "1 workspace child manifest"
    );
  });

  it("deduplicates workspace manifests resolved through overlapping globs", async () => {
    const cwd = await getTempDir();
    await writeConfidenceGates(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: MONOREPO_NAME,
      version: "1.0.0",
      workspaces: [WORKSPACE_GLOB, "packages/utils"],
      dependencies: { [WORKSPACE_PACKAGE_NAME]: "*" },
    });
    await writeRepoJson(cwd, WORKSPACE_MANIFEST, {
      name: WORKSPACE_PACKAGE_NAME,
      version: "1.0.0",
      dependencies: { "left-pad": "*" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(
      Array.from(
        finding?.evidence.matchAll(new RegExp(WORKSPACE_MANIFEST, "g")) ?? []
      )
    ).toHaveLength(1);
  });

  it("counts an overlapping workspace manifest once in PASS evidence", async () => {
    const cwd = await getTempDir();
    await writeConfidenceGates(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: MONOREPO_NAME,
      version: "1.0.0",
      workspaces: [WORKSPACE_GLOB, "packages/utils"],
      dependencies: { [WORKSPACE_PACKAGE_NAME]: "*" },
    });
    await writeRepoJson(cwd, WORKSPACE_MANIFEST, {
      name: WORKSPACE_PACKAGE_NAME,
      version: "1.0.0",
      dependencies: { "left-pad": "1.3.0" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    const evidence = asFindings(record.findings)[0].evidence;
    expect(evidence).toContain("2 dependency spec(s)");
    expect(evidence).toContain("1 workspace child manifest");
  });
});

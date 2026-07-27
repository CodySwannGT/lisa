/**
 * Install-time script coverage for the dependencies/supply-chain readiness
 * producer (B5, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-supply-chain-install-scripts
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDependenciesSupplyChainDimension } from "../../../src/cli/doctor-readiness-supply-chain.js";
import {
  asFindings,
  FAIL,
  makeScratchRepo,
  writeRepoFile,
  writeRepoJson,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The root JavaScript manifest. */
const PACKAGE_JSON = "package.json";

/** A minimal lockfile body — only presence is read. */
const LOCKFILE_BODY = '{"lockfileVersion": 1}\n';

/** The update-bot config used as a dependency-audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** The CI workflow path used by dependency-confidence fixtures. */
const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";

/** A manifest whose dependency specs are all pinned or ranged. */
const PINNED_MANIFEST = {
  name: "scratch",
  version: "1.0.0",
  dependencies: { "js-yaml": "^4.1.0" },
};

/** A dependabot config that covers the JavaScript dependency tree. */
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
  tempDir ??= await makeScratchRepo("supply-chain-install-scripts");
  return tempDir;
}

/**
 * Write a repository that is clean before an install-time script surface is
 * added.
 * @param root - Repository root
 */
async function writeCleanRepo(root: string): Promise<void> {
  await writeRepoJson(root, PACKAGE_JSON, PINNED_MANIFEST);
  await writeRepoFile(root, "bun.lock", LOCKFILE_BODY);
  await writeRepoFile(root, DEPENDABOT_PATH, DEPENDABOT_YML);
  await writeRepoFile(
    root,
    QUALITY_WORKFLOW_PATH,
    [
      "name: Quality",
      "jobs:",
      "  test:",
      "    steps:",
      "      - run: bun install --frozen-lockfile",
      "",
    ].join("\n")
  );
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — install-time execution", () => {
  // Test hardened to kill mutant M001 (Risk Factor: Supply-chain / lifecycle-only install authority).
  it("FAILs with B5 when lifecycle scripts are the only package surface", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      scripts: {
        prepare: "node scripts/prepare.js",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("prepare");
    expect(finding?.evidence).toContain("install-time lifecycle");
  });

  // Test hardened to kill mutant M002 (Risk Factor: Supply-chain / package lifecycle execution).
  it("FAILs with B5 when dependency install runs package lifecycle code", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      ...PINNED_MANIFEST,
      scripts: {
        build: "tsc",
        postinstall: "node scripts/bootstrap.js",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("postinstall");
    expect(finding?.evidence).toContain("install-time lifecycle");
    expect(finding?.evidence).not.toContain("`build`");
  });

  // Test hardened to kill mutant M003 (Risk Factor: Supply-chain / trusted dependency execution).
  it("FAILs with B5 when trustedDependencies allow dependency lifecycle scripts", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      ...PINNED_MANIFEST,
      trustedDependencies: ["@sentry/cli", "@ast-grep/cli"],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("trustedDependencies");
    expect(finding?.evidence).toContain("@sentry/cli");
    expect(finding?.evidence).toContain("third-party install-time scripts");
  });

  it("FAILs with B5 when pnpm onlyBuiltDependencies allows dependency build scripts", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      ...PINNED_MANIFEST,
      onlyBuiltDependencies: ["esbuild"],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("trusted dependency build script");
    expect(finding?.evidence).toContain("esbuild");
    expect(finding?.evidence).toContain("third-party install-time scripts");
  });

  it("FAILs with B5 when pnpm nested onlyBuiltDependencies allows dependency build scripts", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      ...PINNED_MANIFEST,
      pnpm: {
        onlyBuiltDependencies: ["@parcel/watcher"],
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("@parcel/watcher");
    expect(finding?.evidence).toContain("trusted dependency build script");
  });
});

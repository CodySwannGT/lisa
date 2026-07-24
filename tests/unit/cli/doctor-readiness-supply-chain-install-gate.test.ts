/**
 * Lockfile install-gate regression coverage for the dependencies/supply-chain
 * readiness producer (B5, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-supply-chain-install-gate
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

const BLOCKER_ID = "B5";
const PACKAGE_JSON = "package.json";
const BUN_LOCK = "bun.lock";
const LOCKFILE_BODY = '{"lockfileVersion": 1}\n';
const DEPENDABOT_PATH = ".github/dependabot.yml";
const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";
const UNENFORCED_INSTALL = "      - run: npm install";
const MISSING_ENFORCEMENT_EVIDENCE = "no CI or hook install";

const PINNED_MANIFEST = {
  name: "scratch",
  version: "1.0.0",
  dependencies: { "js-yaml": "^4.1.0" },
};

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
 * Render a minimal GitHub Actions workflow with caller-supplied step lines.
 * @param steps - Step declarations already indented under `steps:`
 * @returns Workflow YAML text
 */
function qualityWorkflow(...steps: readonly string[]): string {
  return ["jobs:", "  test:", "    steps:", ...steps, ""].join("\n");
}

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("supply-chain-install-gate");
  return tempDir;
}

/**
 * Write the manifest, lockfile, and audit gate shared by install-gate tests.
 * @param root - Repository root
 */
async function writeBaseRepo(root: string): Promise<void> {
  await writeRepoJson(root, PACKAGE_JSON, PINNED_MANIFEST);
  await writeRepoFile(root, BUN_LOCK, LOCKFILE_BODY);
  await writeRepoFile(root, DEPENDABOT_PATH, DEPENDABOT_YML);
}

/**
 * Assert that B5 stands because no executable lockfile install gate was found.
 * @param root - Repository root
 */
async function expectMissingInstallGate(root: string): Promise<void> {
  const record = await assessDependenciesSupplyChainDimension(root);
  const finding = asFindings(record.findings).find(
    candidate => candidate.blocker === BLOCKER_ID
  );

  expect(record.status).toBe(FAIL);
  expect(finding?.evidence).toContain(MISSING_ENFORCEMENT_EVIDENCE);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — lockfile install gates", () => {
  it("FAILs with B5 when lockfile install enforcement is only commented", async () => {
    const cwd = await getTempDir();
    await writeBaseRepo(cwd);
    await writeRepoFile(
      cwd,
      QUALITY_WORKFLOW_PATH,
      qualityWorkflow(UNENFORCED_INSTALL, "      # npm ci")
    );

    await expectMissingInstallGate(cwd);
  });

  it("FAILs with B5 when lockfile install enforcement is only echoed", async () => {
    const cwd = await getTempDir();
    await writeBaseRepo(cwd);
    await writeRepoFile(
      cwd,
      QUALITY_WORKFLOW_PATH,
      qualityWorkflow(UNENFORCED_INSTALL, '      - run: echo "npm ci"')
    );

    await expectMissingInstallGate(cwd);
  });
});

/**
 * Regression coverage for audit exceptions B5 must never silently drop, and for
 * evidence that must state only what it established (PRD #1739, #1896).
 *
 * The invariant B5 protects is that a live audit exception carries the decision
 * that made it acceptable. An exception shape this producer cannot name — no
 * `id` field, a bare string in the list — is therefore the LAST thing that may
 * be skipped: suppressing it turns the one finding the dimension exists for into
 * silence. The second half pins the mirror-image discipline on the clean path:
 * when a bare `*` is exempted only because `workspaces` is declared and no
 * member manifest resolved, the report must say so rather than describe it as a
 * resolved workspace link.
 * @module tests/unit/cli/doctor-readiness-supply-chain-exceptions
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

/** The audit allowlist the exception fixtures write. */
const ALLOWLIST_PATH = "audit.ignore.config.json";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The manifest every fixture writes. */
const PACKAGE_JSON = "package.json";

/** The lockfile most fixtures commit. */
const BUN_LOCK = "bun.lock";

/** A minimal lockfile body — its presence is what the check reads, not its contents. */
const LOCKFILE_BODY = '{"lockfileVersion": 1}\n';

/** The monorepo fixture's root package name. */
const MONOREPO_NAME = "scratch-monorepo";

/** The workspace glob the monorepo fixtures declare. */
const WORKSPACE_GLOB = "packages/*";

/** The update-bot config most fixtures use as their audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** The CI workflow path used by dependency-confidence fixtures. */
const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";

/** Minimal CI install step that proves the committed lockfile is honored. */
const LOCKFILE_INSTALL_WORKFLOW =
  "jobs:\n  test:\n    steps:\n      - run: npm ci\n";

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
  await writeRepoFile(root, BUN_LOCK, LOCKFILE_BODY);
  await writeRepoFile(root, DEPENDABOT_PATH, DEPENDABOT_YML);
  await writeRepoFile(root, QUALITY_WORKFLOW_PATH, LOCKFILE_INSTALL_WORKFLOW);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});
describe("assessDependenciesSupplyChainDimension — undocumented exceptions that must not be dropped", () => {
  it("reports an exclusion entry that carries no advisory id at all", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, ALLOWLIST_PATH, {
      exclusions: [{ package: "left-pad" }],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    // A live exception with no written decision is exactly what B5 guards
    // against; a missing `id` field must not make it disappear.
    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("left-pad");
  });

  it("reports a bare-string exclusion, which has nowhere to record a decision", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, ALLOWLIST_PATH, {
      exclusions: ["GHSA-5555-4444-3333"],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("GHSA-5555-4444-3333");
  });

  it("locates an anonymous exclusion by its position in the list", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, ALLOWLIST_PATH, {
      exclusions: [
        { id: "GHSA-1111-aaaa-bbbb", reason: "dev only" },
        { severity: "low" },
      ],
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("entry #2");
  });
});

describe("assessDependenciesSupplyChainDimension — evidence states what it actually established", () => {
  it("names the bare-`*` fallback instead of claiming zero exemptions", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, BUN_LOCK, LOCKFILE_BODY);
    await writeRepoFile(cwd, DEPENDABOT_PATH, DEPENDABOT_YML);
    await writeRepoFile(cwd, QUALITY_WORKFLOW_PATH, LOCKFILE_INSTALL_WORKFLOW);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: MONOREPO_NAME,
      version: "1.0.0",
      workspaces: [WORKSPACE_GLOB],
      dependencies: { "@acme/unresolvable": "*" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
    const serialized = JSON.stringify(record.findings);
    // The exemption was a fallback, not a resolved link: saying "0 locally
    // linked package name(s) were exempted" describes the opposite of what
    // happened, and the PASS evidence must not claim every spec names a version.
    expect(serialized).not.toContain("0 locally linked");
    expect(serialized).toContain("no member manifests resolved");
  });
});

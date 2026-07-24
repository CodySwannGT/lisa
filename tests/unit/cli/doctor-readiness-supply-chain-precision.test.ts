/**
 * False-positive regression coverage for the dependencies/supply-chain readiness
 * producer (B5, PRD #1739, #1896).
 *
 * B5 stands a ship blocker, and a standing blocker flips the whole repository to
 * `NOT_READY` — so every rule in the producer's grammar is one repository-shape
 * away from calling a correctly configured project broken. This suite pins the
 * shapes that must NEVER stand B5 (the workspace-link idiom, audit-ci's own
 * `.nsprc` document) and the two false-GREENS that would be worse (a secret
 * scanner counted as a dependency audit, an update bot that never watches the
 * JavaScript tree).
 * @module tests/unit/cli/doctor-readiness-supply-chain-precision
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
describe("assessDependenciesSupplyChainDimension — configurations that must NOT stand B5", () => {
  it("never faults a workspace member linked with the `*` workspace idiom", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, BUN_LOCK, LOCKFILE_BODY);
    await writeRepoFile(cwd, DEPENDABOT_PATH, DEPENDABOT_YML);
    await writeRepoFile(cwd, QUALITY_WORKFLOW_PATH, LOCKFILE_INSTALL_WORKFLOW);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: MONOREPO_NAME,
      version: "1.0.0",
      workspaces: [WORKSPACE_GLOB],
      dependencies: { "@acme/utils": "*", "js-yaml": "^4.1.0" },
    });
    await writeRepoJson(cwd, "packages/utils/package.json", {
      name: "@acme/utils",
      version: "1.0.0",
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    // `"*"` on a workspace member resolves to the local package, not to whatever
    // the registry publishes — it is the idiom, not a floating install.
    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("never faults the `workspace:` protocol", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, BUN_LOCK, LOCKFILE_BODY);
    await writeRepoFile(cwd, DEPENDABOT_PATH, DEPENDABOT_YML);
    await writeRepoFile(cwd, QUALITY_WORKFLOW_PATH, LOCKFILE_INSTALL_WORKFLOW);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: MONOREPO_NAME,
      version: "1.0.0",
      workspaces: [WORKSPACE_GLOB],
      dependencies: { "@acme/core": "workspace:*" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("never fabricates exceptions out of an audit-ci `.nsprc` document", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, ".nsprc", {
      $schema:
        "https://github.com/IBM/audit-ci/raw/main/docs/nsprc.schema.json",
      "GHSA-aaaa-bbbb-cccc": {
        active: true,
        notes: "devDependency only, no untrusted input",
      },
      "GHSA-dddd-eeee-ffff": { active: false },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    // `$schema` is not an advisory, and an inactive entry is not applied — so
    // neither is an undocumented exception anybody has to justify.
    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).not.toContain("$schema");
    expect(JSON.stringify(record.findings)).not.toContain(
      "GHSA-dddd-eeee-ffff"
    );
  });

  it("still faults an active `.nsprc` exception with no written decision", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, ".nsprc", {
      $schema:
        "https://github.com/IBM/audit-ci/raw/main/docs/nsprc.schema.json",
      "GHSA-9999-8888-7777": { active: true },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("GHSA-9999-8888-7777");
  });

  it("does not count a secret-scanning `Security Scan` job as a dependency audit", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, BUN_LOCK, LOCKFILE_BODY);
    await writeRepoFile(
      cwd,
      ".github/workflows/secrets.yml",
      [
        "name: Security",
        "jobs:",
        "  scan:",
        "    name: Security Scan",
        "    steps:",
        "      - uses: gitleaks/gitleaks-action@v2",
        "",
      ].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    // Secret scanning proves nothing about the dependency tree, so counting it
    // would be a false green — the worst direction for a confidence model.
    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("audit");
  });

  it("does not count a dependabot config that never covers the JavaScript tree", async () => {
    const cwd = await getTempDir();
    await writeRepoJson(cwd, PACKAGE_JSON, PINNED_MANIFEST);
    await writeRepoFile(cwd, BUN_LOCK, LOCKFILE_BODY);
    await writeRepoFile(
      cwd,
      DEPENDABOT_PATH,
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: github-actions",
        '    directory: "/"',
        "    schedule:",
        "      interval: weekly",
        "",
      ].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("audit");
  });

  it("FAILs with B5 on a spec aliased to a floating registry version", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: {
        aliased: "npm:left-pad@latest",
        pinned: "npm:right-pad@1.2.3",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("aliased");
    expect(finding?.evidence).not.toContain("pinned");
  });

  it("FAILs with B5 on a git spec with no immutable ref, but not on a pinned one", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: {
        drifting: "github:acme/widget",
        anchored: "github:acme/gadget#v1.2.3",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("drifting");
    expect(finding?.evidence).not.toContain("anchored");
  });

  it("caps the evidence lines it carries and says how many it dropped", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: Object.fromEntries(
        Array.from({ length: 20 }, (_unused, index) => [
          `floating-${index}`,
          "*",
        ])
      ),
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("further finding(s) of the same kind");
  });

  it("never faults an archive URL that names one immutable artifact", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: {
        tarball: "https://registry.internal/widget-1.2.3.tgz",
        zipped: "https://registry.internal/gadget-4.5.6.zip",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    // An archive URL names one built artifact; it cannot resolve to something
    // newer tomorrow, so demanding a `#ref` of it invents a violation.
    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("still faults a git URL that resolves to whatever the default branch holds", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: {
        headtracking: "git+https://example.com/acme/widget.git",
        refpinned: "git+https://example.com/acme/gadget.git#v2.0.0",
      },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("headtracking");
    expect(finding?.evidence).not.toContain("refpinned");
  });

  it("never treats a registry package merely named like a git host as a source fetch", async () => {
    const cwd = await getTempDir();
    await writeCleanRepo(cwd);
    await writeRepoJson(cwd, PACKAGE_JSON, {
      name: "scratch",
      version: "1.0.0",
      dependencies: { "bitbucket-client": "^2.1.0" },
    });

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });
});

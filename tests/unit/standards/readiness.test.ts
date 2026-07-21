import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPackageVersion } from "../../../src/cli/version.js";
import { readConfinedDetectedStacks } from "../../../src/cli/ui-detected-stacks.js";
import { readConfinedMergedConfig } from "../../../src/cli/ui-confined-project-read.js";
import { STANDARDS_PROOF_ARTIFACT } from "../../../src/standards/contract.js";
import { readStandardsGitState } from "../../../src/standards/git-state.js";
import { standardsProofFinding } from "../../../src/standards/readiness.js";
import { resolveStandardsCheckPlan } from "../../../src/standards/registry.js";
import { writeStandardsProof } from "../../../src/standards/storage.js";

let root: string | undefined;
const GIT = "/usr/bin/git";
const LOCAL_CONFIG = ".lisa.config.local.json";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Run fixed-system Git inside the current fixture.
 * @param args - Fixed Git arguments
 * @returns Trimmed stdout
 */
function git(args: readonly string[]): string {
  return execFileSync(GIT, args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * Create one two-commit supported TypeScript repository.
 * @returns Temporary repository root
 */
async function createRepository(): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), "lisa-standards-readiness-"));
  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  git(["remote", "add", "origin", "https://github.com/acme/project.git"]);
  await mkdir(path.join(root, "scripts"));
  await writeFile(
    path.join(root, ".gitignore"),
    `.lisa/standards/latest.json\n${LOCAL_CONFIG}\n`
  );
  await writeFile(
    path.join(root, LOCAL_CONFIG),
    JSON.stringify({ harness: "claude", tracker: "jira" })
  );
  await writeFile(path.join(root, "tsconfig.json"), "{}\n");
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(
    path.join(root, "scripts/check-threshold-ratchet.mjs"),
    "process.exit(0);\n"
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: Object.fromEntries(
        [
          "lint",
          "lint:slow",
          "typecheck",
          "build",
          "test",
          "test:unit",
          "test:cov",
          "test:integration",
          "format:check",
          "knip:check",
          "sg:scan",
          "test:mutation",
        ].map(name => [name, 'node -e "process.exit(0)"'])
      ),
    })
  );
  git(["add", "."]);
  git(["commit", "-qm", "initial"]);
  await writeFile(path.join(root, "README.md"), "second commit\n");
  git(["add", "README.md"]);
  git(["commit", "-qm", "second"]);
  return root;
}

/**
 * Write a valid proof for the fixture's current bound inputs.
 * @param repo - Fixture repository root
 */
async function writeCurrentProof(repo: string): Promise<void> {
  const gitState = await readStandardsGitState(repo);
  const [projectTypes, config] = await Promise.all([
    readConfinedDetectedStacks(repo),
    readConfinedMergedConfig(repo),
  ]);
  const plan = await resolveStandardsCheckPlan(repo, projectTypes, config);
  await writeStandardsProof(
    repo,
    {
      schemaVersion: 1,
      artifact: STANDARDS_PROOF_ARTIFACT,
      lisaVersion: getPackageVersion(),
      registryDigest: plan.registryDigest,
      configDigest: plan.configDigest,
      repository: {
        identity: gitState.identity,
        head: gitState.head,
        tree: gitState.tree,
      },
      projectTypes,
      applicableChecks: plan.checks.map(check => check.id),
      capturedAt: "2026-07-21T14:00:02.000Z",
      results: plan.checks.map(check => ({
        check: check.id,
        category: check.category,
        status: "pass",
        startedAt: "2026-07-21T14:00:00.000Z",
        completedAt: "2026-07-21T14:00:01.000Z",
      })),
    },
    new Date("2026-07-21T15:00:00.000Z")
  );
}

describe("standards proof readiness", () => {
  it("transitions missing -> pass -> dirty -> stale HEAD without executing checks", async () => {
    const repo = await createRepository();
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("missing"),
    });
    await writeCurrentProof(repo);
    expect(await standardsProofFinding(repo)).toMatchObject({ status: "pass" });

    await writeFile(path.join(repo, "untracked-input.txt"), "drift\n");
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("worktree state changed"),
    });
    await rm(path.join(repo, "untracked-input.txt"));
    await writeFile(path.join(repo, "README.md"), "new head\n");
    git(["add", "README.md"]);
    git(["commit", "-qm", "new head"]);
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("HEAD changed"),
    });
  });

  it("fails closed on malformed status and schema tampering", async () => {
    const repo = await createRepository();
    await writeCurrentProof(repo);
    const proofPath = path.join(repo, ".lisa/standards/latest.json");
    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    await writeFile(proofPath, '{"UNTRUSTED_SECRET_VALUE"');
    const malformed = await standardsProofFinding(repo);
    expect(malformed).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("malformed standards proof"),
    });
    expect(malformed.reason).not.toContain("UNTRUSTED_SECRET_VALUE");

    proof.results[0].status = "fail";
    await writeFile(proofPath, JSON.stringify(proof));
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("unreadable"),
    });

    proof.results[0].status = "pass";
    proof.schemaVersion = 2;
    await writeFile(proofPath, JSON.stringify(proof));
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("unsupported standards proof schema"),
    });
  });

  it("ignores harness/tracker drift but invalidates quality-policy drift", async () => {
    const repo = await createRepository();
    await writeCurrentProof(repo);

    await writeFile(
      path.join(repo, LOCAL_CONFIG),
      JSON.stringify({ harness: "codex", tracker: "github" })
    );
    expect(await standardsProofFinding(repo)).toMatchObject({ status: "pass" });

    await writeFile(
      path.join(repo, LOCAL_CONFIG),
      JSON.stringify({
        harness: "codex",
        tracker: "github",
        quality: { mutation: { gate: { enabled: true } } },
      })
    );
    expect(await standardsProofFinding(repo)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("Lisa configuration changed"),
    });
  });

  it("sanitizes malformed ignored local config without leaking its value", async () => {
    const repo = await createRepository();
    await writeCurrentProof(repo);
    await writeFile(
      path.join(repo, LOCAL_CONFIG),
      '{"quality":"UNTRUSTED_SECRET_VALUE"'
    );

    const finding = await standardsProofFinding(repo);
    expect(finding).toMatchObject({
      status: "warn",
      reason: expect.stringContaining(
        "local Lisa configuration is malformed or unreadable"
      ),
    });
    expect(finding.reason).not.toContain("UNTRUSTED_SECRET_VALUE");
  });

  it("sanitizes Git identity observation failures", async () => {
    const repo = await createRepository();
    await writeCurrentProof(repo);
    git(["remote", "remove", "origin"]);

    const finding = await standardsProofFinding(repo);
    expect(finding).toMatchObject({
      status: "warn",
      reason: expect.stringContaining(
        "Git repository identity and state could not be observed"
      ),
    });
    expect(finding.reason).not.toContain("origin is missing");
  });
});

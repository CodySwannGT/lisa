import { spawnSync } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStandardsProofCli } from "../../src/cli/standards-proof-cmd.js";
import { runUi } from "../../src/cli/ui-cmd.js";
import { standardsProofFinding } from "../../src/standards/readiness.js";
import { readStandardsProof } from "../../src/standards/storage.js";
import { readStandardsGitState } from "../../src/standards/git-state.js";
import type { HealthResult } from "../../src/health/contract.js";
import {
  PROOF_PATH,
  TYPESCRIPT_CHECKS,
  commitAll,
  createTypescriptRepository,
  git,
  proofResidue,
  snapshotProof,
} from "./standards-proof-fixture.js";

let root: string | undefined;
let server: Server | undefined;
const PROOF_UNAVAILABLE = "proof unavailable";
const TEST_MODE_PATH = "test-mode.txt";
const STANDARDS_DIRECTORY = ".lisa/standards";
const GATE_SCRIPT = "scripts/gate.mjs";

afterEach(async () => {
  vi.restoreAllMocks();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise(resolve => server?.close(resolve));
    server = undefined;
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Return deterministic Health evidence that unlocks proof-backed standards.
 * @returns Passing managed-surface Health result
 */
function standardsHealth(): HealthResult {
  const checks = [
    "templates.managed",
    "package.conformance",
    "hooks.managed",
    "config.sync",
    "instructions.canonical",
    "ci.workflows",
  ];
  return {
    schemaVersion: 1,
    runId: "standards-integration",
    mode: "deterministic",
    startedAt: "2026-07-21T13:00:00.000Z",
    completedAt: "2026-07-21T13:00:01.000Z",
    findings: checks.map(check => ({
      check,
      layer: "deterministic" as const,
      status: "pass" as const,
      reason: "Observed fixture evidence.",
    })),
    summary: {
      verdict: "in band",
      counts: { pass: checks.length, warn: 0, fail: 0 },
    },
  };
}

/**
 * Return the loopback port of the active UI fixture.
 * @returns Bound loopback port
 */
function serverPort(): number {
  const address = server?.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

describe("real TypeScript standards-proof journey", () => {
  it("captures, serves, invalidates, preserves, and refreshes exact proof", async () => {
    root = await createTypescriptRepository();
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    expect(await standardsProofFinding(root)).toMatchObject({ status: "warn" });

    await runStandardsProofCli(root);
    const gitState = await readStandardsGitState(root);
    const stored = await readStandardsProof(root);
    expect(stored.status).toBe("available");
    if (stored.status !== "available") throw new Error(PROOF_UNAVAILABLE);
    expect(stored.proof.repository).toEqual({
      identity: "github.com/acme/project",
      head: gitState.head,
      tree: gitState.tree,
    });
    expect(stored.proof.applicableChecks).toEqual(TYPESCRIPT_CHECKS);
    expect(stored.proof.results.map(result => result.check)).toEqual(
      TYPESCRIPT_CHECKS
    );
    expect(JSON.stringify(stored.proof)).not.toContain("Tests  1 passed");
    expect(await standardsProofFinding(root)).toMatchObject({ status: "pass" });
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("standards-proof: PASS")
    );

    await verifyHarnessParity(
      root,
      stored.proof.registryDigest,
      stored.proof.configDigest
    );
    await verifyUiCanary(root);

    const beforeFailure = await snapshotProof(root);
    await writeFile(path.join(root, "lint-target.txt"), "VIOLATION\n");
    const directLint = spawnSync(process.execPath, [GATE_SCRIPT, "lint"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(directLint.status).not.toBe(0);
    expect(directLint.stderr).toContain("lint violation detected");
    expect(await standardsProofFinding(root)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("worktree state changed"),
    });
    await expect(runStandardsProofCli(root)).rejects.toThrow("clean");
    expect(await snapshotProof(root)).toEqual(beforeFailure);
    expect(await proofResidue(root)).toEqual([]);

    await writeFile(path.join(root, "lint-target.txt"), "clean again\n");
    commitAll(root, "fix lint violation");
    expect(await standardsProofFinding(root)).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("HEAD changed"),
    });
    await runStandardsProofCli(root);
    const refreshed = await readStandardsProof(root);
    expect(refreshed.status).toBe("available");
    if (refreshed.status !== "available") throw new Error(PROOF_UNAVAILABLE);
    expect(refreshed.proof.repository.head).toBe(
      git(root, ["rev-parse", "HEAD"])
    );
    expect(refreshed.proof.repository.head).not.toBe(
      stored.proof.repository.head
    );
    expect(await standardsProofFinding(root)).toMatchObject({ status: "pass" });
    expect(await proofResidue(root)).toEqual([]);
  }, 60_000);

  it("never creates or overwrites proof across real CLI failure classes", async () => {
    root = await createTypescriptRepository();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runStandardsProofCli(root);
    const prior = await snapshotProof(root);

    for (const [mode, message] of [
      ["nonzero", "Standards check failed: typescript.lint"],
      ["zero", "did not prove any executed tests"],
      ["skipped", "did not prove any executed tests"],
    ] as const) {
      await writeFile(path.join(root, TEST_MODE_PATH), `${mode}\n`);
      commitAll(root, `fixture ${mode}`);
      await expect(runStandardsProofCli(root)).rejects.toThrow(message);
      expect(await snapshotProof(root)).toEqual(prior);
      expect(await proofResidue(root)).toEqual([]);
    }

    const packagePath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));
    await writeFile(path.join(root, TEST_MODE_PATH), "pass\n");
    delete manifest.scripts.typecheck;
    await writeFile(packagePath, JSON.stringify(manifest));
    commitAll(root, "fixture missing script");
    await expect(runStandardsProofCli(root)).rejects.toThrow(
      "Required package script is missing: typecheck"
    );
    expect(await snapshotProof(root)).toEqual(prior);

    manifest.scripts.typecheck = "lisa-definitely-missing-tool";
    await writeFile(packagePath, JSON.stringify(manifest));
    commitAll(root, "fixture missing tool");
    await expect(runStandardsProofCli(root)).rejects.toThrow(
      "Standards check failed: typescript.typecheck"
    );
    expect(await snapshotProof(root)).toEqual(prior);
    expect(await proofResidue(root)).toEqual([]);

    const noCreate = await createTypescriptRepository();
    try {
      await writeFile(path.join(noCreate, TEST_MODE_PATH), "nonzero\n");
      commitAll(noCreate, "first capture fails");
      await expect(runStandardsProofCli(noCreate)).rejects.toThrow(
        "Standards check failed: typescript.lint"
      );
      await expect(stat(path.join(noCreate, PROOF_PATH))).rejects.toMatchObject(
        {
          code: "ENOENT",
        }
      );
    } finally {
      await rm(noCreate, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * Prove harness-only config never forks proof path, plan, or digests.
 * @param projectRoot - Fixture repository root
 * @param registryDigest - Original registry digest
 * @param configDigest - Original scoped config digest
 */
async function verifyHarnessParity(
  projectRoot: string,
  registryDigest: string,
  configDigest: string
): Promise<void> {
  const harnesses = [
    "claude",
    "codex",
    "cursor",
    "opencode",
    "agy",
    "copilot",
    "fleet",
  ] as const;
  for (const harness of harnesses) {
    await writeFile(
      path.join(projectRoot, ".lisa.config.local.json"),
      JSON.stringify({ harness })
    );
    const current = await readStandardsProof(projectRoot);
    expect(current.status).toBe("available");
    if (current.status !== "available") throw new Error(PROOF_UNAVAILABLE);
    expect(current.proof.registryDigest).toBe(registryDigest);
    expect(current.proof.configDigest).toBe(configDigest);
    expect(await standardsProofFinding(projectRoot)).toMatchObject({
      status: "pass",
    });
    expect(
      (await readdir(path.join(projectRoot, STANDARDS_DIRECTORY))).sort(
        (left, right) => left.localeCompare(right)
      )
    ).toEqual(["latest.json"]);
  }
}

/**
 * Prove repeated GET/HEAD reads do not execute scripts or mutate proof/Git.
 * @param projectRoot - Fixture repository root
 */
async function verifyUiCanary(projectRoot: string): Promise<void> {
  const beforeProof = await snapshotProof(projectRoot);
  const beforeGit = await readStandardsGitState(projectRoot);
  const beforeScript = await readFile(
    path.join(projectRoot, GATE_SCRIPT),
    "utf8"
  );
  const beforeMtime = (await stat(path.join(projectRoot, GATE_SCRIPT))).mtimeMs;
  const readHealth = vi.fn(async () => standardsHealth());
  const unknown = {
    state: "unknown" as const,
    reason: "fixture-unavailable",
    message: "Fixture unavailable.",
  };
  server = await runUi(
    projectRoot,
    { port: "0", sync: false },
    {
      probes: [],
      setupReadiness: {
        readHealth,
        readGithub: async () => unknown,
        readDeployPipeline: async () => unknown,
        readAutomations: async () => unknown,
        readExpectedAutomationIds: async () => [],
        readExpectedSecretNames: async () => [],
      },
    }
  );
  const endpoint = `http://127.0.0.1:${serverPort()}/api/setup-readiness`;
  const head = await fetch(endpoint, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(readHealth).not.toHaveBeenCalled();
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(endpoint);
    const body = await response.json();
    expect(
      body.findings.find(
        (finding: { check: string }) => finding.check === "setup.standards"
      )
    ).toMatchObject({ status: "pass" });
  }
  expect(readHealth).toHaveBeenCalledTimes(2);
  expect(await snapshotProof(projectRoot)).toEqual(beforeProof);
  expect(await readStandardsGitState(projectRoot)).toEqual(beforeGit);
  expect(await readFile(path.join(projectRoot, GATE_SCRIPT), "utf8")).toBe(
    beforeScript
  );
  expect((await stat(path.join(projectRoot, GATE_SCRIPT))).mtimeMs).toBe(
    beforeMtime
  );
  expect(path.join(projectRoot, PROOF_PATH)).toContain(PROOF_PATH);
}

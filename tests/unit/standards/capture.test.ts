import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  captureStandardsProof,
  type StandardsCaptureDependencies,
} from "../../../src/standards/capture.js";
import type { StandardsGitState } from "../../../src/standards/git-state.js";
import type { StandardsCheckPlan } from "../../../src/standards/registry.js";

const GIT: StandardsGitState = Object.freeze({
  root: "/fixture",
  identity: "github.com/acme/project",
  head: "a".repeat(40),
  tree: "b".repeat(40),
  clean: true,
});
const TEST_CHECK = "typescript.test";
const PLAN: StandardsCheckPlan = Object.freeze({
  registryDigest: `sha256:${"c".repeat(64)}`,
  configDigest: `sha256:${"d".repeat(64)}`,
  checks: Object.freeze([
    Object.freeze({
      id: TEST_CHECK,
      category: "test" as const,
      argv: ["npm", "run", "test"] as const,
      timeoutMs: 1_000,
      testEvidence: "managed" as const,
    }),
  ]),
});

/**
 * Build deterministic injectable capture boundaries.
 * @returns Complete fake capture dependencies and observable writer
 */
function dependencies(): StandardsCaptureDependencies & {
  writeProof: ReturnType<typeof vi.fn>;
} {
  const moments = [
    "2026-07-21T14:00:00.000Z",
    "2026-07-21T14:00:01.000Z",
    "2026-07-21T14:00:02.000Z",
    "2026-07-21T14:00:03.000Z",
  ];
  const writeProof = vi.fn(async (_root, proof) => ({
    path: "/fixture/.lisa/standards/latest.json",
    proof,
  }));
  return {
    readGitState: vi.fn(async () => GIT),
    requireBaseCommit: vi.fn(async () => "e".repeat(40)),
    readProjectTypes: vi.fn(async () => ["typescript"] as const),
    readConfig: vi.fn(async () => ({})),
    resolvePlan: vi.fn(async () => PLAN),
    runCommand: vi.fn(async () => ({ exitCode: 0, output: "1 test passed" })),
    writeProof,
    lisaVersion: () => "2.278.0",
    now: () => new Date(moments.shift() ?? "2026-07-21T14:00:04.000Z"),
    onProgress: vi.fn(),
  };
}

describe("standards proof capture", () => {
  it("writes only after every check and before/after observation pass", async () => {
    const deps = dependencies();
    const proof = await captureStandardsProof("/fixture", deps);
    expect(proof.repository).toEqual({
      identity: GIT.identity,
      head: GIT.head,
      tree: GIT.tree,
    });
    expect(proof.applicableChecks).toEqual([TEST_CHECK]);
    expect(deps.writeProof).toHaveBeenCalledTimes(1);
    expect(deps.readGitState).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "command failure",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.runCommand = vi.fn(async () => ({
          exitCode: 1,
          output: "secret",
        }));
      },
    ],
    [
      "zero tests",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.runCommand = vi.fn(async () => ({
          exitCode: 0,
          output: "0 tests",
        }));
      },
    ],
    [
      "empty test output",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.runCommand = vi.fn(async () => ({ exitCode: 0, output: "" }));
      },
    ],
    [
      "all tests skipped",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.runCommand = vi.fn(async () => ({
          exitCode: 0,
          output: "Tests  2 skipped (2)",
        }));
      },
    ],
    [
      "dirty before",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.readGitState = vi.fn(async () => ({ ...GIT, clean: false }));
      },
    ],
    [
      "HEAD changed",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.readGitState = vi
          .fn()
          .mockResolvedValueOnce(GIT)
          .mockResolvedValueOnce({ ...GIT, head: "f".repeat(40) });
      },
    ],
    [
      "config changed",
      async (deps: ReturnType<typeof dependencies>) => {
        deps.resolvePlan = vi
          .fn()
          .mockResolvedValueOnce(PLAN)
          .mockResolvedValueOnce({
            ...PLAN,
            configDigest: `sha256:${"e".repeat(64)}`,
          });
      },
    ],
  ])("preserves prior proof bytes on %s", async (_name, arrange) => {
    const deps = dependencies();
    await arrange(deps);
    await expect(captureStandardsProof("/fixture", deps)).rejects.toThrow();
    expect(deps.writeProof).not.toHaveBeenCalled();
  });

  it("leaves an existing artifact byte-for-byte unchanged on a failed check", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "lisa-proof-preserve-"));
    const proofPath = path.join(fixture, ".lisa/standards/latest.json");
    await mkdir(path.dirname(proofPath), { recursive: true });
    await writeFile(proofPath, "prior-valid-proof-bytes\n");
    const deps = dependencies();
    deps.readGitState = vi.fn(async () => ({ ...GIT, root: fixture }));
    deps.runCommand = vi.fn(async () => ({ exitCode: 1, output: "private" }));

    try {
      await expect(captureStandardsProof(fixture, deps)).rejects.toThrow(
        TEST_CHECK
      );
      expect(await readFile(proofPath, "utf8")).toBe(
        "prior-valid-proof-bytes\n"
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("keeps bounded command output out of proof and failure messages", async () => {
    const success = dependencies();
    success.runCommand = vi.fn(async () => ({
      exitCode: 0,
      output: "private-runner-detail\n1 test passed",
    }));
    const proof = await captureStandardsProof("/fixture", success);
    expect(JSON.stringify(proof)).not.toContain("private-runner-detail");

    const failure = dependencies();
    failure.runCommand = vi.fn(async () => ({
      exitCode: 1,
      output: "private-failure-detail",
    }));
    let thrown: unknown;
    try {
      await captureStandardsProof("/fixture", failure);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(TEST_CHECK);
    expect((thrown as Error).message).not.toContain("private-failure-detail");
  });
});

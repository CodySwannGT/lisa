import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_STANDARDS_PROOF_BYTES,
  readStandardsProof,
  writeStandardsProof,
} from "../../../src/standards/storage.js";
import { STANDARDS_PROOF_ARTIFACT } from "../../../src/standards/contract.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

let root: string | undefined;
const CHECK = "typescript.test";
const PROOF_FILE = "latest.json";
const LATER_PROOF_TIME = "2026-07-21T15:00:00.000Z";
const UNSAFE_STORAGE_REASON = "unsafe standards proof storage";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Create one confined proof parent and return its canonical target path.
 * @returns Canonical proof target path
 */
async function createProofDirectory(): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), "lisa-standards-storage-"));
  const directory = path.join(root, ".lisa", "standards");
  await mkdir(directory, { recursive: true });
  return path.join(directory, PROOF_FILE);
}

describe("standards proof hostile storage reads", () => {
  it.each([
    '{"schemaVersion":"UNTRUSTED_SECRET_VALUE"',
    '{"capturedAt":"UNTRUSTED_SECRET_VALUE"',
    '{"applicableChecks":"UNTRUSTED_SECRET_VALUE"',
    '{"results":"UNTRUSTED_SECRET_VALUE"',
    '{"repository.identity":"UNTRUSTED_SECRET_VALUE"',
  ])(
    "classifies malformed keyword injection only as malformed",
    async payload => {
      const target = await createProofDirectory();
      await writeFile(target, payload);

      const result = await readStandardsProof(root!);
      expect(result).toEqual({
        status: "unreadable",
        reason: "malformed standards proof",
      });
      if (result.status === "unreadable") {
        expect(result.reason).not.toContain("UNTRUSTED_SECRET_VALUE");
      }
    }
  );

  it("classifies an incomplete top-level record only as malformed", async () => {
    const target = await createProofDirectory();
    await writeFile(target, "{}\n");

    await expect(readStandardsProof(root!)).resolves.toEqual({
      status: "unreadable",
      reason: "malformed standards proof",
    });
  });

  it("classifies an incomplete result record as invalid results", async () => {
    const target = await createProofDirectory();
    const candidate = proofCandidate(
      "a".repeat(40),
      "2026-07-21T14:00:02.000Z"
    );
    await writeFile(
      target,
      JSON.stringify({
        ...candidate,
        results: [{ check: CHECK }],
      })
    );

    await expect(
      readStandardsProof(root!, new Date(LATER_PROOF_TIME))
    ).resolves.toEqual({
      status: "unreadable",
      reason: "invalid standards proof check results",
    });
  });

  it("rejects a symlink without following it", async () => {
    const target = await createProofDirectory();
    const outside = path.join(root!, "outside.json");
    await writeFile(outside, "{}\n");
    await symlink(outside, target);

    await expect(readStandardsProof(root!)).resolves.toMatchObject({
      status: "unreadable",
      reason: UNSAFE_STORAGE_REASON,
    });
  });

  it("rejects a FIFO without blocking", async () => {
    const target = await createProofDirectory();
    boundedExecFileSync({
      label: "mkfifo the standards proof target",
      command: "/usr/bin/mkfifo",
      args: [target],
    });

    const outcome = await Promise.race([
      readStandardsProof(root!),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("FIFO read blocked")), 1_000);
      }),
    ]);
    expect(outcome).toMatchObject({
      status: "unreadable",
      reason: UNSAFE_STORAGE_REASON,
    });
  });

  it("bounds descriptor reads when a regular file grows after open", async () => {
    const target = await createProofDirectory();
    await writeFile(target, "{}\n");

    const outcome = await readStandardsProof(root!, new Date(), {
      afterOpen: async openedTarget => {
        await appendFile(
          openedTarget,
          Buffer.alloc(MAX_STANDARDS_PROOF_BYTES + 1)
        );
      },
    });

    expect(outcome).toMatchObject({
      status: "unreadable",
      reason: "standards proof exceeds size limit",
    });
  });

  it("publishes only complete old-or-new bytes and cleans transaction residue", async () => {
    const target = await createProofDirectory();
    const oldProof = proofCandidate("a".repeat(40), "2026-07-21T14:00:00.000Z");
    const newProof = proofCandidate("b".repeat(40), LATER_PROOF_TIME);
    const observedAt = new Date("2026-07-21T16:00:00.000Z");
    await writeStandardsProof(root!, oldProof, observedAt);
    const oldBytes = await readFile(target, "utf8");
    expect(await readStandardsProof(root!, observedAt)).toEqual({
      status: "available",
      proof: oldProof,
    });

    const replacement = writeStandardsProof(root!, newProof, observedAt);
    const observations = await Promise.all(
      Array.from({ length: 20 }, async () => await readFile(target, "utf8"))
    );
    await replacement;
    const newBytes = await readFile(target, "utf8");
    expect(newBytes).not.toBe(oldBytes);
    // Atomic publication guarantees whole payloads; strict reader identity is
    // checked independently below and may reject a replacement during a read.
    expect(
      observations.every(bytes => bytes === oldBytes || bytes === newBytes)
    ).toBe(true);
    expect(await readStandardsProof(root!, observedAt)).toEqual({
      status: "available",
      proof: newProof,
    });

    await expect(
      writeStandardsProof(root!, { ...newProof, schemaVersion: 2 }, observedAt)
    ).rejects.toThrow("schemaVersion");
    expect(await readFile(target, "utf8")).toBe(newBytes);
    expect(
      (await readdir(path.join(root!, ".lisa/standards"))).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual([PROOF_FILE]);
  });

  it("fails closed when a real atomic replacement changes the path after open", async () => {
    const target = await createProofDirectory();
    const oldProof = proofCandidate("a".repeat(40), "2026-07-21T14:00:00.000Z");
    const newProof = proofCandidate("b".repeat(40), LATER_PROOF_TIME);
    const observedAt = new Date("2026-07-21T16:00:00.000Z");
    await writeStandardsProof(root!, oldProof, observedAt);
    expect(await readStandardsProof(root!, observedAt)).toEqual({
      status: "available",
      proof: oldProof,
    });

    const overlap = await readStandardsProof(root!, observedAt, {
      afterOpen: async openedTarget => {
        expect(openedTarget).toBe(target);
        await writeStandardsProof(root!, newProof, observedAt);
      },
    });

    expect(overlap).toEqual({
      status: "unreadable",
      reason: UNSAFE_STORAGE_REASON,
    });
    expect(await readStandardsProof(root!, observedAt)).toEqual({
      status: "available",
      proof: newProof,
    });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(newProof);
    expect(await readdir(path.dirname(target))).toEqual([PROOF_FILE]);
  });
});

/**
 * Build one strict single-check proof for atomic replacement tests.
 * @param head - Repository HEAD bound into the candidate
 * @param capturedAt - Canonical proof capture timestamp
 * @returns Strict proof candidate
 */
function proofCandidate(head: string, capturedAt: string) {
  return {
    schemaVersion: 1,
    artifact: STANDARDS_PROOF_ARTIFACT,
    lisaVersion: "2.278.0",
    registryDigest: `sha256:${"c".repeat(64)}`,
    configDigest: `sha256:${"d".repeat(64)}`,
    repository: {
      identity: "github.com/acme/project",
      head,
      tree: "e".repeat(40),
    },
    projectTypes: ["typescript"],
    applicableChecks: [CHECK],
    capturedAt,
    results: [
      {
        check: CHECK,
        category: "test",
        status: "pass",
        startedAt: "2026-07-21T13:00:00.000Z",
        completedAt: "2026-07-21T13:00:01.000Z",
      },
    ],
  } as const;
}

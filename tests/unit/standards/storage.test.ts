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
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_STANDARDS_PROOF_BYTES,
  readStandardsProof,
  writeStandardsProof,
} from "../../../src/standards/storage.js";
import { STANDARDS_PROOF_ARTIFACT } from "../../../src/standards/contract.js";

let root: string | undefined;
const CHECK = "typescript.test";

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
  return path.join(directory, "latest.json");
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
      readStandardsProof(root!, new Date("2026-07-21T15:00:00.000Z"))
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
      reason: "unsafe standards proof storage",
    });
  });

  it("rejects a FIFO without blocking", async () => {
    const target = await createProofDirectory();
    execFileSync("/usr/bin/mkfifo", [target]);

    const outcome = await Promise.race([
      readStandardsProof(root!),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("FIFO read blocked")), 1_000);
      }),
    ]);
    expect(outcome).toMatchObject({
      status: "unreadable",
      reason: "unsafe standards proof storage",
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

  it("exposes only complete old-or-new replacements and cleans transaction residue", async () => {
    await createProofDirectory();
    const oldProof = proofCandidate("a".repeat(40), "2026-07-21T14:00:00.000Z");
    const newProof = proofCandidate("b".repeat(40), "2026-07-21T15:00:00.000Z");
    const observedAt = new Date("2026-07-21T16:00:00.000Z");
    await writeStandardsProof(root!, oldProof, observedAt);
    const oldBytes = await readFile(
      path.join(root!, ".lisa/standards/latest.json"),
      "utf8"
    );

    const replacement = writeStandardsProof(root!, newProof, observedAt);
    const observations = await Promise.all(
      Array.from(
        { length: 20 },
        async () => await readStandardsProof(root!, observedAt)
      )
    );
    await replacement;
    expect(
      observations.every(
        result =>
          result.status === "available" &&
          [oldProof.repository.head, newProof.repository.head].includes(
            result.proof.repository.head
          )
      )
    ).toBe(true);
    expect(await readStandardsProof(root!, observedAt)).toMatchObject({
      status: "available",
      proof: { repository: { head: newProof.repository.head } },
    });

    await expect(
      writeStandardsProof(root!, { ...newProof, schemaVersion: 2 }, observedAt)
    ).rejects.toThrow("schemaVersion");
    expect(
      await readFile(path.join(root!, ".lisa/standards/latest.json"), "utf8")
    ).not.toBe(oldBytes);
    expect(
      (await readdir(path.join(root!, ".lisa/standards"))).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual(["latest.json"]);
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

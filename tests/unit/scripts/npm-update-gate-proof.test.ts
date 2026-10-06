/** Private proof transport fixtures grant no attestation or provider authority. */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readGateProof,
  writeGateProof,
  validateGateProof,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-proof.mjs";
import { writeJson } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { trackerContract } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  environment,
  leafRoles,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";
import { runGateStreams } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-hooks.mjs";

const PROOF_PREFIX = "lisa-gate-proof-";
const BUNDLE_FILE = "bundle.json";
const RECOVERY_FILE = "recovery.json";

describe("canonical updater configuration", () => {
  it("exposes the existing tracker defaults and preserves full verification", () => {
    const config = {
      tracker: "github",
      github: { org: "acme", repo: "widgets" },
      workItem: { verify: "full" },
    };
    const contract = trackerContract(config);
    expect(contract.repository).toBe("acme/widgets");
    expect(contract.verify).toBe("full");
    expect(contract.deployBranches?.get("main")).toBe("production");
    expect(contract.lifecycle.claimed).toBe("status:in-progress");
    expect(environment(config)).toBe("production");
    expect(leafRoles(config, "acme/widgets").terminals).toEqual(
      contract.lifecycle.done.map(([, role]) => role)
    );
  });
});

describe("ordinary gate stream execution", () => {
  it("executes the full audit before the actual identical-destination no-op", async () => {
    const branch = `lisa/npm-${"a".repeat(64)}`;
    const commit = "b".repeat(40);
    const parent = "c".repeat(40);
    const inputs: string[] = [];
    const receipt = await runGateStreams(
      branch,
      commit,
      parent,
      commit,
      async (refs: string) => {
        inputs.push(refs);
        return {
          code: 0,
          stdout: Buffer.from("original"),
          stderr: Buffer.alloc(0),
        };
      }
    );
    expect(inputs).toEqual([
      `refs/heads/${branch} ${commit} refs/heads/${branch} ${parent}\n`,
      `refs/heads/${branch} ${commit} refs/heads/${branch} ${commit}\n`,
    ]);
    expect(receipt).toHaveProperty("audit.range", [commit]);
    expect(receipt).toHaveProperty("destination.range", []);
  });
  it("does not execute the destination after a failed full-audit result", async () => {
    let calls = 0;
    await expect(
      runGateStreams(
        `lisa/npm-${"a".repeat(64)}`,
        "b".repeat(40),
        "c".repeat(40),
        null,
        async () => {
          calls++;
          return {
            code: 1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from("failed"),
          };
        }
      )
    ).rejects.toThrow(/audit/);
    expect(calls).toBe(1);
  });
});

describe("complete gate proof transport", () => {
  it("copies origin and separate recovery bytes exactly without treating them as verified", () => {
    const root = mkdtempSync(join(tmpdir(), PROOF_PREFIX));
    try {
      writeJson(join(root, BUNDLE_FILE), { origin: true });
      writeJson(join(root, RECOVERY_FILE), { recovery: true });
      writeJson(join(root, "recovery-bundle.json"), { attestation: true });
      const inputs = readGateProof(root);
      const destination = join(root, "installed");
      writeGateProof(destination, { version: 1 }, inputs);
      for (const name of [BUNDLE_FILE, RECOVERY_FILE, "recovery-bundle.json"])
        expect(readFileSync(join(destination, name))).toEqual(
          readFileSync(join(root, name))
        );
      expect(() =>
        writeGateProof(destination, { version: 1 }, inputs)
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("refuses partial recovery before creating any gate proof directory", () => {
    const root = mkdtempSync(join(tmpdir(), PROOF_PREFIX));
    try {
      writeJson(join(root, BUNDLE_FILE), { origin: true });
      writeJson(join(root, RECOVERY_FILE), { recovery: true });
      expect(() => readGateProof(root)).toThrow(/partial/);
      expect(() =>
        writeGateProof(
          join(root, "installed"),
          {},
          {
            bundle: Buffer.from("origin"),
            recovery: Buffer.from("recovery"),
            recoveryBundle: undefined,
          }
        )
      ).toThrow(/partial/);
      expect(existsSync(join(root, "installed"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("refuses empty, oversized or non-byte proof inputs", () => {
    for (const bundle of [Buffer.alloc(0), Buffer.alloc(1_048_577), "{}"])
      expect(() => validateGateProof({ bundle })).toThrow();
    expect(() =>
      validateGateProof({
        bundle: Buffer.from("origin"),
        recovery: Buffer.alloc(65_537),
        recoveryBundle: Buffer.from("proof"),
      })
    ).toThrow();
  });

  it("refuses a dangling recovery alias rather than treating it as absent", () => {
    const root = mkdtempSync(join(tmpdir(), PROOF_PREFIX));
    try {
      writeJson(join(root, BUNDLE_FILE), { origin: true });
      symlinkSync(join(root, "missing"), join(root, RECOVERY_FILE));
      expect(() => readGateProof(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

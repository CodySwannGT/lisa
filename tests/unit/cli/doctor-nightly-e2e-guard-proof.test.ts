/**
 * @file doctor-nightly-e2e-guard-proof.test.ts
 * @description Static provenance, semantic-version, and no-follow proof contract
 * @module tests/unit/cli/doctor-nightly-e2e-guard-proof.test
 */
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeNightlyE2eGuardTarget } from "../../../src/cli/doctor-nightly-e2e-guard.js";

const TARGET = "scripts/check-nightly-e2e-health.mjs";
const TARGET_NAME = "check-nightly-e2e-health.mjs";
const REAL_SCRIPTS = "real-scripts";
let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-proof-"));
  await mkdir(path.join(projectRoot, "scripts"));
});

afterEach(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

const source = (version: string): string =>
  `export const NIGHTLY_E2E_CONTRACT_VERSION = ${JSON.stringify(version)};\n`;
const ledger = (bytes: string) => ({
  [TARGET]: [createHash("sha256").update(bytes).digest("hex")],
});

/**
 * Write and prove one hash-attested fixture.
 * @param bytes - Exact source bytes to attest
 * @returns Static proof result for the fixture
 */
async function prove(bytes: string) {
  await writeFile(path.join(projectRoot, TARGET), bytes);
  return await probeNightlyE2eGuardTarget(projectRoot, TARGET, {
    ledger: ledger(bytes),
  });
}

describe("static nightly guard contract version proof", () => {
  it.each(["1.0.0", "1.7.0", "1.999.42"])(
    "accepts compatible strict ASCII semver %s",
    async version => {
      await expect(prove(source(version))).resolves.toEqual({
        state: "compatible",
        version,
      });
    }
  );

  it.each(["0.9.0", "2.0.0"])(
    "rejects incompatible major %s",
    async version => {
      const result = await prove(source(version));
      expect(result).toMatchObject({ state: "failure", version });
      expect(result.state === "failure" ? result.reason : "").toMatch(
        /major 1/u
      );
    }
  );

  it.each([
    ["empty", ""],
    ["v-prefix", "v1.7.0"],
    ["prerelease", "1.7.0-beta.1"],
    ["extra text", "version=1.7.0"],
    ["leading zero", "1.07.0"],
    ["carriage return", "1.7.0\r"],
  ])("rejects malformed %s contract", async (_label, version) => {
    const result = await prove(source(version));
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /exact ASCII semantic version/u
    );
  });

  it("rejects duplicate contract declarations", async () => {
    const duplicate = `${source("1.7.0")}${source("1.7.0")}`;
    const result = await prove(duplicate);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /one exact/u
    );
  });

  it("rejects a contract declaration larger than the 4 KiB capture bound", async () => {
    const oversized = source(`1.${"7".repeat(4096)}.0`);
    const result = await prove(oversized);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/4 KiB/u);
  });

  it("rejects bytes the Lisa-shipped ledger did not attest without evaluating them", async () => {
    const marker = path.join(projectRoot, "executed");
    const malicious = `${source("1.7.0")}await import("node:fs/promises").then(fs => fs.writeFile(${JSON.stringify(marker)}, "bad"));`;
    await writeFile(path.join(projectRoot, TARGET), malicious);
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET, {
      ledger: { [TARGET]: [] },
    });
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /provenance|untrusted/u
    );
    await expect(
      import("node:fs/promises").then(fs => fs.stat(marker))
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("static nightly guard no-follow file proof", () => {
  it("rejects a missing target", async () => {
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/missing/u);
  });

  it("rejects a final symlink", async () => {
    await writeFile(
      path.join(projectRoot, "scripts", "real.mjs"),
      source("1.7.0")
    );
    await symlink("real.mjs", path.join(projectRoot, TARGET));
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/symlink/u);
  });

  it("rejects every intermediate symlink even when it remains inside the root", async () => {
    await mkdir(path.join(projectRoot, REAL_SCRIPTS));
    await writeFile(
      path.join(projectRoot, REAL_SCRIPTS, TARGET_NAME),
      source("1.7.0")
    );
    await rm(path.join(projectRoot, "scripts"), { recursive: true });
    await symlink(REAL_SCRIPTS, path.join(projectRoot, "scripts"));
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/symlink/u);
  });

  it("rejects a target through an external directory symlink", async () => {
    const external = await mkdtemp(
      path.join(os.tmpdir(), "lisa-proof-outside-")
    );
    await writeFile(path.join(external, TARGET_NAME), source("1.7.0"));
    await rm(path.join(projectRoot, "scripts"), { recursive: true });
    await symlink(external, path.join(projectRoot, "scripts"));
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    await rm(external, { force: true, recursive: true });
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/symlink/u);
  });

  it("rejects a non-regular target", async () => {
    await mkdir(path.join(projectRoot, TARGET));
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/regular/u);
  });

  it("rejects an unreadable target", async () => {
    await writeFile(path.join(projectRoot, TARGET), source("1.7.0"));
    await chmod(path.join(projectRoot, TARGET), 0o000);
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    await chmod(path.join(projectRoot, TARGET), 0o600);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /unreadable/u
    );
  });

  it("rejects a target larger than the 1 MiB proof read bound", async () => {
    await writeFile(
      path.join(projectRoot, TARGET),
      Buffer.alloc(1024 * 1024 + 1, 0x20)
    );
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/1 MiB/u);
  });

  it("enforces the standalone 2-second target proof deadline", async () => {
    await writeFile(path.join(projectRoot, TARGET), source("1.7.0"));
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValue(2001);
    await expect(
      probeNightlyE2eGuardTarget(projectRoot, TARGET, { now })
    ).rejects.toThrow("2 seconds target proof deadline exhausted");
  });

  it("proves Lisa's current shipped target through the default ledger", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const shipped = `typescript/copy-overwrite/scripts/${TARGET_NAME}`;
    await expect(
      probeNightlyE2eGuardTarget(repositoryRoot, shipped)
    ).resolves.toEqual({ state: "compatible", version: "1.7.0" });
  });
});

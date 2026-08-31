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
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

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
const certificates = (bytes: string, contractVersion = "1.7.0") => ({
  [createHash("sha256").update(bytes).digest("hex")]: { contractVersion },
});

/**
 * Write and prove one behavior-certified fixture.
 * @param bytes - Exact source bytes named by the test certificate
 * @param contractVersion - Contract bound to those exact bytes
 * @returns Static proof result for the fixture
 */
async function prove(bytes: string, contractVersion = "1.7.0") {
  await writeFile(path.join(projectRoot, TARGET), bytes);
  return await probeNightlyE2eGuardTarget(projectRoot, TARGET, {
    certificates: certificates(bytes, contractVersion),
  });
}

describe("static nightly guard contract version proof", () => {
  it.each(["1.0.0", "1.7.0", "1.999.42"])(
    "accepts exact bytes carrying behavior-certified strict ASCII semver %s",
    async version => {
      await expect(prove(`handler bytes ${version}`, version)).resolves.toEqual(
        {
          state: "compatible",
          version,
        }
      );
    }
  );

  it.each(["0.9.0", "2.0.0"])(
    "rejects a certificate with incompatible major %s",
    async version => {
      const result = await prove(`handler bytes ${version}`, version);
      expect(result).toMatchObject({ state: "failure" });
      expect(result.state === "failure" ? result.reason : "").toMatch(
        /certificate.*malformed|incompatible/u
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
  ])("rejects malformed %s certificate contract", async (_label, version) => {
    const result = await prove(`handler bytes ${version}`, version);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /certificate.*malformed|incompatible/u
    );
  });

  it("rejects bytes the behavior certificate did not attest without evaluating them", async () => {
    const marker = path.join(projectRoot, "executed");
    const malicious = `${source("1.7.0")}await import("node:fs/promises").then(fs => fs.writeFile(${JSON.stringify(marker)}, "bad"));`;
    await writeFile(path.join(projectRoot, TARGET), malicious);
    const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET, {
      certificates: {},
    });
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /behavior certificate|untrusted/u
    );
    await expect(
      import("node:fs/promises").then(fs => fs.stat(marker))
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    [
      "declaration-only source",
      'export const NIGHTLY_E2E_CONTRACT_VERSION = "1.7.0";\n',
    ],
    [
      "comment-only source",
      '// export const NIGHTLY_E2E_CONTRACT_VERSION = "1.7.0";\n',
    ],
    [
      "forged handler",
      `${source("1.7.0")}export function evaluateBypass() { return { valid: true }; }\n`,
    ],
  ])(
    "rejects %s even when the generic ownership ledger hashes it",
    async (_label, bytes) => {
      await writeFile(path.join(projectRoot, TARGET), bytes);
      const result = await probeNightlyE2eGuardTarget(projectRoot, TARGET, {
        ledger: ledger(bytes),
      });
      expect(result.state).toBe("failure");
      expect(result.state === "failure" ? result.reason : "").toMatch(
        /behavior certificate|certified|upgrade|apply/u
      );
    }
  );
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

  it("reports an injected target proof deadline exactly", async () => {
    await writeFile(path.join(projectRoot, TARGET), source("1.7.0"));
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValue(751);
    await expect(
      probeNightlyE2eGuardTarget(projectRoot, TARGET, {
        now,
        timeoutMs: 750,
      })
    ).rejects.toThrow("750 milliseconds target proof deadline exhausted");
  });

  it("proves Lisa's current shipped target through the default certificate", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const shipped = `typescript/copy-overwrite/scripts/${TARGET_NAME}`;
    await expect(
      probeNightlyE2eGuardTarget(repositoryRoot, shipped)
    ).resolves.toEqual({ state: "compatible", version: "1.8.0" });
  });

  it("accepts exact retained v2 release bytes through the behavior certificate", async () => {
    const retained = Buffer.from(
      boundedExecFileSync({
        label: "read retained v2 nightly guard artifact",
        command: "/usr/bin/git",
        args: [
          "show",
          "v2.353.0:typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs",
        ],
        cwd: path.resolve(import.meta.dirname, "../../.."),
      })
    );
    await writeFile(path.join(projectRoot, TARGET), retained);

    await expect(
      probeNightlyE2eGuardTarget(projectRoot, TARGET)
    ).resolves.toEqual({ state: "compatible", version: "1.1.0" });
  });
});

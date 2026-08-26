/** Regression coverage for precommitted scratch ownership and supervised scopes. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  materializeOwnedScratchRunRoot,
  openOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
} from "../../../src/configs/vitest/scratch.js";
import { withScratchAuthorityTestRoot } from "../../../src/configs/vitest/scratch-authority.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
  createSupervisedWorkerScope,
  parseScratchProtocolMessage,
  parseScratchSupervisionLease,
  removeSupervisedWorkerScope,
} from "../../../src/configs/vitest/scratch-supervision.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  delete process.env[SCRATCH_SUPERVISION_LEASE_ENV];
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Allocate one isolated base and register teardown.
 * @returns Fresh isolated temp base
 */
function temporaryBase(): string {
  const base = fs.mkdtempSync(path.join(tmpdir(), "scratch-supervision-"));
  temporaryDirectories.push(base);
  return base;
}

/**
 * Prepare through the concurrency-scoped internal platform-root seam.
 * @param base - Isolated logical platform root
 * @param options - Deterministic intent seams
 * @returns Precommitted scratch intent
 */
function prepareAt(
  base: string,
  options: Parameters<typeof prepareOwnedScratchRunRoot>[0] = {}
) {
  return withScratchAuthorityTestRoot(base, () =>
    prepareOwnedScratchRunRoot(options)
  );
}

describe("precommitted scratch run-root intent", () => {
  it("refuses a supported-platform run when process-birth authority is unavailable", () => {
    const base = temporaryBase();
    expect(() =>
      prepareAt(base, {
        platform: "linux",
        processBirthFingerprint: () => undefined,
      })
    ).toThrow(/process-birth authority/iu);
    expect(fs.readdirSync(path.join(base, "lisa-scratch"))).toEqual([]);
  });

  it("does not materialize the root until the armed intent is committed", () => {
    const intent = prepareAt(temporaryBase());

    expect(fs.existsSync(intent.rootPath)).toBe(false);
    expect(intent.token).toMatch(/^[a-f0-9]{32}$/u);

    const owned = materializeOwnedScratchRunRoot(intent);
    expect(owned.owner.token).toBe(intent.token);
    expect(openOwnedScratchRunRoot(intent)?.owner.token).toBe(intent.token);
  });

  it("refuses a foreign token without removing the owned root", () => {
    const intent = prepareAt(temporaryBase());
    const owned = materializeOwnedScratchRunRoot(intent);

    const foreign = { ...intent, token: "0".repeat(32) };
    expect(() => openOwnedScratchRunRoot(foreign)).toThrow(/token/iu);
    expect(() => removeOwnedScratchRunRoot(foreign)).toThrow(/token/iu);
    expect(fs.existsSync(owned.path)).toBe(true);
  });

  it("idempotently completes an interrupted matching quarantine", () => {
    const intent = prepareAt(temporaryBase());
    const owned = materializeOwnedScratchRunRoot(intent);
    const quarantine = path.join(
      owned.authority.namespace.canonicalPath,
      `.lisa-quarantine-interrupted-${intent.token}`
    );
    fs.renameSync(owned.path, quarantine);

    removeOwnedScratchRunRoot(intent);
    removeOwnedScratchRunRoot(intent);

    expect(fs.existsSync(quarantine)).toBe(false);
  });
});

describe("supervised worker scopes", () => {
  it("round-trips one bounded versioned lease and owns a nested worker scope", () => {
    const intent = prepareAt(temporaryBase());
    const suiteRoot = materializeOwnedScratchRunRoot(intent);
    const lease = createScratchSupervisionLease(intent, {
      suiteLabel: "unit",
      registeredPrefixes: ["cdk.out"],
    });
    const parsed = parseScratchSupervisionLease(JSON.stringify(lease));

    const worker = createSupervisedWorkerScope(parsed);

    expect(path.dirname(worker.path)).toBe(suiteRoot.path);
    expect(worker.owner.registeredPrefixes).toEqual(["cdk.out"]);
    removeSupervisedWorkerScope(worker);
    expect(fs.existsSync(worker.path)).toBe(false);
    removeOwnedScratchRunRoot(intent);
  });

  it("rejects a malformed or inherited path-authorizing lease", () => {
    expect(() =>
      parseScratchSupervisionLease(
        JSON.stringify({ schema: 1, rootPath: temporaryBase() })
      )
    ).toThrow(/lease/iu);
  });
});

describe("scratch supervision IPC", () => {
  it("accepts only bounded versioned protocol messages", () => {
    expect(parseScratchProtocolMessage({ schema: 1, type: "GO" }).type).toBe(
      "GO"
    );
    expect(() =>
      parseScratchProtocolMessage({ schema: 2, type: "GO" })
    ).toThrow(/protocol message/iu);
    expect(() =>
      parseScratchProtocolMessage({ schema: 1, type: "UNBOUNDED_ACTION" })
    ).toThrow(/protocol message/iu);
  });
});

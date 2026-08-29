/** Regression coverage for precommitted scratch ownership and supervised scopes. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCRATCH_NAMESPACE,
  createRunRoot,
  materializeOwnedScratchRunRoot,
  openOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
} from "../../../src/configs/vitest/scratch.js";
import {
  scratchPathIdentity,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
} from "../../../src/configs/vitest/scratch-owner.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";
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
  return withProcessPlatformTempRoot(base, () =>
    prepareOwnedScratchRunRoot(options)
  );
}

const REPLACEMENT_SENTINEL = "replacement";
const SENTINEL_FILENAME = "sentinel.txt";

/**
 * Replace an allocated root with a valid same-name foreign inode, then fail.
 * @param root - Newly allocated root path
 * @param owner - Owner record prepared for the original inode
 */
function replaceRootBeforeMarkerFailure(
  root: string,
  owner: ScratchOwnerRecordV1
): never {
  fs.renameSync(root, `${root}.original`);
  fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(path.join(root, SENTINEL_FILENAME), REPLACEMENT_SENTINEL);
  writeScratchOwnerRecord(root, {
    ...owner,
    root: scratchPathIdentity(root),
  });
  throw new Error("injected owner marker failure after inode swap");
}

describe("precommitted scratch run-root intent", () => {
  it("authority-cleans a new root when its owner marker cannot persist", () => {
    const base = temporaryBase();
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });

    expect(() =>
      withProcessPlatformTempRoot(base, () =>
        createRunRoot({
          writeOwnerRecord: () => {
            throw new Error("injected owner marker failure");
          },
        })
      )
    ).toThrow(/injected owner marker failure/iu);
    expect(fs.readdirSync(namespace)).toEqual([]);
  });

  it("preserves an inode-swapped replacement during compatible allocation rollback", () => {
    const base = temporaryBase();
    let replacement = "";
    expect(() =>
      withProcessPlatformTempRoot(base, () =>
        createRunRoot({
          writeOwnerRecord: (root, owner) => {
            replacement = root;
            return replaceRootBeforeMarkerFailure(root, owner);
          },
        })
      )
    ).toThrow(AggregateError);
    const sentinel = fs.readFileSync(
      path.join(replacement, SENTINEL_FILENAME),
      "utf8"
    );
    expect(sentinel).toBe(REPLACEMENT_SENTINEL);
  });

  it("preserves an inode-swapped replacement during armed materialization rollback", () => {
    const intent = prepareAt(temporaryBase());
    const materialize = () =>
      materializeOwnedScratchRunRoot(intent, {
        writeOwnerRecord: replaceRootBeforeMarkerFailure,
      });
    expect(materialize).toThrow(AggregateError);
    const sentinel = fs.readFileSync(
      path.join(intent.rootPath, SENTINEL_FILENAME),
      "utf8"
    );
    expect(sentinel).toBe(REPLACEMENT_SENTINEL);
  });

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

  it.each(["directory", "file", "symlink"] as const)(
    "distinguishes a precreated %s from true root absence",
    kind => {
      const base = temporaryBase();
      const outside = temporaryBase();
      const intent = prepareAt(base);
      if (kind === "directory") {
        fs.mkdirSync(intent.rootPath);
        fs.writeFileSync(path.join(intent.rootPath, "keep.txt"), "keep");
      } else if (kind === "file") {
        fs.writeFileSync(intent.rootPath, "keep");
      } else {
        fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
        fs.symlinkSync(outside, intent.rootPath);
      }

      expect(() => openOwnedScratchRunRoot(intent)).toThrow();
      if (kind === "directory") {
        expect(
          fs.readFileSync(path.join(intent.rootPath, "keep.txt"), "utf8")
        ).toBe("keep");
      } else if (kind === "file") {
        expect(fs.readFileSync(intent.rootPath, "utf8")).toBe("keep");
      } else {
        expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe(
          "keep"
        );
      }
    }
  );

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

  it("rejects extra keys and malformed message-specific fields", () => {
    const intent = prepareAt(temporaryBase());
    const target = {
      pid: 42,
      pgid: 42,
      processBirthFingerprint: "birth",
    };
    expect(() =>
      parseScratchProtocolMessage({ schema: 1, type: "GO", extra: true })
    ).toThrow(/invalid GO/iu);
    expect(() =>
      parseScratchProtocolMessage({
        schema: 1,
        type: "TARGET_INTENT",
        correlation: intent.token,
        target: {},
      })
    ).toThrow(/target_intent/iu);
    expect(() =>
      parseScratchProtocolMessage({
        schema: 1,
        type: "TARGET_INTENT",
        correlation: "wrong",
        target,
      })
    ).toThrow(/target_intent/iu);
    expect(() =>
      parseScratchProtocolMessage({
        schema: 1,
        type: "ROOT_INTENT",
        correlation: intent.token,
        intent: { ...intent, extra: true },
      })
    ).toThrow(/root intent/iu);
  });

  it("accepts exact correlated root and target intents", () => {
    const intent = prepareAt(temporaryBase());
    expect(
      parseScratchProtocolMessage({
        schema: 1,
        type: "ROOT_INTENT",
        correlation: intent.token,
        intent,
      }).type
    ).toBe("ROOT_INTENT");
    expect(
      parseScratchProtocolMessage({
        schema: 1,
        type: "TARGET_INTENT",
        correlation: intent.token,
        target: {
          pid: 42,
          pgid: 42,
          processBirthFingerprint: "birth",
        },
      }).type
    ).toBe("TARGET_INTENT");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_RECLAIM_AGE_MS,
  SCRATCH_NAMESPACE,
  SCRATCH_PREFIXES_ENV,
  SCRATCH_SUITE_ENV,
  createRunRoot,
  isReclaimable,
  parseRunRootName,
  removeScratchDir,
  runRootName,
  scratchBaseDir,
  scratchNamespaceDir,
  sweepScratchNamespace,
} from "../../../src/configs/vitest/scratch.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";

/**
 * A liveness probe reporting that every recorded pid is gone.
 * @returns Always false.
 */
const NEVER_ALIVE = (): boolean => false;

/**
 * A liveness probe reporting that every recorded pid is still running.
 * @returns Always true.
 */
const ALWAYS_ALIVE = (): boolean => true;

/** Run root owned by pid 111, standing in for a run that died. */
const DEAD_ROOT = "run-111-1000-dead01";

/** Run root owned by pid 222, standing in for a sibling run still working. */
const LIVE_ROOT = "run-222-1000-live01";

/** A directory inside the namespace that this module did not create. */
const FOREIGN_ENTRY = "not-a-run-root";

/**
 * Builds an isolated namespace to sweep, so a test never touches the real one.
 * @returns Path to a fresh directory standing in for the namespace.
 */
const temporaryBases: string[] = [];

const makeNamespace = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-spec-base-"));
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  temporaryBases.push(base);
  fs.mkdirSync(namespace, { mode: 0o700 });
  return namespace;
};

/**
 * Run one unit control under the internal concurrency-scoped platform seam.
 * @param namespace - Isolated exact namespace
 * @param operation - Control to execute
 * @returns Control result
 */
const withNamespaceAuthority = <T>(namespace: string, operation: () => T): T =>
  withProcessPlatformTempRoot(path.dirname(namespace), operation);

afterEach(() => {
  for (const base of temporaryBases.splice(0)) removeScratchDir(base);
});

describe("scratch run-root naming", () => {
  it("round-trips the pid and start time through the directory name", () => {
    expect(
      parseRunRootName(runRootName(4321, 1755000000000, "ab12cd"))
    ).toEqual({
      pid: 4321,
      startedAt: 1755000000000,
    });
  });

  it("produces the documented name shape", () => {
    expect(runRootName(7, 42, "zzz")).toBe("run-7-42-zzz");
  });

  it.each([
    ["lisa-test-abc123"],
    ["run-notapid-42-x"],
    ["run-7-42"],
    ["coverage"],
    [""],
  ])("returns undefined for a name it did not produce: %s", name => {
    expect(parseRunRootName(name)).toBeUndefined();
  });
});

describe("isReclaimable", () => {
  const name = "run-999-1000-abcdef";

  it("reclaims a root whose owning process is gone", () => {
    expect(
      isReclaimable({ name, now: 2000, isProcessAlive: NEVER_ALIVE })
    ).toBe(true);
  });

  it("keeps a root a live sibling run still owns", () => {
    expect(
      isReclaimable({ name, now: 2000, isProcessAlive: ALWAYS_ALIVE })
    ).toBe(false);
  });

  it("preserves an ambiguous live legacy root regardless of age", () => {
    expect(
      isReclaimable({
        name,
        now: 1000 + DEFAULT_RECLAIM_AGE_MS + 1,
        isProcessAlive: ALWAYS_ALIVE,
      })
    ).toBe(false);
  });

  it("never reclaims the caller's own root", () => {
    expect(
      isReclaimable({
        name,
        now: 2000,
        isProcessAlive: NEVER_ALIVE,
        selfName: name,
      })
    ).toBe(false);
  });

  it("never reclaims a name it does not recognise", () => {
    expect(
      isReclaimable({
        name: "some-other-tools-directory",
        now: Number.MAX_SAFE_INTEGER,
        isProcessAlive: NEVER_ALIVE,
      })
    ).toBe(false);
  });
});

describe("sweepScratchNamespace", () => {
  it("preserves markerless roots regardless of pid state", () => {
    const dir = makeNamespace();
    fs.mkdirSync(path.join(dir, DEAD_ROOT));
    fs.mkdirSync(path.join(dir, LIVE_ROOT));
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));
    fs.writeFileSync(path.join(dir, DEAD_ROOT, "fixture.txt"), "leaked");

    const result = withNamespaceAuthority(dir, () =>
      sweepScratchNamespace({
        now: 2000,
        isProcessAlive: pid => pid === 222,
      })
    );

    expect(result.removed).toEqual([]);
    expect([...result.kept].sort((a, b) => a.localeCompare(b))).toEqual([
      FOREIGN_ENTRY,
      DEAD_ROOT,
      LIVE_ROOT,
    ]);
    expect(fs.existsSync(path.join(dir, DEAD_ROOT))).toBe(true);
    expect(fs.existsSync(path.join(dir, LIVE_ROOT))).toBe(true);

    removeScratchDir(dir);
  });

  it("does not let a recognized name authorize a populated deletion", () => {
    const dir = makeNamespace();
    const root = path.join(dir, "run-111-1000-deep01");
    fs.mkdirSync(path.join(root, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c", "f.txt"), "x");

    withNamespaceAuthority(dir, () =>
      sweepScratchNamespace({ now: 2000, isProcessAlive: NEVER_ALIVE })
    );

    expect(fs.existsSync(root)).toBe(true);
    removeScratchDir(dir);
  });

  it("never age-deletes corrupt or unrecognised entries", () => {
    const dir = makeNamespace();
    const stale = path.join(dir, "an-older-releases-directory");
    fs.mkdirSync(stale);
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));

    const result = withNamespaceAuthority(dir, () =>
      sweepScratchNamespace({
        now: Date.now() + DEFAULT_RECLAIM_AGE_MS + 1,
        isProcessAlive: NEVER_ALIVE,
      })
    );

    expect(result.removed).toEqual([]);
    expect([...result.kept].sort((a, b) => a.localeCompare(b))).toEqual([
      "an-older-releases-directory",
      FOREIGN_ENTRY,
    ]);
    removeScratchDir(dir);
  });

  it("reports nothing when the namespace does not exist yet", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-empty-base-"));
    temporaryBases.push(base);
    expect(
      withProcessPlatformTempRoot(base, () => sweepScratchNamespace())
    ).toEqual({ removed: [], kept: [] });
  });
});

describe("createRunRoot", () => {
  it("creates a root inside the namespace whose name records this process", () => {
    const dir = makeNamespace();
    const root = withNamespaceAuthority(dir, () =>
      createRunRoot({ now: 1755000000000 })
    );

    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(path.dirname(root)).toBe(fs.realpathSync(dir));
    expect(parseRunRootName(path.basename(root))).toEqual({
      pid: process.pid,
      startedAt: 1755000000000,
    });

    removeScratchDir(dir);
  });

  it.each([
    [SCRATCH_PREFIXES_ENV, JSON.stringify(["../escape"])],
    [SCRATCH_SUITE_ENV, "invalid\nlabel"],
  ])("validates %s before allocating a run root", (variable, value) => {
    const dir = makeNamespace();
    const previous = process.env[variable];
    process.env[variable] = value;
    try {
      expect(() => withNamespaceAuthority(dir, () => createRunRoot())).toThrow(
        /invalid/iu
      );
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    }
  });
});

describe("scratchBaseDir", () => {
  it("ignores a hostile Lisa-specific redirect and retains os.tmpdir authority", () => {
    const legacyRedirect = ["LISA", "TEST", "SCRATCH", "ROOT"].join("_");
    const previous = process.env[legacyRedirect];
    const expected = os.tmpdir();
    process.env[legacyRedirect] = "/mnt/hostile-scratch-redirect";
    try {
      expect(scratchBaseDir()).toBe(expected);
      expect(scratchNamespaceDir()).toBe(
        path.join(expected, SCRATCH_NAMESPACE)
      );
    } finally {
      if (previous === undefined) {
        delete process.env[legacyRedirect];
      } else {
        process.env[legacyRedirect] = previous;
      }
    }
  });
});

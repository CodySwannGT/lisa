import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_RECLAIM_AGE_MS,
  SCRATCH_NAMESPACE,
  SCRATCH_ROOT_ENV,
  createRunRoot,
  isReclaimable,
  parseRunRootName,
  removeScratchDir,
  runRootName,
  scratchBaseDir,
  scratchNamespaceDir,
  sweepScratchNamespace,
} from "../../../src/configs/vitest/scratch.js";
import {
  MAX_NAMESPACE_ENTRIES,
  describeResidueFailure,
  inspectNamespace,
} from "../../../src/configs/vitest/scratch-global-setup.js";

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

/** A namespace path used only for message formatting, never touched on disk. */
const NAMESPACE_LABEL = "/srv/scratch/lisa-scratch";

/** A run-root name used only for message formatting, never created on disk. */
const ORPHAN_LABEL = "run-1-2-abc123";

/** A directory name the reclaim sweep cannot parse, used in message tests. */
const RENAMED_LABEL = "renamed-root-01";

/**
 * Builds an isolated namespace to sweep, so a test never touches the real one.
 * @returns Path to a fresh directory standing in for the namespace.
 */
const makeNamespace = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "scratch-spec-"));

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

  it("reclaims a live-pid root past the backstop age, because pids are recycled", () => {
    expect(
      isReclaimable({
        name,
        now: 1000 + DEFAULT_RECLAIM_AGE_MS + 1,
        isProcessAlive: ALWAYS_ALIVE,
      })
    ).toBe(true);
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
  it("removes abandoned roots and leaves live and foreign entries alone", () => {
    const dir = makeNamespace();
    fs.mkdirSync(path.join(dir, DEAD_ROOT));
    fs.mkdirSync(path.join(dir, LIVE_ROOT));
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));
    fs.writeFileSync(path.join(dir, DEAD_ROOT, "fixture.txt"), "leaked");

    const result = sweepScratchNamespace({
      dir,
      now: 2000,
      isProcessAlive: pid => pid === 222,
    });

    expect(result.removed).toEqual([DEAD_ROOT]);
    expect([...result.kept].sort((a, b) => a.localeCompare(b))).toEqual([
      FOREIGN_ENTRY,
      LIVE_ROOT,
    ]);
    expect(fs.existsSync(path.join(dir, DEAD_ROOT))).toBe(false);
    expect(fs.existsSync(path.join(dir, LIVE_ROOT))).toBe(true);

    removeScratchDir(dir);
  });

  it("removes a populated root wholesale rather than file by file", () => {
    const dir = makeNamespace();
    const root = path.join(dir, "run-111-1000-deep01");
    fs.mkdirSync(path.join(root, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c", "f.txt"), "x");

    sweepScratchNamespace({ dir, now: 2000, isProcessAlive: NEVER_ALIVE });

    expect(fs.existsSync(root)).toBe(false);
    removeScratchDir(dir);
  });

  it("reclaims a foreign entry once it is past the backstop age", () => {
    const dir = makeNamespace();
    const stale = path.join(dir, "an-older-releases-directory");
    fs.mkdirSync(stale);
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));

    const result = sweepScratchNamespace({
      dir,
      now: Date.now() + DEFAULT_RECLAIM_AGE_MS + 1,
      isProcessAlive: NEVER_ALIVE,
    });

    expect([...result.removed].sort((a, b) => a.localeCompare(b))).toEqual([
      "an-older-releases-directory",
      FOREIGN_ENTRY,
    ]);
    removeScratchDir(dir);
  });

  it("reports nothing when the namespace does not exist yet", () => {
    expect(
      sweepScratchNamespace({ dir: "/nonexistent/lisa-scratch-absent" })
    ).toEqual({ removed: [], kept: [] });
  });
});

describe("createRunRoot", () => {
  it("creates a root inside the namespace whose name records this process", () => {
    const dir = makeNamespace();
    const root = createRunRoot({ dir, now: 1755000000000 });

    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(path.dirname(root)).toBe(dir);
    expect(parseRunRootName(path.basename(root))).toEqual({
      pid: process.pid,
      startedAt: 1755000000000,
    });

    removeScratchDir(dir);
  });
});

describe("scratchBaseDir", () => {
  it("honours the explicit override so CI can place scratch on a chosen volume", () => {
    const previous = process.env[SCRATCH_ROOT_ENV];
    process.env[SCRATCH_ROOT_ENV] = "/mnt/fast-scratch";
    try {
      expect(scratchBaseDir()).toBe("/mnt/fast-scratch");
      expect(scratchNamespaceDir()).toBe(
        `/mnt/fast-scratch/${SCRATCH_NAMESPACE}`
      );
    } finally {
      if (previous === undefined) {
        delete process.env[SCRATCH_ROOT_ENV];
      } else {
        process.env[SCRATCH_ROOT_ENV] = previous;
      }
    }
  });

  it("ignores an override that is only whitespace", () => {
    const previous = process.env[SCRATCH_ROOT_ENV];
    process.env[SCRATCH_ROOT_ENV] = "   ";
    try {
      expect(scratchBaseDir()).not.toBe("   ");
    } finally {
      if (previous === undefined) {
        delete process.env[SCRATCH_ROOT_ENV];
      } else {
        process.env[SCRATCH_ROOT_ENV] = previous;
      }
    }
  });
});

describe("inspectNamespace", () => {
  it("separates foreign names from roots whose owner is gone", () => {
    const dir = makeNamespace();
    fs.mkdirSync(path.join(dir, DEAD_ROOT));
    fs.mkdirSync(path.join(dir, LIVE_ROOT));
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));

    const residue = inspectNamespace(dir, pid => pid === 222);

    expect(residue.orphaned).toEqual([DEAD_ROOT]);
    expect(residue.unrecognised).toEqual([FOREIGN_ENTRY]);
    expect(residue.total).toBe(3);

    removeScratchDir(dir);
  });

  it("reports an empty namespace for a directory that is not there", () => {
    expect(inspectNamespace("/nonexistent/lisa-scratch-absent")).toEqual({
      orphaned: [],
      unrecognised: [],
      total: 0,
    });
  });
});

describe("describeResidueFailure", () => {
  it("passes a namespace holding only live sibling runs", () => {
    expect(
      describeResidueFailure(NAMESPACE_LABEL, {
        orphaned: [],
        unrecognised: [],
        total: 12,
      })
    ).toBeUndefined();
  });

  it("does NOT fail on a foreign name, which the sweep reclaims on age instead", () => {
    // This branch used to throw. One stray directory then failed every future
    // run with a message naming an internal function, which a downstream user
    // could neither understand nor clear.
    expect(
      describeResidueFailure(NAMESPACE_LABEL, {
        orphaned: [],
        unrecognised: [RENAMED_LABEL],
        total: 1,
      })
    ).toBeUndefined();
  });

  it("fails on a root whose owner is gone but which survived the sweep", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [ORPHAN_LABEL],
      unrecognised: [],
      total: 1,
    });

    expect(message).toContain(ORPHAN_LABEL);
    expect(message).toContain("Reclaim-on-start is not working");
  });

  it("fails once the namespace passes its ceiling", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: [],
      total: MAX_NAMESPACE_ENTRIES + 1,
    });

    expect(message).toContain(String(MAX_NAMESPACE_ENTRIES));
    expect(message).toContain("accumulating");
  });

  it("reports unreclaimed residue ahead of the ceiling, because it is the cause", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [ORPHAN_LABEL],
      unrecognised: [RENAMED_LABEL],
      total: MAX_NAMESPACE_ENTRIES + 1,
    });

    expect(message).toContain(ORPHAN_LABEL);
  });
});

import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  createRunRoot,
  removeScratchDir,
} from "../../../src/configs/vitest/scratch.js";
import {
  MAX_NAMESPACE_ENTRIES,
  describeResidueFailure,
  sweepThenInspect,
} from "../../../src/configs/vitest/scratch-global-setup.js";
import {
  SCRATCH_OWNER_FILE,
  currentProcessBirthFingerprint,
} from "../../../src/configs/vitest/scratch-owner.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  isProcessAlive,
  PAYLOAD_MARKER,
  REPO_ROOT,
  temporaryTestRunDirectory,
  testRunCompanionPids,
  TEST_RUN_SOURCE_ARGS,
  waitForTestRun,
} from "../../helpers/lisa-test-run-process.js";

/**
 * Report every recorded process as dead.
 * @returns Always false
 */
const NEVER_ALIVE = (): boolean => false;
const DEAD_ROOT = "run-111-1000-dead01";
const NAMESPACE_LABEL = "/srv/scratch/lisa-scratch";
const ORPHAN_LABEL = "run-1-2-abc123";
const RENAMED_LABEL = "renamed-root-01";
const temporaryBases: string[] = [];
const registerTestRunDirectory = (directory: string): void => {
  temporaryBases.push(directory);
};

/**
 * Build one isolated exact namespace.
 * @returns Isolated namespace path
 */
const makeNamespace = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-spec-base-"));
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  temporaryBases.push(base);
  fs.mkdirSync(namespace, { mode: 0o700 });
  return namespace;
};

/**
 * Run a control under the concurrency-scoped authority seam.
 * @param namespace - Isolated exact namespace
 * @param operation - Control to execute
 * @returns Control result
 */
const withNamespaceAuthority = <T>(namespace: string, operation: () => T): T =>
  withProcessPlatformTempRoot(path.dirname(namespace), operation);

afterEach(() => {
  for (const base of temporaryBases.splice(0)) removeScratchDir(base);
});

describe("describeResidueFailure", () => {
  it("shares one live-owner birth snapshot between sweep and inspection", () => {
    const dir = makeNamespace();
    withNamespaceAuthority(dir, () => createRunRoot());
    const snapshot = vi.fn(
      (pids: readonly number[]) =>
        new Map(pids.map(pid => [pid, currentProcessBirthFingerprint()]))
    );

    const residue = withNamespaceAuthority(dir, () =>
      sweepThenInspect(() => true, snapshot)
    );

    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledWith([process.pid]);
    expect(residue).toEqual({ orphaned: [], unrecognised: [], total: 1 });
  });

  it("passes a namespace holding only live sibling runs", () => {
    expect(
      describeResidueFailure(NAMESPACE_LABEL, {
        orphaned: [],
        unrecognised: [],
        total: 12,
      })
    ).toBeUndefined();
  });

  it("refuses a single unowned entry and names it", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: [RENAMED_LABEL],
      total: 1,
    });

    expect(message).toContain(RENAMED_LABEL);
    expect(message).toMatch(/owner marker|authority/iu);
    expect(message).toContain(
      "Remove only an exact entry whose dead owner you can independently verify"
    );
    expect(message).toContain("Do not clear the shared namespace");
  });

  it.each([
    ["corrupt", "not-json"],
    ["oversized", "x".repeat(20_000)],
  ])("preserves and refuses a single %s owner marker", (_kind, contents) => {
    const dir = makeNamespace();
    const root = path.join(dir, DEAD_ROOT);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, SCRATCH_OWNER_FILE), contents, "utf8");

    const residue = withNamespaceAuthority(dir, () =>
      sweepThenInspect(NEVER_ALIVE)
    );
    const message = describeResidueFailure(dir, residue);

    expect(fs.existsSync(root)).toBe(true);
    expect(residue).toEqual({
      orphaned: [],
      unrecognised: [DEAD_ROOT],
      total: 1,
    });
    expect(message).toContain(DEAD_ROOT);
  });

  it("fails on a root whose owner is gone but survived sweep", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [ORPHAN_LABEL],
      unrecognised: [],
      total: 1,
    });
    expect(message).toContain(ORPHAN_LABEL);
    expect(message).toContain("Reclaim-on-start is not working");
  });

  it("passes a namespace holding only live sibling runs at any size", () => {
    expect(
      describeResidueFailure(NAMESPACE_LABEL, {
        orphaned: [],
        unrecognised: [],
        total: MAX_NAMESPACE_ENTRIES * 7,
      })
    ).toBeUndefined();
  });

  it("fails once unowned entries pass the ceiling", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: Array.from(
        { length: MAX_NAMESPACE_ENTRIES + 1 },
        (_unused, index) => `stray-${String(index)}`
      ),
      total: MAX_NAMESPACE_ENTRIES + 1,
    });
    expect(message).toContain(String(MAX_NAMESPACE_ENTRIES));
    expect(message).toContain("accumulating");
  });

  it("names the unreclaimed count and total separately", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [],
      unrecognised: Array.from(
        { length: MAX_NAMESPACE_ENTRIES + 1 },
        (_unused, index) => `stray-${String(index)}`
      ),
      total: MAX_NAMESPACE_ENTRIES * 4,
    });
    expect(message).toContain(String(MAX_NAMESPACE_ENTRIES + 1));
    expect(message).toContain(String(MAX_NAMESPACE_ENTRIES * 4));
  });

  it("still fails on a genuine orphan leak ahead of any count", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [ORPHAN_LABEL],
      unrecognised: [],
      total: 3,
    });
    expect(message).toContain(ORPHAN_LABEL);
    expect(message).toContain("Reclaim-on-start is not");
  });

  it("reports unreclaimed residue ahead of the ceiling", () => {
    const message = describeResidueFailure(NAMESPACE_LABEL, {
      orphaned: [ORPHAN_LABEL],
      unrecognised: [RENAMED_LABEL],
      total: MAX_NAMESPACE_ENTRIES + 1,
    });
    expect(message).toContain(ORPHAN_LABEL);
  });
});

describe("detached lisa-test-run recovery", () => {
  it("stops the payload and cleans on reaper death after GO", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-death-",
      registerTestRunDirectory
    );
    const marker = path.join(base, PAYLOAD_MARKER);
    const result = boundedSpawnSync({
      label: "reaper death after GO",
      command: process.execPath,
      args: [...TEST_RUN_SOURCE_ARGS],
      baseMs: 6_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
        LISA_TEST_RUN_MODE: "wait",
        LISA_TEST_RUN_TEST_FAULT: "kill-reaper-after-go",
      },
    });
    expect(result.status).toBe(1);
    expect(fs.readdirSync(path.join(base, SCRATCH_NAMESPACE))).toEqual([]);
  });

  it("leaves no root when the foreground dies between mkdir and owner marker", async () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-pre-marker-",
      registerTestRunDirectory
    );
    const marker = path.join(base, PAYLOAD_MARKER);
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    const child = spawn(process.execPath, [...TEST_RUN_SOURCE_ARGS], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
        LISA_TEST_RUN_TEST_FAULT: "pause-before-owner-marker",
      },
      stdio: "ignore",
    });
    await waitForTestRun(
      () =>
        fs.existsSync(namespace) &&
        fs
          .readdirSync(namespace)
          .some(name => fs.existsSync(path.join(namespace, name))),
      "pre-marker root materialization"
    );
    const [basename] = fs.readdirSync(namespace);
    expect(basename).toBeDefined();
    const root = path.join(namespace, basename ?? "missing-root");
    expect(fs.existsSync(path.join(root, SCRATCH_OWNER_FILE))).toBe(false);
    const companions = testRunCompanionPids(child.pid ?? -1);
    expect(companions).toHaveLength(2);
    const exited = new Promise<void>(resolve =>
      child.once("exit", () => resolve())
    );

    child.kill("SIGKILL");
    await exited;
    for (const pid of companions) {
      try {
        process.kill(pid, "SIGCONT");
      } catch {
        // A companion that observed disconnect is already terminal.
      }
    }
    await waitForTestRun(
      () => companions.every(pid => !isProcessAlive(pid)),
      "pre-marker companion exit"
    );

    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.readdirSync(namespace)).toEqual([]);
  });
});

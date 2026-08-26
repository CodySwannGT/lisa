/** Deterministic contract tests for the bounded temp-growth measurement. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildGrowthReport,
  canonicalizeTmpPrefix,
  collectBoundedEntryNames,
  DEFAULT_TMPDIR_GROWTH_ARTIFACT,
  processBirthFingerprintSnapshot,
} from "../../../scripts/measure-tmpdir-growth.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const INVALID_RUN_NAME = "run-1-1-invalid";
const ENTRY_RUN_NAME = "run-1-1-entry";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/measure-tmpdir-growth.mjs");
const SCRATCH_NAMESPACE = "lisa-scratch";
const GROUPING_VERSION = "mkdtemp-prefix-v1";
const temporaryDirectories: string[] = [];

/** Paths for one isolated black-box measurement series. */
interface MeasurementPaths {
  readonly container: string;
  readonly root: string;
  readonly artifact: string;
}

/**
 * Allocate an isolated measured root and adjacent artifact path.
 * @returns Paths for one measurement series
 */
function measurementPaths(): MeasurementPaths {
  const container = fs.mkdtempSync(path.join(tmpdir(), "tmp-growth-"));
  const root = path.join(container, "measured");
  const artifact = path.join(container, "artifact.json");
  temporaryDirectories.push(container);
  fs.mkdirSync(root);
  return { container, root, artifact };
}

/**
 * Execute the public CLI with deterministic paths and time.
 * @param root - Temp directory to measure
 * @param artifact - Two-snapshot artifact path
 * @param nowMs - Observation epoch milliseconds
 * @returns Bounded child result
 */
function runMeasurement(root: string, artifact: string, nowMs: number) {
  return boundedSpawnSync({
    label: "temp growth measurement",
    command: process.execPath,
    args: [
      SCRIPT,
      "--root",
      root,
      "--artifact",
      artifact,
      "--now-ms",
      String(nowMs),
    ],
    baseMs: 6_000,
    cwd: REPO_ROOT,
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
  });
}

/** Read one measurement artifact for assertions. */
function readArtifact(artifact: string) {
  return JSON.parse(fs.readFileSync(artifact, "utf8"));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const snapshot = (at: number, names: readonly string[]) => ({
  schemaVersion: 1,
  groupingVersion: GROUPING_VERSION,
  logicalRoot: "/tmp",
  canonicalRoot: "/private/tmp",
  rootIdentity: { dev: 1, ino: 2 },
  observedAt: new Date(at).toISOString(),
  observedAtMs: at,
  complete: true,
  entryNames: [...names],
  prefixCounts: {},
  namespace: { total: 0, owned: 0, live: 0, unowned: 0, entries: [] },
});

/** Build a comparable snapshot with explicit namespace ownership facts. */
const namespaceSnapshot = (
  at: number,
  entries: readonly {
    readonly name: string;
    readonly owned: boolean;
    readonly live: boolean;
  }[]
) => ({
  ...snapshot(at, [SCRATCH_NAMESPACE]),
  namespace: {
    total: entries.length,
    owned: entries.filter(entry => entry.owned).length,
    live: entries.filter(entry => entry.live).length,
    unowned: entries.filter(entry => !entry.owned).length,
    entries: entries.map(entry => ({
      ...entry,
      reason: entry.owned ? "owned" : "missing marker",
    })),
  },
});

describe("temp growth measurement", () => {
  it("keeps the default artifact local, ignored, and untracked", () => {
    const artifact = DEFAULT_TMPDIR_GROWTH_ARTIFACT;

    expect(artifact).toBe(path.join(".lisa", "tmpdir-growth.json"));
    for (const gitignore of [
      path.join(REPO_ROOT, ".gitignore"),
      path.join(REPO_ROOT, "all/copy-contents/gitignore"),
    ]) {
      expect(fs.readFileSync(gitignore, "utf8").split("\n")).toContain(
        artifact
      );
    }
    expect(
      boundedSpawnSync({
        label: "default temp-growth artifact ignore rule",
        command: "git",
        args: ["check-ignore", "--no-index", "--quiet", artifact],
        baseMs: 2_000,
        cwd: REPO_ROOT,
      }).status
    ).toBe(0);
    expect(
      boundedSpawnSync({
        label: "default temp-growth artifact tracked inventory",
        command: "git",
        args: ["ls-files", "--error-unmatch", artifact],
        baseMs: 2_000,
        cwd: REPO_ROOT,
      }).status
    ).not.toBe(0);
  });

  it.each([
    ["cdk.outAb12xy", "cdk.out*"],
    ["fixture-Ab12xy", "fixture-*"],
    [SCRATCH_NAMESPACE, SCRATCH_NAMESPACE],
  ])("groups %s as %s", (name, expected) => {
    expect(canonicalizeTmpPrefix(name)).toBe(expected);
  });

  it("reports the first snapshot without inventing a rate", () => {
    expect(
      buildGrowthReport(undefined, snapshot(1_000, ["old-Ab12xy"]))
    ).toEqual(expect.objectContaining({ rateEntriesPerDay: null }));
  });

  it("persists grouping and empty suite ownership metadata structurally", () => {
    const paths = measurementPaths();

    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    const artifact = readArtifact(paths.artifact);

    expect(artifact).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        groupingVersion: GROUPING_VERSION,
      })
    );
    expect(artifact.snapshots).toHaveLength(1);
    expect(artifact.snapshots[0]).toEqual(
      expect.objectContaining({
        groupingVersion: GROUPING_VERSION,
        namespace: expect.objectContaining({
          suiteLabels: [],
          validOwnerRecords: [],
        }),
      })
    );
  });

  it("reports 27 entries over 86.4 seconds as 27,000 entries/day", () => {
    const before = snapshot(1_000, []);
    const after = snapshot(
      87_400,
      Array.from({ length: 27 }, (_unused, index) => `new-${index}-Ab12xy`)
    );

    expect(buildGrowthReport(before, after)).toEqual(
      expect.objectContaining({
        created: 27,
        removed: 0,
        unreclaimed: 27,
        rateEntriesPerDay: 27_000,
      })
    );
  });

  it("keeps created and removed visible when the total is unchanged", () => {
    const report = buildGrowthReport(
      snapshot(1_000, ["old-Ab12xy"]),
      snapshot(2_000, ["new-Ab12xy"])
    );

    expect(report).toEqual(
      expect.objectContaining({ delta: 0, created: 1, removed: 1 })
    );
  });

  it("uses a deterministic code-point tiebreak for top prefixes", () => {
    const report = buildGrowthReport(
      snapshot(1_000, []),
      snapshot(2_000, ["beta-Ab12xy", "alpha-Ab12xy"])
    );

    expect(report.topPrefixes.map(entry => entry.prefix)).toEqual([
      "alpha-*",
      "beta-*",
    ]);
  });

  it("processes 100,000 injected entries within the documented cap", () => {
    const names = function* () {
      for (let index = 0; index < 100_000; index += 1) yield `entry-${index}`;
    };

    expect(collectBoundedEntryNames(names())).toHaveLength(100_000);
  });

  it("audits 1,000 macOS owners in four bounded birth batches", () => {
    const calls: number[][] = [];
    const pids = Array.from({ length: 1_000 }, (_, index) => index + 1);
    const births = processBirthFingerprintSnapshot(pids, {
      platform: "darwin",
      runDarwinBatch: batch => {
        calls.push([...batch]);
        return batch
          .map(pid => `${String(pid)} Tue Aug 26 12:34:56 2026`)
          .join("\n");
      },
    });

    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.length <= 256)).toBe(true);
    expect(births.get(1)).toBe("darwin:Tue Aug 26 12:34:56 2026");
    expect(births.get(1_000)).toBe("darwin:Tue Aug 26 12:34:56 2026");
  });

  it("refuses an injected iterable past the 200,000-entry cap", () => {
    const names = function* () {
      for (let index = 0; index < 200_001; index += 1) yield `entry-${index}`;
    };

    expect(() => collectBoundedEntryNames(names())).toThrow(/200000/u);
  });

  it("preserves historical debris and flags only a newly created direct CDK entry", () => {
    const paths = measurementPaths();
    fs.mkdirSync(path.join(paths.root, "cdk.outAb12xy"));

    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    expect(readArtifact(paths.artifact).report.rateEntriesPerDay).toBeNull();

    fs.mkdirSync(path.join(paths.root, "cdk.outCd34ef"));
    expect(runMeasurement(paths.root, paths.artifact, 87_400).status).toBe(1);
    expect(readArtifact(paths.artifact).report).toEqual(
      expect.objectContaining({
        delta: 1,
        created: 1,
        removed: 0,
        unreclaimed: 1,
        rateEntriesPerDay: 1_000,
        violations: ["new direct cdk.out entry: cdk.outCd34ef"],
      })
    );
  });

  it("retains only the latest two complete snapshots", () => {
    const paths = measurementPaths();

    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    expect(runMeasurement(paths.root, paths.artifact, 2_000).status).toBe(0);
    expect(runMeasurement(paths.root, paths.artifact, 3_000).status).toBe(0);

    expect(
      readArtifact(paths.artifact).snapshots.map(
        (entry: { readonly observedAtMs: number }) => entry.observedAtMs
      )
    ).toEqual([2_000, 3_000]);
  });

  it("flags a newly unowned namespace child", () => {
    const paths = measurementPaths();

    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    const namespace = path.join(paths.root, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    fs.mkdirSync(path.join(namespace, "unknown-child"));

    expect(runMeasurement(paths.root, paths.artifact, 2_000).status).toBe(1);
    expect(readArtifact(paths.artifact).report.namespace).toEqual(
      expect.objectContaining({ created: 1, unowned: 1, newlyUnowned: 1 })
    );
  });

  it.each([
    ["removed", false],
    ["corrupt", true],
  ])(
    "flags an existing owned child whose marker becomes %s",
    (_transition, live) => {
      const name = "run-123-1000-owned01";
      const before = namespaceSnapshot(1_000, [
        { name, owned: true, live: true },
      ]);
      const after = namespaceSnapshot(2_000, [{ name, owned: false, live }]);

      expect(buildGrowthReport(before, after)).toEqual(
        expect.objectContaining({
          namespace: expect.objectContaining({ newlyUnowned: 1 }),
          violations: [`new unowned lisa-scratch child: ${name}`],
        })
      );
    }
  );

  it("does not re-report a historically unowned child", () => {
    const name = "historical-unowned";
    const before = namespaceSnapshot(1_000, [
      { name, owned: false, live: false },
    ]);
    const after = namespaceSnapshot(2_000, [
      { name, owned: false, live: false },
    ]);

    expect(buildGrowthReport(before, after)).toEqual(
      expect.objectContaining({
        namespace: expect.objectContaining({ newlyUnowned: 0 }),
        violations: [],
      })
    );
  });

  it.each(["version", "partial"])(
    "returns exit 2 and preserves a %s artifact",
    corruption => {
      const paths = measurementPaths();
      expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
      const value = readArtifact(paths.artifact);
      if (corruption === "version") value.schemaVersion = 99;
      else value.snapshots[0].complete = false;
      const corrupted = `${JSON.stringify(value, null, 2)}\n`;
      fs.writeFileSync(paths.artifact, corrupted, "utf8");

      const result = runMeasurement(paths.root, paths.artifact, 2_000);

      expect(result.status).toBe(2);
      expect(fs.readFileSync(paths.artifact, "utf8")).toBe(corrupted);
    }
  );

  it.each([
    [
      "non-boolean owned",
      (value: any) => {
        value.snapshots[0].namespace = {
          total: 1,
          owned: 0,
          live: 0,
          unowned: 1,
          entries: [{ name: INVALID_RUN_NAME, owned: "yes", live: false }],
          suiteLabels: [],
          validOwnerRecords: [],
        };
      },
    ],
    [
      "non-boolean live",
      (value: any) => {
        value.snapshots[0].namespace = {
          total: 1,
          owned: 1,
          live: 0,
          unowned: 0,
          entries: [
            {
              name: INVALID_RUN_NAME,
              owned: true,
              live: "yes",
              pid: 1,
              suiteLabel: "unit",
              token: "token",
            },
          ],
          suiteLabels: ["unit"],
          validOwnerRecords: [
            {
              name: INVALID_RUN_NAME,
              pid: 1,
              suiteLabel: "unit",
              token: "token",
              live: "yes",
            },
          ],
        };
      },
    ],
    [
      "omitted owner token",
      (value: any) => {
        value.snapshots[0].namespace = {
          total: 1,
          owned: 1,
          live: 0,
          unowned: 0,
          entries: [
            {
              name: INVALID_RUN_NAME,
              owned: true,
              live: false,
              pid: 1,
              suiteLabel: "unit",
              token: "token",
            },
          ],
          suiteLabels: ["unit"],
          validOwnerRecords: [
            {
              name: INVALID_RUN_NAME,
              pid: 1,
              suiteLabel: "unit",
              live: false,
            },
          ],
        };
      },
    ],
    [
      "owner-name mismatch",
      (value: any) => {
        value.snapshots[0].namespace = {
          total: 1,
          owned: 1,
          live: 0,
          unowned: 0,
          entries: [
            {
              name: ENTRY_RUN_NAME,
              owned: true,
              live: false,
              pid: 1,
              suiteLabel: "unit",
              token: "token",
            },
          ],
          suiteLabels: ["unit"],
          validOwnerRecords: [
            {
              name: "run-1-1-record",
              pid: 1,
              suiteLabel: "unit",
              token: "token",
              live: false,
            },
          ],
        };
      },
    ],
    [
      "suite-label mismatch",
      (value: any) => {
        value.snapshots[0].namespace = {
          total: 1,
          owned: 1,
          live: 0,
          unowned: 0,
          entries: [
            {
              name: ENTRY_RUN_NAME,
              owned: true,
              live: false,
              pid: 1,
              suiteLabel: "unit",
              token: "token",
            },
          ],
          suiteLabels: ["other"],
          validOwnerRecords: [
            {
              name: ENTRY_RUN_NAME,
              pid: 1,
              suiteLabel: "unit",
              token: "token",
              live: false,
            },
          ],
        };
      },
    ],
    [
      "report shape",
      (value: any) => {
        value.report = { total: "not-a-count" };
      },
    ],
  ] as const)(
    "preserves bytes for malformed persisted %s",
    (_label, corrupt) => {
      const paths = measurementPaths();
      expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
      const value = readArtifact(paths.artifact);
      corrupt(value);
      const corrupted = `${JSON.stringify(value, null, 2)}\n`;
      fs.writeFileSync(paths.artifact, corrupted, "utf8");

      expect(runMeasurement(paths.root, paths.artifact, 2_000).status).toBe(2);
      expect(fs.readFileSync(paths.artifact, "utf8")).toBe(corrupted);
    }
  );

  it("preserves the artifact on root mismatch and non-monotonic time", () => {
    const first = measurementPaths();
    const second = measurementPaths();
    expect(runMeasurement(first.root, first.artifact, 1_000).status).toBe(0);
    const original = fs.readFileSync(first.artifact, "utf8");

    expect(runMeasurement(second.root, first.artifact, 2_000).status).toBe(2);
    expect(fs.readFileSync(first.artifact, "utf8")).toBe(original);
    expect(runMeasurement(first.root, first.artifact, 1_000).status).toBe(2);
    expect(fs.readFileSync(first.artifact, "utf8")).toBe(original);
  });

  it("refuses a symlink temp root without replacing prior evidence", () => {
    const paths = measurementPaths();
    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    const original = fs.readFileSync(paths.artifact, "utf8");
    const link = path.join(paths.container, "root-link");
    fs.symlinkSync(paths.root, link);

    expect(runMeasurement(link, paths.artifact, 2_000).status).toBe(2);
    expect(fs.readFileSync(paths.artifact, "utf8")).toBe(original);
  });
});

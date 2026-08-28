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
import {
  darwinBirthBatchingEvidence,
  darwinTmpdirGrowthPerformance,
  verifyDarwinTmpdirGrowthOverCap,
} from "../../helpers/tmpdir-growth-darwin-performance.js";

const INVALID_RUN_NAME = "run-1-1-invalid";
const ENTRY_RUN_NAME = "run-1-1-entry";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/measure-tmpdir-growth.mjs");
const SCRATCH_NAMESPACE = "lisa-scratch";
const OWNER_FILE = ".lisa-scratch-owner.json";
const GROUPING_VERSION = "mkdtemp-prefix-v1";
const temporaryDirectories: string[] = [];

/** Import the runner only after selecting a child process's platform temp root. */
const INJECTED_BIRTH_RUNNER = `
import { pathToFileURL } from "node:url";
const [script, root, artifact, nowMs, observation] = process.argv.slice(1);
process.env.TMPDIR = root;
process.env.TMP = root;
process.env.TEMP = root;
const { runTmpdirGrowth } = await import(pathToFileURL(script).href);
const birth = observation === "unavailable" ? undefined : observation;
process.exitCode = runTmpdirGrowth(
  ["--root", root, "--artifact", artifact, "--now-ms", nowMs],
  {
    processBirthFingerprintSnapshot: pids =>
      new Map(pids.map(pid => [pid, birth])),
  }
);
`;

/** Drive deterministic namespace churn after each bounded name scan. */
const INJECTED_NAMESPACE_CHURN_RUNNER = `
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
const [script, root, artifact, nowMs, childName, mode] = process.argv.slice(1);
process.env.TMPDIR = root;
process.env.TMP = root;
process.env.TEMP = root;
const { runTmpdirGrowth } = await import(pathToFileURL(script).href);
const child = path.join(root, "lisa-scratch", childName);
process.exitCode = runTmpdirGrowth(
  ["--root", root, "--artifact", artifact, "--now-ms", nowMs],
  {
    afterNamespaceScan: ({ phase }) => {
      if (phase === "before")
        fs.rmSync(child, { force: true, recursive: true });
      else if (mode === "persistent") fs.mkdirSync(child);
    },
  }
);
`;

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

/** Execute one measurement with a deterministic live-owner birth observation. */
function runMeasurementWithBirth(
  root: string,
  artifact: string,
  nowMs: number,
  observation: string
) {
  return boundedSpawnSync({
    label: "temp growth measurement with injected birth observation",
    command: process.execPath,
    args: [
      "--input-type=module",
      "--eval",
      INJECTED_BIRTH_RUNNER,
      SCRIPT,
      root,
      artifact,
      String(nowMs),
      observation,
    ],
    baseMs: 6_000,
    cwd: REPO_ROOT,
  });
}

/** Execute one measurement while a direct namespace child churns. */
function runMeasurementWithNamespaceChurn(
  root: string,
  artifact: string,
  nowMs: number,
  childName: string,
  mode: "transient" | "persistent"
) {
  return boundedSpawnSync({
    label: "temp growth measurement with injected namespace churn",
    command: process.execPath,
    args: [
      "--input-type=module",
      "--eval",
      INJECTED_NAMESPACE_CHURN_RUNNER,
      SCRIPT,
      root,
      artifact,
      String(nowMs),
      childName,
      mode,
    ],
    baseMs: 6_000,
    cwd: REPO_ROOT,
  });
}

/** Materialize one authority-valid owner record for a live process. */
function writeLiveOwner(root: string): void {
  const namespace = path.join(root, SCRATCH_NAMESPACE);
  const ownedRoot = path.join(
    namespace,
    `run-${String(process.pid)}-1000-birth-authority`
  );
  fs.mkdirSync(namespace, { mode: 0o700 });
  fs.mkdirSync(ownedRoot);
  const namespaceStat = fs.lstatSync(namespace);
  const rootStat = fs.lstatSync(ownedRoot);
  fs.writeFileSync(
    path.join(ownedRoot, OWNER_FILE),
    `${JSON.stringify({
      schema: 1,
      pid: process.pid,
      processBirthFingerprint: "linux:recorded",
      createdAt: "2026-08-27T00:00:00.000Z",
      token: "birth-authority-token",
      suiteLabel: "unit",
      registeredPrefixes: ["cdk.out"],
      namespace: {
        canonicalPath: fs.realpathSync(namespace),
        dev: namespaceStat.dev,
        ino: namespaceStat.ino,
      },
      root: {
        canonicalPath: fs.realpathSync(ownedRoot),
        dev: rootStat.dev,
        ino: rootStat.ino,
      },
    })}\n`,
    "utf8"
  );
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

  it.runIf(process.platform === "darwin")(
    "audits 1,025 deterministic owners in five real ps-forwarded batches",
    () => {
      const liveOwnerBirth = processBirthFingerprintSnapshot([process.pid]).get(
        process.pid
      );
      expect(liveOwnerBirth).toMatch(/^darwin:/u);
      if (liveOwnerBirth === undefined) {
        throw new Error(
          "Real Darwin live-owner birth authority is unavailable"
        );
      }
      const trace = darwinBirthBatchingEvidence(
        SCRIPT,
        directory => {
          temporaryDirectories.push(directory);
        },
        liveOwnerBirth
      );
      expect(trace).toEqual({
        inputCount: 1_025,
        observedCount: 1_025,
        batchSizes: [256, 256, 256, 256, 1],
        liveOwnerBirth,
      });
    }
  );

  it.runIf(process.platform === "darwin")(
    "records real 100k command-route timings and refuses a real over-cap root",
    () => {
      const trace = darwinTmpdirGrowthPerformance(SCRIPT, directory => {
        temporaryDirectories.push(directory);
      });
      const tracePath = path.join(
        temporaryDirectories[0] as string,
        "perf-trace.json"
      );
      fs.writeFileSync(
        tracePath,
        `${JSON.stringify(trace, null, 2)}\n`,
        "utf8"
      );
      const warmupReport = JSON.parse(trace.warmup.stdout);
      expect(trace.warmup).toEqual({
        root: {
          rootIndex: 0,
          canonicalPath: expect.any(String),
          dev: expect.any(Number),
          ino: expect.any(Number),
        },
        trial: 0,
        commandElapsedMs: expect.any(Number),
        budgetMs: 5_000,
        count: 100_000,
        created: 0,
        removed: 0,
        unreclaimed: 0,
        reportElapsedMs: null,
        rateEntriesPerDay: null,
        topPrefixes: [{ prefix: "entry-*", count: 100_000 }],
        ownership: {
          total: 0,
          owned: 0,
          live: 0,
          unowned: 0,
          created: 0,
          removed: 0,
          unreclaimed: 0,
          newlyUnowned: 0,
        },
        violations: [],
        artifact: {
          path: expect.any(String),
          snapshotCount: 1,
          latestEntryCount: 100_000,
          report: warmupReport,
        },
        status: 0,
        stdout: expect.any(String),
        stderr: "",
      });
      expect(trace.warmup.commandElapsedMs).toBeLessThanOrEqual(5_000);
      expect(warmupReport).toEqual(trace.warmup.artifact.report);
      expect(trace.measuredRootSchedule).toEqual([0, 1, 2, 0, 1]);
      expect(trace.trials).toHaveLength(5);
      expect(new Set(trace.trials.map(trial => trial.root.rootIndex))).toEqual(
        new Set([0, 1, 2])
      );
      expect(trace.trials.every(trial => trial.commandElapsedMs <= 5_000)).toBe(
        true
      );
      expect(
        trace.trials.every(
          trial =>
            trial.count === 100_000 &&
            trial.status === 0 &&
            trial.stderr === "" &&
            trial.artifact.latestEntryCount === 100_000
        )
      ).toBe(true);
      expect(JSON.parse(fs.readFileSync(tracePath, "utf8"))).toEqual(trace);
      const overCap = verifyDarwinTmpdirGrowthOverCap(SCRIPT, directory => {
        temporaryDirectories.push(directory);
      });
      expect(overCap).toEqual(
        expect.objectContaining({
          entryCount: 200_001,
          status: 2,
          validArtifactBytesPreserved: true,
          timeoutBehavior: "not-established",
        })
      );
    }
  );

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

  it("retries a namespace snapshot when a legitimate child disappears", () => {
    const paths = measurementPaths();
    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    const namespace = path.join(paths.root, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    fs.mkdirSync(path.join(namespace, "transient-child"));

    const result = runMeasurementWithNamespaceChurn(
      paths.root,
      paths.artifact,
      2_000,
      "transient-child",
      "transient"
    );

    expect(result.status).toBe(0);
    expect(readArtifact(paths.artifact).snapshots.at(-1).namespace.total).toBe(
      0
    );
  });

  it("preserves prior evidence when namespace churn never stabilizes", () => {
    const paths = measurementPaths();
    expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
    const priorBytes = fs.readFileSync(paths.artifact, "utf8");
    const namespace = path.join(paths.root, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    fs.mkdirSync(path.join(namespace, "churning-child"));

    const result = runMeasurementWithNamespaceChurn(
      paths.root,
      paths.artifact,
      2_000,
      "churning-child",
      "persistent"
    );

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/namespace.*stabil/iu);
    expect(fs.readFileSync(paths.artifact, "utf8")).toBe(priorBytes);
  });

  it.each([
    ["unavailable", "unavailable"],
    ["mismatched", "linux:observed-other"],
  ])(
    "fails closed when a live owner's birth authority is %s",
    (_label, observation) => {
      const paths = measurementPaths();
      expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
      const priorBytes = fs.readFileSync(paths.artifact, "utf8");
      writeLiveOwner(paths.root);

      const result = runMeasurementWithBirth(
        paths.root,
        paths.artifact,
        2_000,
        observation
      );

      expect(result.status).toBe(2);
      expect(`${result.stdout}${result.stderr}`).toMatch(
        /birth authority.*(?:unavailable|mismatch)/iu
      );
      expect(fs.readFileSync(paths.artifact, "utf8")).toBe(priorBytes);
    }
  );

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

  it.each(["malformed version", "partial snapshot"])(
    "leaves a supplied %s unchanged without treating an isolated valid control as recovery",
    corruption => {
      const paths = measurementPaths();
      expect(runMeasurement(paths.root, paths.artifact, 1_000).status).toBe(0);
      // This separate artifact is an isolation control, not a recovery generation.
      const isolatedControlBytes = fs.readFileSync(paths.artifact, "utf8");
      const suppliedArtifact = path.join(paths.container, "supplied.json");
      fs.copyFileSync(paths.artifact, suppliedArtifact);
      const value = readArtifact(suppliedArtifact);
      if (corruption === "malformed version") value.schemaVersion = 99;
      else value.snapshots[0].complete = false;
      const corrupted = `${JSON.stringify(value, null, 2)}\n`;
      fs.writeFileSync(suppliedArtifact, corrupted, "utf8");

      const result = runMeasurement(paths.root, suppliedArtifact, 2_000);

      expect(result.status).toBe(2);
      expect(fs.readFileSync(suppliedArtifact, "utf8")).toBe(corrupted);
      expect(fs.readFileSync(paths.artifact, "utf8")).toBe(
        isolatedControlBytes
      );
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
    "leaves supplied malformed persisted %s bytes unchanged without repair",
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

  it("leaves a valid rolling artifact byte-identical for invalid new observations", () => {
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

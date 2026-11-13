/** Synthetic controls for native shard integrity and the original guard judgment. */
import { describe, expect, it } from "vitest";
import {
  completeReportedFiles,
  identityHash,
  mergeBundles,
  mergeShardDirectories,
  nativeArgv,
  parseShard,
  RECOVERY_PREFIX,
  RERUN_ALL,
  RERUN_FAILED,
  sha256,
  strictTrace,
} from "../../../scripts/lib/shell-guard-shards.mjs";
import {
  judge,
  parseTrace,
} from "../../../scripts/lib/shell-guard-refusal-coverage.mjs";

const root = "/owned/checkout";
const DUPLICATE_FILE = "duplicate-file";
const INCOMPLETE_MANIFEST = "incomplete-manifest";
const guard = {
  path: "plugins/src/base/hooks/probe.sh",
  sha256: "a".repeat(64),
  size: 128,
  canRefuse: true,
  toolBoundary: true,
};
const candidates = ["a", "b", "c"].map(name => ({
  path: `tests/${name}.test.ts`,
  sha256: "b".repeat(64),
}));
function fixtures() {
  const fixtureCandidates = structuredClone(candidates);
  const fixturePopulation = [structuredClone(guard)];
  const snapshot = {
    head: "c".repeat(40),
    tree: "d".repeat(40),
    provider: {
      runId: "123",
      attempt: "1",
      sourceSha: "c".repeat(40),
      prHead: "e".repeat(40),
      workflowRef:
        "owner/repo/.github/workflows/plugins-sync.yml@refs/pull/1/merge",
    },
    candidates: fixtureCandidates,
    candidateHash: identityHash(fixtureCandidates),
    population: fixturePopulation,
    populationHash: identityHash(fixturePopulation),
    scriptHashes: {
      "scripts/tracer.mjs": "f".repeat(64),
      "bun.lock": "f".repeat(64),
      "vitest.config.local.ts": "f".repeat(64),
    },
    runtime: { node: "synthetic fixture identity" },
  };
  const bundles = fixtureCandidates.map((candidate, index) => {
    const name = `${root}/${candidate.path}`;
    const reportRaw = JSON.stringify({
      success: true,
      numFailedTests: 0,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      numTotalTestSuites: 2,
      numTotalTests: 1,
      testResults: [
        {
          name,
          status: "passed",
          assertionResults: [{ status: "passed", failureMessages: [] }],
        },
      ],
    });
    const terminalRaw = JSON.stringify({
      schema: 1,
      complete: true,
      reason: "passed",
      unhandledErrorCount: 0,
      startedFiles: fixtureCandidates.map(row => `${root}/${row.path}`),
      queuedFiles: [name],
      collectedFiles: [name],
      files: [
        {
          name,
          moduleState: "passed",
          tests: 1,
          complete: true,
          tasks: [
            { type: "suite", mode: "run", state: "pass" },
            { type: "test", mode: "run", state: "pass" },
          ],
          cases: [{ name: "synthetic case", mode: "run", state: "passed" }],
        },
      ],
    });
    const traceRaw =
      index === 2
        ? ""
        : `${JSON.stringify({
            script: guard.path,
            sha256: guard.sha256,
            status: index === 0 ? 0 : 2,
            origin: "",
          })}\n`;
    const shard = { index: index + 1, total: 3 };
    const artifactRoot = `/owned/trace-${shard.index}`;
    const child = {
      command: `${root}/node_modules/.bin/vitest`,
      argv: nativeArgv(root, artifactRoot, shard, fixtureCandidates),
      status: 0 as number | null,
      signal: null as string | null,
      error: null as string | null,
      startedAt: "2000-01-01T00:00:00.000Z",
      endedAt: "2000-01-01T00:00:01.000Z",
    };
    const indexRaw = JSON.stringify({
      byHash: { ["a".repeat(64)]: [guard.path] },
      sizes: [128],
    });
    const executionRaw = JSON.stringify(child),
      stdoutRaw = "synthetic stdout",
      stderrRaw = "";
    const manifest = {
      schema: 1,
      complete: true,
      snapshot: structuredClone(snapshot),
      shard,
      checkoutRoot: root,
      artifactRoot,
      producerJob: "guard-trace",
      child,
      rawHashes: {
        "guard-index.json": sha256(indexRaw),
        "execution.json": sha256(executionRaw),
        "stdout.log": sha256(stdoutRaw),
        "stderr.log": sha256(stderrRaw),
      },
      traceSha256: sha256(traceRaw),
      reportSha256: sha256(reportRaw),
      terminalSha256: sha256(terminalRaw),
      reportedFiles: [candidate.path],
      reportedFileCount: 1,
    };
    return {
      manifest,
      reportRaw,
      terminalRaw,
      traceRaw,
      indexRaw,
      executionRaw,
      stdoutRaw,
      stderrRaw,
    };
  });
  return { snapshot, bundles };
}
type Bundle = ReturnType<typeof fixtures>["bundles"][number];
type Report = {
  numPendingTests?: number;
  numPendingTestSuites?: number;
  testResults: Array<{ assertionResults: Array<{ status: string }> }>;
};
type Terminal = {
  reason: string;
  unhandledErrorCount: number;
  startedFiles: string[];
  queuedFiles: string[];
  collectedFiles: string[];
  files: Array<{
    tasks: Array<{ type: string; mode: string; state: string }>;
    cases: Array<{ name: string; mode: string; state: string }>;
  }>;
};
const mutateReport = (bundle: Bundle, change: (value: Report) => void) => {
  const value = JSON.parse(bundle.reportRaw) as Report;
  change(value);
  bundle.reportRaw = JSON.stringify(value);
  bundle.manifest.reportSha256 = sha256(bundle.reportRaw);
};
const mutateTerminal = (bundle: Bundle, change: (value: Terminal) => void) => {
  const value = JSON.parse(bundle.terminalRaw) as Terminal;
  change(value);
  bundle.terminalRaw = JSON.stringify(value);
  bundle.manifest.terminalSha256 = sha256(bundle.terminalRaw);
};
const rebindChild = (
  bundle: Bundle,
  fullCandidates = bundle.manifest.snapshot.candidates
) => {
  bundle.manifest.child.argv = nativeArgv(
    root,
    bundle.manifest.artifactRoot,
    bundle.manifest.shard,
    fullCandidates
  );
  bundle.executionRaw = JSON.stringify(bundle.manifest.child);
  bundle.manifest.rawHashes["execution.json"] = sha256(bundle.executionRaw);
};

describe("complete native shard provenance", () => {
  it("owns each fixture candidate array, rows and guard records", () => {
    const first = fixtures(),
      second = fixtures();
    first.snapshot.candidates[0]!.path = "tests/changed.test.ts";
    first.snapshot.candidates.push({
      path: "tests/d.test.ts",
      sha256: "b".repeat(64),
    });
    first.snapshot.population[0]!.sha256 = "0".repeat(64);
    expect(second.snapshot.candidates.map(row => row.path)).toEqual([
      "tests/a.test.ts",
      "tests/b.test.ts",
      "tests/c.test.ts",
    ]);
    expect(second.snapshot.population[0]!.sha256).toBe("a".repeat(64));
    expect(second.bundles).toHaveLength(3);
  });
  it("merges split allow/refusal once and allows an empty individual shard", () => {
    const { snapshot, bundles } = fixtures();
    const report = judge({
      population: snapshot.population,
      observed: parseTrace(mergeBundles(snapshot, bundles)),
    });
    expect(report.driven).toBe(1);
    expect(report.findings).toEqual([]);
  });
  it.each(["1/2", "0/3", "4/3", "garbage"])(
    "rejects invalid native shard %s",
    value => expect(() => parseShard(value)).toThrow()
  );
  it.each([
    "missing",
    "duplicate",
    "stale-head",
    "stale-tree",
    "stale-run",
    "later-attempt",
    "stale-sourceSha",
    "stale-prHead",
    "stale-workflow",
    "stale-script-hash",
    "stale-lock",
    "stale-config",
    "stale-runtime",
    "stale-population",
    "stale-candidates",
    "bad-digest",
    "failed",
    "killed",
    "never-started",
    "wrong-producer",
    "wrong-argv",
    "wrong-clock",
    INCOMPLETE_MANIFEST,
  ])("refuses %s", mode => {
    const { snapshot, bundles } = fixtures();
    const first = bundles[0]!;
    if (mode === "missing") bundles.pop();
    if (mode === "duplicate") {
      bundles[1]!.manifest.shard.index = 1;
      rebindChild(bundles[1]!);
    }
    if (mode === "stale-head") first.manifest.snapshot.head = "0".repeat(40);
    if (mode === "stale-tree") first.manifest.snapshot.tree = "0".repeat(40);
    // #4634: an OLDER attempt of this run is legitimate; a later one is not.
    if (mode === "later-attempt")
      first.manifest.snapshot.provider.attempt = "2";
    if (mode === "stale-run") first.manifest.snapshot.provider.runId = "124";
    if (mode === "stale-sourceSha")
      first.manifest.snapshot.provider.sourceSha = "0".repeat(40);
    if (mode === "stale-prHead")
      first.manifest.snapshot.provider.prHead = "0".repeat(40);
    if (mode === "stale-workflow")
      first.manifest.snapshot.provider.workflowRef = "wrong/workflow";
    if (mode === "stale-script-hash")
      first.manifest.snapshot.scriptHashes["scripts/tracer.mjs"] = "0".repeat(
        64
      );
    if (mode === "stale-lock")
      first.manifest.snapshot.scriptHashes["bun.lock"] = "0".repeat(64);
    if (mode === "stale-config")
      first.manifest.snapshot.scriptHashes["vitest.config.local.ts"] =
        "0".repeat(64);
    if (mode === "stale-runtime")
      first.manifest.snapshot.runtime.node = "wrong";
    if (mode === "stale-population")
      first.manifest.snapshot.population[0]!.sha256 = "0".repeat(64);
    if (mode === "stale-candidates") first.manifest.snapshot.candidates.pop();
    if (mode === "bad-digest") first.manifest.traceSha256 = "0".repeat(64);
    if (mode === "failed") first.manifest.child.status = 1;
    if (mode === "killed") first.manifest.child.signal = "SIGTERM";
    if (mode === "never-started") first.manifest.child.status = null;
    if (mode === "wrong-producer") first.manifest.producerJob = "wrong";
    if (mode === "wrong-argv")
      first.manifest.child.argv.push("--testNamePattern=narrowed");
    if (mode === "wrong-clock") first.manifest.child.endedAt = "not a date";
    if (mode === INCOMPLETE_MANIFEST) first.manifest.complete = false;
    // #4634: every refusal also tells the operator which re-run recovers it.
    expect(() => mergeBundles(snapshot, bundles)).toThrow(
      mode === "duplicate"
        ? /duplicate shard identity[\s\S]*Re-run all jobs/u
        : /Re-run (?:failed|all) jobs/u
    );
  });
  it.each([
    "narrowed-index",
    "changed-stdout",
    "changed-stderr",
    "changed-execution",
  ])("rejects %s raw artifact", mode => {
    const { snapshot, bundles } = fixtures();
    const first = bundles[0]!;
    if (mode === "narrowed-index") {
      first.indexRaw = JSON.stringify({ byHash: {}, sizes: [] });
      first.manifest.rawHashes["guard-index.json"] = sha256(first.indexRaw);
    }
    if (mode === "changed-stdout") first.stdoutRaw += "changed";
    if (mode === "changed-stderr") first.stderrRaw += "changed";
    if (mode === "changed-execution") {
      first.executionRaw = "{}";
      first.manifest.rawHashes["execution.json"] = sha256(first.executionRaw);
    }
    expect(() => mergeBundles(snapshot, bundles)).toThrow(
      /shard 1 attempt 1[\s\S]*Re-run all jobs/u
    );
  });
  it.each([
    "pending-json",
    "pending-lifecycle",
    "interrupted",
    "unhandled-errors",
    "missing-queued",
    "missing-collected",
    "extra-started",
    DUPLICATE_FILE,
    "missing-file",
    "malformed-json",
    "malformed-terminal",
  ])("refuses %s even with rehashed receipts", mode => {
    const { snapshot, bundles } = fixtures();
    const first = bundles[0]!;
    if (mode === "pending-json")
      mutateReport(
        first,
        value => (value.testResults[0]!.assertionResults[0]!.status = "pending")
      );
    if (mode === "pending-lifecycle")
      mutateTerminal(
        first,
        value => (value.files[0]!.tasks[1]!.state = "queued")
      );
    if (mode === "interrupted")
      mutateTerminal(first, value => (value.reason = "interrupted"));
    if (mode === "unhandled-errors")
      mutateTerminal(first, value => (value.unhandledErrorCount = 1));
    if (mode === "missing-queued")
      mutateTerminal(first, value => (value.queuedFiles = []));
    if (mode === "missing-collected")
      mutateTerminal(first, value => (value.collectedFiles = []));
    if (mode === "extra-started")
      mutateTerminal(first, value =>
        value.startedFiles.push(`${root}/tests/extra.test.ts`)
      );
    if (mode === DUPLICATE_FILE) {
      bundles[1]! = structuredClone(first);
      bundles[1]!.manifest.shard.index = 2;
      rebindChild(bundles[1]!);
    }
    if (mode === "missing-file") {
      mutateReport(first, value => (value.testResults = []));
    }
    if (mode === "malformed-json") {
      first.reportRaw = "broken";
      first.manifest.reportSha256 = sha256(first.reportRaw);
    }
    if (mode === "malformed-terminal") {
      first.terminalRaw = "broken";
      first.manifest.terminalSha256 = sha256(first.terminalRaw);
    }
    expect(() => mergeBundles(snapshot, bundles)).toThrow(
      mode === DUPLICATE_FILE
        ? /duplicate reported file across shards/
        : undefined
    );
  });
  it("refuses a missing completed file despite three individually valid nonempty shards", () => {
    const { snapshot, bundles } = fixtures();
    snapshot.candidates.push({
      path: "tests/d.test.ts",
      sha256: "b".repeat(64),
    });
    snapshot.candidateHash = identityHash(snapshot.candidates);
    for (const bundle of bundles) {
      bundle.manifest.snapshot = structuredClone(snapshot);
      rebindChild(bundle, snapshot.candidates);
      mutateTerminal(
        bundle,
        value =>
          (value.startedFiles = snapshot.candidates.map(
            row => `${root}/${row.path}`
          ))
      );
    }
    expect(() => mergeBundles(snapshot, bundles)).toThrow(
      "missing/extra candidate files"
    );
  });
  it("preserves real planned skips/todos and nested-suite counters", () => {
    const { bundles } = fixtures();
    const first = bundles[0]!;
    mutateReport(first, value => {
      value.numPendingTests = 1;
      value.numPendingTestSuites = 1;
      value.testResults[0]!.assertionResults[0]!.status = "todo";
    });
    mutateTerminal(first, value => {
      value.files[0]!.tasks[1]! = { type: "test", mode: "todo", state: "todo" };
      value.files[0]!.cases[0]! = {
        name: "planned todo",
        mode: "todo",
        state: "skipped",
      };
    });
    expect(
      completeReportedFiles(
        root,
        JSON.parse(first.reportRaw),
        JSON.parse(first.terminalRaw)
      )
    ).toEqual(["tests/a.test.ts"]);
  });
  it.each(["malformed", "unknown", "wrong-hash", "invalid-status"])(
    "strictly refuses %s trace",
    mode => {
      const record = {
        script: guard.path,
        sha256: guard.sha256,
        status: 0,
        origin: "",
      };
      if (mode === "unknown") record.script = "unknown.sh";
      if (mode === "wrong-hash") record.sha256 = "0".repeat(64);
      if (mode === "invalid-status") record.status = 300;
      expect(() =>
        strictTrace(mode === "malformed" ? "broken" : JSON.stringify(record), [
          guard,
        ])
      ).toThrow();
    }
  );
  it("preserves repeats and nullable status without inventing refusal", () => {
    const row = JSON.stringify({
      script: guard.path,
      sha256: guard.sha256,
      status: null,
      origin: "",
    });
    const raw = strictTrace(`${row}\n${row}`, [guard]);
    const report = judge({ population: [guard], observed: parseTrace(raw) });
    expect(report.findings.some(f => f.kind === "no-allow-control")).toBe(true);
    expect(report.findings.some(f => f.kind === "no-refusal-case")).toBe(true);
  });
  it.each([{ statuses: [0] }, { statuses: [2] }, { statuses: [0, 1] }])(
    "original judge still bites on %j",
    ({ statuses }) => {
      const raw = statuses
        .map(status =>
          JSON.stringify({
            script: guard.path,
            sha256: guard.sha256,
            status,
            origin: "",
          })
        )
        .join("\n");
      expect(
        judge({
          population: [guard],
          observed: parseTrace(strictTrace(raw, [guard])),
        }).findings.length
      ).toBeGreaterThan(0);
    }
  );
  it("all-empty merged trace retains original zero-observation operational refusal", () => {
    const { snapshot, bundles } = fixtures();
    for (const bundle of bundles) {
      bundle.traceRaw = "";
      bundle.manifest.traceSha256 = sha256("");
    }
    const report = judge({
      population: snapshot.population,
      observed: parseTrace(mergeBundles(snapshot, bundles)),
    });
    expect(report.driven).toBe(0); // Original CLI's exit2 path remains unchanged.
  });
});

/**
 * #4634: a failed-jobs re-run is a new attempt that rebuilds only the failed
 * shard, so the merge must take the newest COMPLETE bundle per shard across
 * every attempt of the current run, and every refusal must name the shard,
 * the attempt, and the re-run that recovers it.
 */
describe("shard bundles across Actions attempts (#4634)", () => {
  const dirName = (attempt: number, shard: number, runId = "123") =>
    `lisa-shell-guard-${runId}-${attempt}-shard-${shard}`;
  /** Copy a fixture bundle as though `attempt` produced it. */
  const atAttempt = (bundle: Bundle, attempt: number) => {
    const copy = structuredClone(bundle);
    copy.manifest.snapshot.provider.attempt = String(attempt);
    return copy;
  };
  const entry = (attempt: number, bundle: Bundle, runId = "123") => ({
    name: dirName(attempt, bundle.manifest.shard.index, runId),
    read: () => bundle,
  });
  /** A failed shard uploads logs and execution.json but no manifest.json. */
  const failedEntry = (attempt: number, shard: number) => ({
    name: dirName(attempt, shard),
    read: () => null,
  });
  /** The fixtures as the merge job of `attempt` sees them. */
  const currentAt = (attempt: number) => {
    const { snapshot, bundles } = fixtures();
    snapshot.provider.attempt = String(attempt);
    return { snapshot, bundles };
  };

  it("merges attempt-1 shards 1 and 2 with the attempt-2 re-run of shard 3", () => {
    const { snapshot, bundles } = currentAt(2);
    const result = mergeShardDirectories(snapshot, [
      entry(1, atAttempt(bundles[0]!, 1)),
      entry(1, atAttempt(bundles[1]!, 1)),
      entry(2, atAttempt(bundles[2]!, 2)),
    ]);
    expect(result.selected.map(row => [row.index, row.attempt])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
    const report = judge({
      population: snapshot.population,
      observed: parseTrace(result.trace),
    });
    expect(report.driven).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("refuses attempt-2 shard 3 alone, naming shards 1 and 2 and the recovery", () => {
    const { snapshot, bundles } = currentAt(2);
    expect(() =>
      mergeShardDirectories(snapshot, [entry(2, atAttempt(bundles[2]!, 2))])
    ).toThrow(/shard 1, shard 2[\s\S]*Re-run failed jobs/u);
  });

  it("uses the complete attempt-2 shard 3 beside the failed attempt-1 shard 3 diagnostics", () => {
    const { snapshot, bundles } = currentAt(2);
    const result = mergeShardDirectories(snapshot, [
      entry(1, atAttempt(bundles[0]!, 1)),
      entry(1, atAttempt(bundles[1]!, 1)),
      failedEntry(1, 3),
      entry(2, atAttempt(bundles[2]!, 2)),
    ]);
    expect(result.selected.find(row => row.index === 3)?.attempt).toBe(2);
  });

  it("refuses a bundle downloaded from a different run", () => {
    const { snapshot, bundles } = currentAt(2);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, atAttempt(bundles[0]!, 1)),
        entry(1, atAttempt(bundles[1]!, 1)),
        entry(2, atAttempt(bundles[2]!, 2), "999"),
      ])
    ).toThrow(/shard 3 attempt 2[\s\S]*run 999[\s\S]*Re-run all jobs/u);
  });

  it.each([
    ["runId", "999"],
    ["sourceSha", "0".repeat(40)],
    ["prHead", "0".repeat(40)],
    ["workflowRef", "wrong/workflow"],
  ] as const)(
    "refuses a chosen bundle whose recorded %s differs from the current run",
    (field, value) => {
      const { snapshot, bundles } = currentAt(2);
      const stale = atAttempt(bundles[0]!, 1);
      stale.manifest.snapshot.provider[field] = value;
      expect(() =>
        mergeShardDirectories(snapshot, [
          entry(1, stale),
          entry(1, atAttempt(bundles[1]!, 1)),
          entry(2, atAttempt(bundles[2]!, 2)),
        ])
      ).toThrow(
        new RegExp(
          `shard 1 attempt 1[\\s\\S]*${field}[\\s\\S]*Re-run all jobs`,
          "u"
        )
      );
    }
  );

  it.each(["no-manifest", INCOMPLETE_MANIFEST, "failed-child"])(
    "refuses an incomplete newest bundle (%s) rather than falling back to an older attempt",
    mode => {
      const { snapshot, bundles } = currentAt(2);
      const newest = atAttempt(bundles[2]!, 2);
      if (mode === INCOMPLETE_MANIFEST) newest.manifest.complete = false;
      if (mode === "failed-child") newest.manifest.child.status = 1;
      expect(() =>
        mergeShardDirectories(snapshot, [
          entry(1, atAttempt(bundles[0]!, 1)),
          entry(1, atAttempt(bundles[1]!, 1)),
          entry(1, atAttempt(bundles[2]!, 1)),
          mode === "no-manifest" ? failedEntry(2, 3) : entry(2, newest),
        ])
      ).toThrow(/shard 3 attempt 2[\s\S]*Re-run failed jobs/u);
    }
  );

  it("refuses two directories claiming the same shard and attempt", () => {
    const { snapshot, bundles } = currentAt(1);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, bundles[0]!),
        entry(1, bundles[1]!),
        entry(1, bundles[2]!),
        entry(1, bundles[2]!),
      ])
    ).toThrow(/duplicate[\s\S]*shard 3 attempt 1[\s\S]*Re-run all jobs/u);
  });

  it("refuses a bundle whose recorded attempt differs from its directory name", () => {
    const { snapshot, bundles } = currentAt(2);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, atAttempt(bundles[0]!, 1)),
        entry(1, atAttempt(bundles[1]!, 1)),
        entry(2, atAttempt(bundles[2]!, 1)),
      ])
    ).toThrow(
      /shard 3 attempt 2[\s\S]*records attempt 1[\s\S]*Re-run all jobs/u
    );
  });

  it("refuses a bundle from a later attempt than the merge job's own", () => {
    const { snapshot, bundles } = currentAt(1);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, bundles[0]!),
        entry(1, bundles[1]!),
        entry(2, atAttempt(bundles[2]!, 2)),
      ])
    ).toThrow(/shard 3 attempt 2[\s\S]*Re-run all jobs/u);
  });

  it("refuses a chosen older-attempt bundle built from a different runtime, asking for a full re-run", () => {
    const { snapshot, bundles } = currentAt(2);
    const stale = atAttempt(bundles[0]!, 1);
    stale.manifest.snapshot.runtime.node = "older runner image";
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, stale),
        entry(1, atAttempt(bundles[1]!, 1)),
        entry(2, atAttempt(bundles[2]!, 2)),
      ])
    ).toThrow(/shard 1 attempt 1[\s\S]*Re-run all jobs/u);
  });

  it("compares attempts numerically, so attempt 10 beats attempt 9", () => {
    const { snapshot, bundles } = currentAt(10);
    const result = mergeShardDirectories(snapshot, [
      entry(1, atAttempt(bundles[0]!, 1)),
      entry(1, atAttempt(bundles[1]!, 1)),
      failedEntry(9, 3),
      entry(10, atAttempt(bundles[2]!, 10)),
    ]);
    expect(result.selected.find(row => row.index === 3)?.attempt).toBe(10);
  });

  it("builds every recovery hint from the one prefix recoverable() keys on", () => {
    expect(RERUN_FAILED.startsWith(RECOVERY_PREFIX)).toBe(true);
    expect(RERUN_ALL.startsWith(RECOVERY_PREFIX)).toBe(true);
  });

  it("does not double-wrap a refusal that already carries a recovery hint", () => {
    const { snapshot, bundles } = currentAt(2);
    let message = "";
    try {
      mergeShardDirectories(snapshot, [
        entry(1, atAttempt(bundles[0]!, 1)),
        entry(1, atAttempt(bundles[1]!, 1)),
        {
          name: dirName(2, 3),
          read: () => {
            throw new Error(`already explained. ${RERUN_FAILED}`);
          },
        },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`already explained. ${RERUN_FAILED}`);
  });

  it("names the shard and attempt when a chosen bundle's files cannot be read", () => {
    const { snapshot, bundles } = currentAt(2);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, atAttempt(bundles[0]!, 1)),
        entry(1, atAttempt(bundles[1]!, 1)),
        {
          name: dirName(2, 3),
          read: () => {
            throw new Error("missing/link/oversized artifact");
          },
        },
      ])
    ).toThrow(
      /shard 3 attempt 2: missing\/link\/oversized artifact[\s\S]*Re-run all jobs/u
    );
  });

  it("refuses a directory that is not a shard bundle of this run", () => {
    const { snapshot, bundles } = currentAt(1);
    expect(() =>
      mergeShardDirectories(snapshot, [
        entry(1, bundles[0]!),
        entry(1, bundles[1]!),
        entry(1, bundles[2]!),
        { name: "something-else", read: () => null },
      ])
    ).toThrow(/something-else[\s\S]*Re-run all jobs/u);
  });
});

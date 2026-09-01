/** Closed-evidence and hostile-input tests for CodySwannGT/lisa#3304. */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BASELINE_DRAWS,
  MEASUREMENT_SCHEMA_VERSION,
  aggregateMeasurements,
  canonicalMutantIdentity,
  createDigestManifest,
  overlayMeasurementReporters,
  resolveArtifactPath,
  validateMeasurement,
} from "../../../scripts/mutation-performance-measure.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const digest = "a".repeat(64);
const timestamp = "2026-08-26T00:00:00.000Z";
const WARM_LOCAL = "warm-local";
const SOURCE_PATH = "src/grade.ts";
const SUMMARY_JSON = "summary.json";

const valid = (stack = "vitest", draw = 1, mode = "cold") => ({
  schema_version: MEASUREMENT_SCHEMA_VERSION,
  conclusion: "measurement-only",
  identity: {
    subject_sha: "b".repeat(40),
    tree_sha: "c".repeat(40),
    package_sha256: digest,
    package_version: "4.22.13",
    stack,
    runner_family: stack,
    fixture_schema: "fixture/v1",
    fixture_sha256: digest,
    host_base_sha: "d".repeat(40),
    host_head_sha: "e".repeat(40),
    run_id: "123",
    job_id: "456",
    run_attempt: 1,
    ubuntu_image: "ubuntu-24.04",
    node_version: "22.22.0",
    bun_version: "1.3.11",
    npm_version: "10.9.4",
    stryker_version: "9.6.1",
    runner_version: "9.6.1",
    lock_sha256: digest,
    package_json_sha256: digest,
    runner_sha256: digest,
    raw_config_sha256: digest,
    effective_config_sha256: digest,
    gate_sha256: digest,
    workflow_sha256: digest,
    source_sha256: digest,
    test_sha256: digest,
  },
  protocol: {
    role: "baseline",
    draw,
    mode,
    started_at: timestamp,
    finished_at: timestamp,
    invalid_reasons: [],
    cold_parent_summary_sha256: mode === WARM_LOCAL ? digest : null,
    cold_parent_incremental_sha256: mode === WARM_LOCAL ? digest : null,
  },
  selection: {
    merge_base: "d".repeat(40),
    head: "e".repeat(40),
    changed_paths: [SOURCE_PATH],
    mutate_files: [SOURCE_PATH],
    tests: [
      {
        file: "tests/grade.test.ts",
        name: "names a high grade",
        location: "1:1",
      },
    ],
    mutants: [
      {
        file: SOURCE_PATH,
        mutator: "ConditionalExpression",
        start: "1:1",
        end: "1:7",
        replacement_sha256: digest,
      },
    ],
  },
  phases_ms: {
    install: 100,
    runner_setup: 10,
    instrumentation: 10,
    dry_run: 20,
    plan: 10,
    mutation: 40,
    reporting: 5,
    teardown: 5,
    end_to_end: 200,
    clock_tolerance: 0,
  },
  resources: {
    detected_cpus: 4,
    peak_cpu_pct: 50,
    median_cpu_pct: 25,
    peak_rss_bytes: 1000,
    peak_process_count: 2,
    sample_count: 2,
  },
  results: {
    statuses: {
      Killed: 1,
      Survived: 0,
      NoCoverage: 0,
      Timeout: 0,
      Ignored: 0,
      CompileError: 0,
      RuntimeError: 0,
      Pending: 0,
    },
    expected_total: 1,
    observed_total: 1,
    thresholds: { high: 80, low: 60, break: 60 },
    reported_score: 100,
    timeout_recomputed_score: 100,
    exit_code: 0,
    signal: null,
    verdict: "passed",
    named_survivors: [],
  },
  cache: {
    incremental_configured: true,
    before_exists: false,
    before_sha256: null,
    after_exists: true,
    after_sha256: digest,
    cold_parent_identity: mode === WARM_LOCAL ? digest : null,
    disposition: mode === WARM_LOCAL ? "diagnostic-local-reuse" : "cold-empty",
    remote_read: false,
    remote_write: false,
  },
  cleanup: {
    root_pid: 42,
    root_birth_tick: "99",
    signal_forwarded: null,
    kill_reason: null,
    descendant_survivors: 0,
    sandbox_entries_before: 0,
    sandbox_entries_after: 0,
    sampler_healthy: true,
  },
  digests: {
    phase_events_sha256: digest,
    process_samples_sha256: digest,
    selection_sha256: digest,
    stryker_report_sha256: digest,
    runner_log_sha256: digest,
    host_manifest_sha256: digest,
  },
});

describe("measurement evidence", () => {
  it("accepts a complete closed v1 cold draw", () => {
    expect(validateMeasurement(valid())).toEqual({ valid: true, reasons: [] });
  });

  it.each([
    [
      "unknown field",
      (v: any) => {
        v.extra = true;
      },
    ],
    [
      "wrong version",
      (v: any) => {
        v.schema_version = "v0";
      },
    ],
    [
      "mixed head",
      (v: any) => {
        v.selection.head = "f".repeat(40);
      },
    ],
    [
      "empty selection",
      (v: any) => {
        v.selection.mutants = [];
        v.results.expected_total = 0;
        v.results.observed_total = 0;
      },
    ],
    [
      "duplicate mutant",
      (v: any) => {
        v.selection.mutants.push(v.selection.mutants[0]);
        v.results.expected_total = 2;
        v.results.observed_total = 2;
      },
    ],
    [
      "pending result",
      (v: any) => {
        v.results.statuses.Killed = 0;
        v.results.statuses.Pending = 1;
      },
    ],
    [
      "remote cache",
      (v: any) => {
        v.cache.remote_read = true;
      },
    ],
    [
      "cold residue",
      (v: any) => {
        v.cache.before_exists = true;
        v.cache.before_sha256 = digest;
      },
    ],
    [
      "sampler death",
      (v: any) => {
        v.cleanup.sampler_healthy = false;
      },
    ],
    [
      "surviving process",
      (v: any) => {
        v.cleanup.descendant_survivors = 1;
      },
    ],
    [
      "phase mismatch",
      (v: any) => {
        v.phases_ms.end_to_end = 199;
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const candidate: any = structuredClone(valid());
    mutate(candidate);
    expect(validateMeasurement(candidate).valid).toBe(false);
  });

  it("canonicalizes the stable mutant identity without Stryker numeric IDs", () => {
    expect(
      canonicalMutantIdentity({
        fileName: "src/a.ts",
        mutatorName: "BooleanLiteral",
        location: {
          start: { line: 1, column: 2 },
          end: { line: 1, column: 6 },
        },
        replacement: "false",
      })
    ).toBe(
      "src/a.ts\u0000BooleanLiteral\u00001:2\u00001:6\u0000fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa"
    );
  });

  it("allows exactly reporting-only config overlay", () => {
    const source = {
      testRunner: "vitest",
      mutate: ["src/**/*.ts"],
      thresholds: { break: 60 },
      reporters: ["clear-text"],
    };
    const overlaid = overlayMeasurementReporters(
      source,
      path.join(process.cwd(), "reporter.mjs"),
      path.join(process.cwd(), "report.json")
    );
    expect(overlaid).toMatchObject({
      testRunner: "vitest",
      mutate: source.mutate,
      thresholds: source.thresholds,
    });
    expect(overlaid.reporters).toEqual([
      "clear-text",
      "json",
      "lisa-measurement",
    ]);
    const stripped: any = structuredClone(overlaid);
    delete stripped.reporters;
    delete stripped.jsonReporter;
    delete stripped.appendPlugins;
    const expected: any = structuredClone(source);
    delete expected.reporters;
    expect(stripped).toEqual(expected);
  });

  it("requires three unique valid cold draws per stack and refuses ambiguity", () => {
    const rows = ["vitest", "jest"].flatMap(stack =>
      BASELINE_DRAWS.map(draw => valid(stack, draw))
    );
    expect(aggregateMeasurements(rows).conclusion).toBe("measurement-only");
    expect(() => aggregateMeasurements(rows.slice(1))).toThrow(
      /three valid cold draws/u
    );
    expect(() => aggregateMeasurements([...rows, rows[0]])).toThrow(
      /duplicate/u
    );
  });

  it("confines artifact paths and hashes a non-recursive manifest", () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".lisa-measure-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, SUMMARY_JSON), "{}\n");
    expect(resolveArtifactPath(root, SUMMARY_JSON)).toBe(
      path.join(root, SUMMARY_JSON)
    );
    expect(() => resolveArtifactPath(root, "../escape")).toThrow(/outside/u);
    const manifest = createDigestManifest(root, [SUMMARY_JSON]);
    expect(manifest).toEqual({
      [SUMMARY_JSON]: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(manifest).not.toHaveProperty("evidence-digests.json");
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildKanePilotReport,
  executeKanePilot,
  parseKanePilotManifest,
  type KanePilotManifest,
  type KanePilotRecord,
} from "../../../src/core/kane-pilot.js";
import type { KaneRunResult } from "../../../src/core/kane-cli.js";

const NOW = new Date("2026-07-19T12:00:00.000Z");

const manifest: KanePilotManifest = {
  version: 1,
  startedAt: "2026-06-18T12:00:00.000Z",
  applications: [
    {
      name: "app-a",
      projectRoot: "apps/a",
      environment: "staging",
      cases: [
        {
          id: "sign-in",
          objective: "Sign in and verify the dashboard",
          url: "https://a.example.test",
          baselineSeconds: 100,
        },
      ],
    },
    {
      name: "app-b",
      projectRoot: "apps/b",
      environment: "preview",
      cases: [
        {
          id: "checkout",
          objective: "Complete a test checkout",
          url: "https://b.example.test",
          baselineSeconds: 80,
        },
      ],
    },
  ],
  resultsFile: "kane-results.jsonl",
  maximumCreditsPerRun: 4,
  policyReview: {
    reviewedAt: NOW.toISOString(),
    incidents: 0,
  },
};

/**
 * Build one successful longitudinal fixture record.
 * @param index - Fixture sequence index
 * @returns Successful pilot record
 */
function record(index: number): KanePilotRecord {
  return {
    timestamp: NOW.toISOString(),
    application: index % 2 === 0 ? "app-a" : "app-b",
    caseId: index % 2 === 0 ? "sign-in" : "checkout",
    outcome: "passed",
    durationSeconds: index % 2 === 0 ? 50 : 40,
    baselineSeconds: index % 2 === 0 ? 100 : 80,
    credits: 2,
    evidenceCaptured: true,
    evidenceComplete: true,
    policyIncident: false,
  };
}

describe("Kane pilot", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "lisa-kane-pilot-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("requires two downstream applications and a safe results path", () => {
    expect(() =>
      parseKanePilotManifest({
        ...manifest,
        applications: [manifest.applications[0]],
      })
    ).toThrow("at least two");
    expect(() =>
      parseKanePilotManifest({ ...manifest, resultsFile: "../escape.jsonl" })
    ).toThrow("safe relative path");
  });

  it("stays collecting before the longitudinal sample is mature", () => {
    const report = buildKanePilotReport(manifest, [record(0), record(1)], NOW);

    expect(report.verdict).toBe("collecting");
    expect(report.reasons[0]).toContain("50 runs");
  });

  it("requires an exterior policy review covering the full pilot window", () => {
    const records = Array.from({ length: 50 }, (_, index) => record(index));
    const withoutReview: KanePilotManifest = {
      version: manifest.version,
      startedAt: manifest.startedAt,
      applications: manifest.applications,
      resultsFile: manifest.resultsFile,
      maximumCreditsPerRun: 4,
    };

    const report = buildKanePilotReport(withoutReview, records, NOW);

    expect(report.verdict).toBe("collecting");
    expect(report.reasons[0]).toContain("exterior policy review");
  });

  it("adopts only after all quantitative gates pass", () => {
    const records = Array.from({ length: 50 }, (_, index) => record(index));

    expect(buildKanePilotReport(manifest, records, NOW)).toMatchObject({
      verdict: "adopt",
      totalRuns: 50,
      daysElapsed: 31,
      evidenceCapturePercent: 100,
      providerFailurePercent: 0,
      inconsistentVerdictPercent: 0,
      timeReductionPercent: 50,
      evidenceCompletenessPercent: 100,
      policyIncidents: 0,
      averageCreditsPerRun: 2,
    });
  });

  it("rejects a mature sample when a policy incident is recorded", () => {
    const records = Array.from({ length: 50 }, (_, index) => record(index));
    records[0] = { ...records[0]!, policyIncident: true };

    const report = buildKanePilotReport(manifest, records, NOW);

    expect(report.verdict).toBe("reject");
    expect(report.reasons).toContain("policy incidents detected");
  });

  it("uses the median rather than the average time reduction", () => {
    const records = Array.from({ length: 50 }, (_, index) => ({
      ...record(index),
      durationSeconds: index === 0 ? 1000 : 40,
      baselineSeconds: 100,
    }));

    const report = buildKanePilotReport(manifest, records, NOW);

    expect(report.timeReductionPercent).toBe(60);
  });

  it("executes one sweep through the adapter and appends JSONL evidence", async () => {
    const manifestPath = path.join(tempDir, "pilot.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result: KaneRunResult = {
      outcome: "passed",
      exitCode: 0,
      terminal: {
        type: "run_end",
        status: "passed",
        duration: 30,
        credits: 1,
        test_url: "https://app.testmu.ai/test/1",
      },
      progressCount: 1,
      parseWarnings: [],
      confirmedProductBug: false,
      evidencePack: ".lisa/evidence/run.zip",
      stderr: "",
    };
    const runner = vi.fn(async () => result);

    const report = await executeKanePilot(manifestPath, runner);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ verdict: "collecting", totalRuns: 2 });
    const lines = (
      await readFile(path.join(tempDir, manifest.resultsFile), "utf8")
    )
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      application: "app-a",
      evidenceCaptured: true,
      evidenceComplete: true,
    });
  });
});

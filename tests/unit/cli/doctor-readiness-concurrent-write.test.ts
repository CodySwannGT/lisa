/**
 * Two concurrent writers must not blend into one readiness report.
 *
 * `persistReadinessReport` writes a temp file and renames it into place, and
 * its docblock states the property that buys: "so a reader never observes a
 * partial document." The rename IS atomic. What was not atomic is the content
 * being renamed.
 *
 * With a deterministic `${reportPath}.tmp`, two `lisa doctor` runs in one
 * checkout open the SAME temp path. Both truncate it, both write from offset
 * zero, and their chunks interleave. Worse, once the first writer renames, the
 * second writer's file descriptor still points at that inode — which is now
 * the report itself — so the tail of run B lands inside the document run A
 * just published. The result still looks like a file, frequently still parses,
 * and describes a repository state that neither run ever observed.
 *
 * That is not a hypothetical here: six agents ran against this repository
 * concurrently on 2026-08-24, and concurrent doctor invocations across
 * worktrees are the normal operating mode.
 *
 * These tests RACE rather than inspect. Asserting that the temp path contains a
 * UUID would prove the string changed, not that the corruption is prevented —
 * the same happy-path shape as the green-but-inert guards this campaign spent
 * itself removing. So each test drives real concurrent writers at one path and
 * reads back what a reader would actually see.
 * @module tests/unit/cli/doctor-readiness-concurrent-write
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  persistReadinessReport,
  READINESS_SCHEMA_VERSION,
  type ReadinessReport,
} from "../../../src/cli/doctor-readiness.js";

let workspace = "";

/** The report path every racer in this file targets, relative to the workspace. */
const REPORT_RELATIVE_PATH = path.join(".lisa", "readiness.json");

/**
 * Build a readiness report whose serialized form is large enough that two
 * concurrent writes interleave rather than each completing in one atomic
 * chunk.
 *
 * The size is the load-bearing part. A short document can be written in a
 * single `write(2)` and two racers may serialize by luck, which would make this
 * suite pass against the broken code some fraction of the time — a flaky test
 * that reports the bug is absent. Padding each record past the point where the
 * kernel must split the write removes that luck.
 * @param marker A single character stamped through every padded field.
 * @returns A report whose every dimension finding is stamped with the marker.
 */
function bulkyReport(marker: string): ReadinessReport {
  const padding = marker.repeat(64_000);
  return {
    schema_version: READINESS_SCHEMA_VERSION,
    generated_at: "2026-08-24T00:00:00.000Z",
    lisa_version: `1.0.0-${marker}`,
    worker_signature: `host/model/${marker}`,
    verdict: "SHIP",
    narrowed_claim: null,
    blockers: [],
    blocker_count: 0,
    dimensions: Array.from({ length: 12 }, (_, index) => ({
      id: `dimension-${index}`,
      status: "PASS" as const,
      findings: [{ reason: padding, skip: false }],
    })),
  } as unknown as ReadinessReport;
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-readiness-race-"));
});

afterEach(() => {
  fs.removeSync(workspace);
});

describe("persistReadinessReport under concurrency", () => {
  it("publishes one whole document, never a blend of two concurrent runs", async () => {
    const reportPath = path.join(workspace, REPORT_RELATIVE_PATH);

    // Started together and awaited together. Interleaving is the whole point;
    // awaiting them in sequence would test nothing this file exists for.
    await Promise.all([
      persistReadinessReport(reportPath, bulkyReport("A")),
      persistReadinessReport(reportPath, bulkyReport("B")),
    ]);

    const published = fs.readFileSync(reportPath, "utf8");

    // A blended document carries padding from BOTH runs. Whichever run won,
    // exactly one marker may appear in the padding.
    const hasA = published.includes("A".repeat(1_000));
    const hasB = published.includes("B".repeat(1_000));
    expect(hasA || hasB).toBe(true);
    expect(hasA && hasB).toBe(false);
  });

  it("publishes a document that still parses, and equals one of the two runs", async () => {
    const reportPath = path.join(workspace, REPORT_RELATIVE_PATH);
    const runA = bulkyReport("A");
    const runB = bulkyReport("B");

    await Promise.all([
      persistReadinessReport(reportPath, runA),
      persistReadinessReport(reportPath, runB),
    ]);

    const published = fs.readFileSync(reportPath, "utf8");

    // The failure this guards is silent: a blended file frequently still
    // parses, so "it is valid JSON" is necessary and nowhere near sufficient.
    // The report must be one of the two documents, byte for byte.
    const candidates = [runA, runB].map(
      report => `${JSON.stringify(report, null, 2)}\n`
    );
    expect(candidates).toContain(published);
  });

  it("leaves no temp file behind for either run", async () => {
    const reportPath = path.join(workspace, REPORT_RELATIVE_PATH);

    await Promise.all([
      persistReadinessReport(reportPath, bulkyReport("A")),
      persistReadinessReport(reportPath, bulkyReport("B")),
    ]);

    // A unique temp name is only half the fix if the loser's file survives:
    // `.lisa/` is a committed directory, so an orphaned temp is a stray file a
    // consumer would commit.
    const dir = path.dirname(reportPath);
    const strays = fs
      .readdirSync(dir)
      .filter(entry => entry !== path.basename(reportPath));
    expect(strays).toEqual([]);
  });

  it("survives many concurrent writers, not just two", async () => {
    const reportPath = path.join(workspace, REPORT_RELATIVE_PATH);
    const markers = ["A", "B", "C", "D", "E", "F"];

    await Promise.all(
      markers.map(marker =>
        persistReadinessReport(reportPath, bulkyReport(marker))
      )
    );

    const published = fs.readFileSync(reportPath, "utf8");
    const present = markers.filter(marker =>
      published.includes(marker.repeat(1_000))
    );

    // Exactly one run's padding, whichever won the rename.
    expect(present).toHaveLength(1);
  });
});

/** Lifecycle tests for the O(1), write-once measurement reporter. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LisaMeasurementReporter } from "../../../scripts/lib/mutation-performance-reporter.mjs";

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("LisaMeasurementReporter", () => {
  it("retains lifecycle evidence in memory and atomically writes once at wrapUp", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-reporter-"));
    roots.push(root);
    const output = path.join(root, "events.json");
    const reporter = new LisaMeasurementReporter({
      outputFile: output,
      now: (() => {
        let n = 0;
        return () => new Date(n++ * 10).toISOString();
      })(),
    });
    reporter.onDryRunCompleted({
      tests: [
        {
          id: "1",
          name: "names grade",
          fileName: "tests/grade.test.ts",
          location: { line: 1, column: 1 },
        },
      ],
      timing: { net: 7, overhead: 3 },
    });
    reporter.onMutationTestReportReady({ mutants: [{ id: "9" }] });
    await reporter.wrapUp();
    const evidence = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(evidence.dry_run_ms).toBe(10);
    expect(evidence.tests).toEqual([
      { file: "tests/grade.test.ts", name: "names grade", location: "1:1" },
    ]);
    expect(evidence.plan_count).toBe(1);
    expect(evidence.finished_at).toBeTruthy();
    expect(fs.existsSync(`${output}.tmp`)).toBe(false);
    await expect(reporter.wrapUp()).rejects.toThrow(/already written/u);
  });

  it("does no per-mutant reporting I/O", () => {
    expect(LisaMeasurementReporter.prototype).not.toHaveProperty(
      "onMutantTested"
    );
  });
});

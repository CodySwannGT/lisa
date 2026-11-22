/** Native host work keeps its full budget inside the unchanged case margin. */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  nativeUnitDeadlineMs,
  run,
} from "../../fixtures/shared-runtime-hosts/process.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await cleanupTempDir(root);
});

describe("generated host native work deadline", () => {
  it("is the full work budget now that no fleet admission wait precedes it", () => {
    expect(nativeUnitDeadlineMs(75_000, 375_000)).toBe(75_000);
  });

  it("refuses a nonfinite or over-margin budget rather than hiding it", () => {
    for (const [work, margin] of [
      [Number.POSITIVE_INFINITY, 375_000],
      [0, 375_000],
      [400_000, 375_000],
      [75_000, Number.NaN],
    ] as const)
      expect(() => nativeUnitDeadlineMs(work, margin)).toThrow(/Native unit/u);
  });

  it("gives an actual child the explicit work deadline", async () => {
    const root = await createTempDir();
    roots.push(root);
    // A real plain Node timer, not a mocked clock.
    await run(
      process.execPath,
      ["-e", 'setTimeout(() => console.log("actual-child-completed"), 200)'],
      root,
      { ...process.env },
      root,
      "native-deadline-control",
      100,
      ioLatencyBudgetMs(5_000)
    );
    const log = fs.readFileSync(
      path.join(root, "native-deadline-control.log"),
      "utf8"
    );
    expect(log).toContain("actual-child-completed");
    expect(log).toContain("exit=0 signal=null");
  });
});

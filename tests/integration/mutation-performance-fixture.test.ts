/** Generic, identity-free controls used by the mutation measurement harness. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { runObservedCommand } from "../../scripts/mutation-performance-measure.mjs";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(__dirname, "../..");
const fixture = (stack: string, relative: string): string =>
  path.join(ROOT, "tests/fixtures/mutation-performance", stack, relative);

describe("mutation performance fixtures", () => {
  it.each(["vitest", "jest"])(
    "keeps a named known survivor in the %s fixture",
    stack => {
      const source = readFileSync(fixture(stack, "src/grade.ts"), "utf8");
      const test = readFileSync(fixture(stack, "tests/grade.test.ts"), "utf8");
      expect(source).toContain("KNOWN_SURVIVOR_BOUNDARY");
      expect(test).toContain("KNOWN_SURVIVOR_BOUNDARY");
      expect(test).toContain("does not assert the boundary value");
    }
  );

  it("the sampler test child really leaves a grandchild for the harness to reap", () => {
    const probe = execFileSync(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},30)']);console.log(c.pid);setTimeout(()=>{},30)",
      ],
      { timeout: 2000, encoding: "utf8" }
    );
    expect(Number.parseInt(probe.trim(), 10)).toBeGreaterThan(1);
  });

  it.runIf(process.platform === "linux")(
    "samples and reaps a detached grandchild by PID birth identity",
    async () => {
      const output = path.join(
        process.env.RUNNER_TEMP ?? "/tmp",
        `lisa-sampler-${process.pid}-${Date.now()}`
      );
      const result = await runObservedCommand({
        cwd: ROOT,
        output,
        deadlineMs: 10_000,
        args: [
          "-e",
          "const {spawn}=require('child_process');spawn(process.execPath,['-e','setTimeout(()=>{},10000)']);setTimeout(()=>process.exit(0),1500)",
        ],
      });
      expect(result.resources.sample_count).toBeGreaterThanOrEqual(2);
      expect(result.cleanup.sampler_healthy).toBe(true);
      expect(result.cleanup.descendant_survivors).toBe(0);
      expect(
        readFileSync(path.join(output, "process-samples.jsonl"), "utf8")
      ).not.toContain("argv");
    },
    ioLatencyBudgetMs(15_000)
  );
});

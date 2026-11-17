/**
 * @file kane-cli-process.test.ts
 * @description Pins how a Kane child process is run and settled: both streams
 * captured whole, the exit code passed through, a spawn failure reported on
 * standard error, and the deadline reported as exit code 3.
 * @module core
 */
import { execPath } from "node:process";

import { describe, expect, it } from "vitest";

import { runKaneCommand } from "../../../src/core/kane-cli-process.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const OPTIONS = { cwd: __dirname, env: {}, timeoutMs: 30_000 } as const;

describe("runKaneCommand", () => {
  it(
    "captures both streams and the exit code",
    async () => {
      const result = await runKaneCommand(
        execPath,
        [
          "-e",
          "process.stdout.write('out'); process.stderr.write('err'); process.exit(4)",
        ],
        OPTIONS
      );
      expect(result).toEqual({ exitCode: 4, stdout: "out", stderr: "err" });
    },
    ioLatencyBudgetMs(30_000)
  );

  it(
    "reports a spawn failure on standard error",
    async () => {
      const result = await runKaneCommand(
        "/nonexistent/kane-binary",
        [],
        OPTIONS
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ENOENT");
      expect(result.exitCode).not.toBe(0);
    },
    ioLatencyBudgetMs(30_000)
  );

  it(
    "kills a child that outlives the deadline and reports exit code 3",
    async () => {
      const result = await runKaneCommand(
        execPath,
        ["-e", "process.stdout.write('started'); setTimeout(() => {}, 60000)"],
        { ...OPTIONS, timeoutMs: 1_000 }
      );
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toBe("started");
    },
    ioLatencyBudgetMs(30_000)
  );
});

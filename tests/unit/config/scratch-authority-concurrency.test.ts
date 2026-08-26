/** Multi-process proof that namespace establishment converges under a mkdir race. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/scratch-authority-concurrent.ts"
);
const PROCESS_COUNT = 64;
/** 64 real Node startups scale with the same machine latency this test measures. */
const CONCURRENCY_CASE_BUDGET_MS = ioLatencyBudgetMs(60_000);
const temporaryDirectories: string[] = [];
const activeChildren: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of activeChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/** One child outcome collected without dropping its diagnostics. */
interface ChildOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Collect a child process through its natural close event.
 * @param child - Spawned namespace contender
 * @returns Exit status and complete output
 */
function collectChild(
  child: ChildProcessWithoutNullStreams
): Promise<ChildOutcome> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise(resolve => {
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

/**
 * Wait until every contender has reached the shared barrier.
 * @param readyPrefix - Per-process ready-marker prefix
 */
async function waitUntilReady(readyPrefix: string): Promise<void> {
  const parent = path.dirname(readyPrefix);
  const prefix = path.basename(readyPrefix);
  const deadline = Date.now() + ioLatencyBudgetMs(30_000);
  while (Date.now() < deadline) {
    if (
      fs.readdirSync(parent).filter(name => name.startsWith(`${prefix}-`))
        .length === PROCESS_COUNT
    ) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Namespace contenders did not reach their shared barrier");
}

describe("concurrent scratch namespace establishment", () => {
  it(
    "converges 64 synchronized processes on one real directory identity",
    async () => {
      const base = fs.mkdtempSync(path.join(tmpdir(), "authority-race-"));
      const ready = path.join(base, "ready");
      const start = path.join(base, "start");
      temporaryDirectories.push(base);
      const children = Array.from({ length: PROCESS_COUNT }, () => {
        return spawn(process.execPath, ["--import", "tsx", FIXTURE], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            LISA_CONCURRENT_SCRATCH_BASE: base,
            LISA_CONCURRENT_SCRATCH_COUNT: String(PROCESS_COUNT),
            LISA_CONCURRENT_SCRATCH_READY: ready,
            LISA_CONCURRENT_SCRATCH_START: start,
            TMPDIR: base,
            TMP: base,
            TEMP: base,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
      });
      activeChildren.push(...children);
      const outcomes = children.map(collectChild);

      await waitUntilReady(ready);
      fs.writeFileSync(start, "start", "utf8");
      const completed = await Promise.all(outcomes);
      const diagnostics = completed
        .map(outcome => outcome.stderr)
        .filter(Boolean)
        .join("\n");

      expect(
        completed.map(outcome => outcome.status),
        diagnostics
      ).toEqual(Array.from({ length: PROCESS_COUNT }, () => 0));
      const identities = completed.map(outcome => {
        const value = JSON.parse(outcome.stdout) as {
          readonly dev: number;
          readonly ino: number;
        };
        return `${String(value.dev)}:${String(value.ino)}`;
      });
      expect(new Set(identities).size).toBe(1);
    },
    CONCURRENCY_CASE_BUDGET_MS
  );
});

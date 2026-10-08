/** Multi-process proof that namespace establishment converges under a mkdir race. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import {
  isProcessAlive,
  OPAQUE_CONTROL,
  REPO_ROOT,
  startGrandchildTestRun,
  startWaitingTestRun,
  testRunCompanionPids,
  waitForTestRun,
} from "../../helpers/lisa-test-run-process.js";
import { verifyForegroundSigkillRecovery } from "../../helpers/lisa-test-run-sigkill-oracle.js";
import { processBirthFingerprint } from "../../../src/configs/vitest/scratch-owner.js";
import {
  verifyGatedAuthorityImmutability,
  verifyGatedReadinessFailureCleanup,
  verifyStoppedReaperAssertionCleanup,
} from "../../helpers/lisa-test-run-readiness-oracles.js";

const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/scratch-authority-concurrent.ts"
);
const PROCESS_COUNT = 64;
/** 64 real Node startups scale with the same machine latency this test measures. */
const CONCURRENCY_CASE_BUDGET_MS = ioLatencyBudgetMs(60_000);
const temporaryDirectories: string[] = [];
const registerTestRunDirectory = (directory: string): void => {
  temporaryDirectories.push(directory);
};
const activeChildren: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of activeChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("lisa-test-run descendant lifecycle", () => {
  it("observes both born companions after a late native observer", async () => {
    const run = await startGrandchildTestRun(
      process.env,
      registerTestRunDirectory,
      "grandchild-sigkill",
      child => {
        const before = testRunCompanionPids(child.pid ?? -1).map(pid => ({
          pid,
          birth: processBirthFingerprint(pid),
        }));
        expect(before).toHaveLength(2);
        expect(before.every(value => value.birth !== undefined)).toBe(true);
        const started = performance.now();
        const delayed = boundedSpawnSync({
          label: "late native companion observer",
          command: process.execPath,
          // Cross the original 500ms outcome and 2s group drain before observing.
          args: ["-e", "setTimeout(() => process.exit(0), 3000)"],
          baseMs: 6_000,
        });
        expect(delayed.status).toBe(0);
        expect(performance.now() - started).toBeGreaterThanOrEqual(2_500);
        const after = testRunCompanionPids(child.pid ?? -1).map(pid => ({
          pid,
          birth: processBirthFingerprint(pid),
        }));
        expect(after).toEqual(before);
      }
    );
    try {
      run.release();
      expect(await run.outcome).toEqual({ code: null, signal: "SIGKILL" });
      expect(fs.existsSync(run.root)).toBe(false);
      expect(isProcessAlive(run.descendantPid)).toBe(false);
      expect(run.companionPids.every(pid => !isProcessAlive(pid))).toBe(true);
    } finally {
      if (isProcessAlive(run.descendantPid))
        process.kill(run.descendantPid, "SIGKILL");
      if (run.child.pid !== undefined && isProcessAlive(run.child.pid))
        run.child.kill("SIGTERM");
    }
  });

  it("uses the exact prearmed reaper after foreground SIGKILL", async () => {
    await verifyForegroundSigkillRecovery(registerTestRunDirectory);
  });

  it("drains a held payload when companion observation refuses", async () => {
    const failure = new Error("companion observation refused");
    const observed: {
      child: ReturnType<typeof spawn>;
      root: string;
      companions: readonly number[];
    }[] = [];
    try {
      await expect(
        startGrandchildTestRun(
          process.env,
          registerTestRunDirectory,
          "grandchild-pass",
          child => {
            const base = temporaryDirectories.at(-1);
            if (base === undefined)
              throw new Error("owned fixture base missing");
            const payload = JSON.parse(
              fs.readFileSync(path.join(base, "payload.json"), "utf8")
            ) as { root: string };
            observed.push({
              child,
              root: payload.root,
              companions: testRunCompanionPids(child.pid ?? -1),
            });
            throw failure;
          }
        )
      ).rejects.toBe(failure);
      expect(observed).toHaveLength(1);
      expect(fs.existsSync(observed[0]!.root)).toBe(false);
      expect(observed[0]!.companions.every(pid => !isProcessAlive(pid))).toBe(
        true
      );
    } finally {
      for (const run of observed) {
        if (run.child.pid !== undefined && isProcessAlive(run.child.pid))
          run.child.kill("SIGTERM");
        await waitForTestRun(
          () =>
            !fs.existsSync(run.root) &&
            run.companions.every(pid => !isProcessAlive(pid)),
          "refused observation cleanup"
        );
      }
    }
  });

  it.each([
    "assert",
    "extra-owned-process",
    "forged-pid",
    "json",
    "mismatched-root",
    "owner",
    "ps",
  ] as const)("cleans a gated run after %s readiness failure", async fault => {
    await verifyGatedReadinessFailureCleanup(registerTestRunDirectory, fault);
  });

  it("rejects every overwrite of published cleanup authority", async () => {
    await verifyGatedAuthorityImmutability(registerTestRunDirectory);
  });

  it("resumes the exact stopped reaper before assertion-failure teardown", async () => {
    await verifyStoppedReaperAssertionCleanup(registerTestRunDirectory);
  });

  it("keeps the payload environment out of bootstrap process arguments", async () => {
    const run = await startWaitingTestRun(
      process.env,
      registerTestRunDirectory
    );
    const inventory = boundedSpawnSync({
      label: "opaque bootstrap process inventory",
      command: "/bin/ps",
      args: ["-p", run.companionPids.join(","), "-o", "command="],
      baseMs: 2_000,
    });
    const exposed = inventory.stdout.includes(OPAQUE_CONTROL);
    const exited = new Promise<void>(resolve =>
      run.child.once("exit", () => resolve())
    );
    run.child.kill("SIGTERM");
    await exited;
    await waitForTestRun(
      () => run.companionPids.every(pid => !isProcessAlive(pid)),
      "opaque-control companion exit"
    );
    expect(exposed).toBe(false);
  });

  it.each([
    ["grandchild-pass", { code: 0, signal: null }],
    ["grandchild-fail", { code: 23, signal: null }],
    ["grandchild-sigkill", { code: null, signal: "SIGKILL" }],
  ] as const)(
    "drains an unref'ed payload descendant after %s",
    async (mode, expected) => {
      const run = await startGrandchildTestRun(
        process.env,
        registerTestRunDirectory,
        mode
      );
      try {
        run.release();
        expect(await run.outcome).toEqual(expected);
        expect(fs.existsSync(run.root)).toBe(false);
        expect(isProcessAlive(run.descendantPid)).toBe(false);
        expect(run.companionPids.every(pid => !isProcessAlive(pid))).toBe(true);
      } finally {
        if (isProcessAlive(run.descendantPid))
          process.kill(run.descendantPid, "SIGKILL");
        if (run.child.pid !== undefined && isProcessAlive(run.child.pid)) {
          run.child.kill("SIGTERM");
        }
      }
    }
  );
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

/** Real-process helpers for the AWS CDK scratch lifecycle contract. */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  readScratchOwnerRecord,
  scratchPathIdentity,
  type ScratchOwnerRecordV1,
  type ScratchPathIdentity,
} from "../../src/configs/vitest/scratch-owner.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  workerSpawnSlowdown,
} from "./io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;
const { env: PROCESS_ENVIRONMENT } = process;
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const WRAPPER_PID_ENV = "LISA_CDK_SYNTH_WRAPPER_PID";
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/cdk-synth-case.ts"
);
const TEST_RUNNER_ARGS = [
  "--import",
  "tsx",
  TEST_RUNNER,
  "--profile",
  "cdk",
  "--adapter",
  "vitest",
] as const;

/**
 * Quiet-box budget for one whole nested runner: tsx, lisa-test-run, a complete
 * Vitest, and a real CDK synth.
 *
 * WHY THIS IS SO MUCH LARGER THAN THE WORK IT GUARDS. One arm costs about three
 * seconds on an idle machine, so 30s already looked like tenfold headroom — and
 * on CI every arm was killed at 52.6s, still running, with nothing wrong.
 *
 * `ioLatencyBudgetMs` scales a quiet-box budget by this worker's measured SPAWN
 * latency, sampled from five quick spawns. That is the right instrument for a
 * child whose cost IS spawning. This child's cost is a nested Vitest doing CPU
 * work while the parent suite's own workers saturate the box, and five quick
 * spawns cannot see core contention: CI measured 1.75x — nowhere near the 8x
 * ceiling that is supposed to be the "this box is not worth a green" signal —
 * while the guarded work ran more than twenty times its local cost.
 *
 * So the scaler is not wrong, it is measuring the wrong thing, in exactly the
 * sense `fsLatencyBudgetMs` already documents for deletion-dominated
 * work: "a spawn-derived budget is measuring something the hook never does."
 * Until a contention-aware scaler exists, the compensation belongs in the
 * quiet-box base, where it is at least visible and explained.
 *
 * THIS IS A CEILING, NOT A COST. Passing arms return in seconds and never
 * approach it. It is deliberately NOT set by raising `MAX_SPAWN_SLOWDOWN`,
 * which would be wrong twice over: that ceiling exists to fail a genuinely slow
 * box, and this box measured 1.75x, so raising it would not have helped anyway.
 */
const CDK_RUNNER_BUDGET_MS = 120_000;

/**
 * Quiet-box budget for waiting on a marker from an already-started worker.
 *
 * Two thirds of {@link CDK_RUNNER_BUDGET_MS}: the wait begins after the child
 * is spawned, so it covers the same nested boot without the spawn itself.
 */
const CDK_MARKER_BUDGET_MS = 90_000;

/** Complete result of one synchronous real-CDK arm. */
export interface CdkRunResult {
  readonly run: SpawnSyncReturns<string>;
  readonly assembly: string | undefined;
  readonly scratchBase: string;
  /**
   * What the child actually did, for use as an assertion message.
   *
   * A missing marker has several causes that the marker's absence cannot tell
   * apart: the budget expired and `spawnSync` killed the child, the child died
   * on its own, or it ran to completion and simply wrote nothing. Bare
   * `expect(assembly).toBeDefined()` reports "expected undefined to be defined"
   * for all three, which is why a CI-only failure here was unreadable from the
   * log. `killSignal` is SIGKILL, so a budget kill is indistinguishable from
   * the deliberate `sigkill` arm on the signal alone — the status, the error
   * and the child's own stderr are the only things that separate them.
   */
  readonly diagnosis: string;
}

/** Observable process result collected from the wrapper's OS exit event. */
export interface CdkProcessOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** One live real-CDK wrapper and its terminal observation. */
export interface WaitingCdkRun {
  readonly child: ChildProcess;
  readonly marker: string;
  readonly outcome: Promise<CdkProcessOutcome>;
}

/** Immutable filesystem authority for one live sibling worker and run. */
export interface LiveCdkRunControl {
  readonly assembly: string;
  readonly runIdentity: ScratchPathIdentity;
  readonly runOwner: ScratchOwnerRecordV1;
  readonly sentinel: string;
  readonly workerIdentity: ScratchPathIdentity;
  readonly workerOwner: ScratchOwnerRecordV1;
}

/**
 * Write a public CDK Vitest configuration for one isolated arm.
 * @param target - Configuration path
 * @returns The written configuration path
 */
function writeCdkConfig(target: string): string {
  fs.writeFileSync(
    target,
    `import { getCdkVitestConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/configs/vitest/cdk.ts"))};\n` +
      `const config = getCdkVitestConfig();\n` +
      `export default { ...config, test: { ...config.test, include: [${JSON.stringify(FIXTURE)}] } };\n`,
    "utf8"
  );
  return target;
}

/**
 * Build the exact public runner argv for one generated configuration.
 * @param config - Generated Vitest configuration
 * @returns Source-wrapper and real-Vitest argv
 */
function cdkArguments(config: string): readonly string[] {
  return [
    ...TEST_RUNNER_ARGS,
    "--",
    process.execPath,
    path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
    "run",
    "--root",
    REPO_ROOT,
    "--config",
    config,
  ];
}

/**
 * Environment for one isolated real-CDK lifecycle arm.
 * @param base - Shared platform temporary root
 * @param marker - Parent-owned assembly marker
 * @param arm - Fixture lifecycle arm
 * @returns Exact child environment
 */
function cdkEnvironment(
  base: string,
  marker: string,
  arm: string
): NodeJS.ProcessEnv {
  return {
    ...PROCESS_ENVIRONMENT,
    TMPDIR: base,
    TMP: base,
    TEMP: base,
    LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(["cdk.out"]),
    LISA_TEST_SCRATCH_SUITE: "cdk",
    LISA_CDK_SYNTH_ARM: arm,
    LISA_CDK_SYNTH_MARKER: marker,
  };
}

/**
 * Run one real CDK synth arm through the public stack configuration.
 * @param arm - Fixture lifecycle arm
 * @param base - Optional shared scratch base
 * @returns Child outcome and observed assembly path
 */
export function runCdk(arm: string, base?: string): CdkRunResult {
  const scratchBase = base ?? fs.mkdtempSync(path.join(tmpdir(), "cdk-life-"));
  const marker = path.join(scratchBase, `marker-${arm}`);
  const config = path.join(scratchBase, `vitest-${arm}.config.ts`);
  const run = spawnSync(
    "/bin/sh",
    [
      "-c",
      `export ${WRAPPER_PID_ENV}=$$; exec "$@"`,
      "lisa-cdk-wrapper",
      process.execPath,
      ...cdkArguments(writeCdkConfig(config)),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: cdkEnvironment(scratchBase, marker, arm),
      killSignal: "SIGKILL",
      maxBuffer: NODE_DEFAULT_MAX_BUFFER,
      timeout: ioLatencyBudgetMs(CDK_RUNNER_BUDGET_MS),
    }
  );
  if (run.error !== undefined && run.signal === null) {
    throw new Error(`real CDK synth ${arm} failed: ${run.error.message}`, {
      cause: run.error,
    });
  }
  return {
    run,
    assembly: fs.existsSync(marker)
      ? fs.readFileSync(marker, "utf8")
      : undefined,
    scratchBase,
    diagnosis: describeCdkRun(arm, run),
  };
}

/**
 * Describe what one arm's child did, in terms that separate its failure modes.
 *
 * Deliberately names the budget alongside the outcome. The budget is scaled by
 * this worker's measured spawn slowdown, capped at `MAX_SPAWN_SLOWDOWN`, and a
 * box past that cap is expected to fail rather than be given more room — so
 * "was it slow, or was it broken?" is the first question a reader has, and the
 * message should answer it without a second CI run.
 * @param arm - Fixture lifecycle arm
 * @param run - The finished child
 * @returns One-line cause, with a stderr tail when the child said anything
 */
function describeCdkRun(arm: string, run: SpawnSyncReturns<string>): string {
  const budget = ioLatencyBudgetMs(CDK_RUNNER_BUDGET_MS);
  const stderr = (run.stderr ?? "").trim().split("\n").slice(-8).join("\n");
  return [
    `real CDK synth arm "${arm}" wrote no assembly marker.`,
    `status=${String(run.status)} signal=${String(run.signal)}`,
    `error=${run.error === undefined ? "none" : run.error.message}`,
    `budget=${budget}ms (${CDK_RUNNER_BUDGET_MS}ms base x ${workerSpawnSlowdown()}x measured slowdown)`,
    stderr === "" ? "child stderr was empty" : `child stderr tail:\n${stderr}`,
  ].join(" ");
}

/**
 * Start one real CDK worker that remains live until its wrapper is signalled.
 * @param base - Test-owned shared platform temporary root
 * @param label - Unique marker/config label
 * @returns Live wrapper and preattached OS terminal observation
 */
export function startWaitingCdkRun(base: string, label: string): WaitingCdkRun {
  const marker = path.join(base, `${label}-marker`);
  const config = path.join(base, `${label}-vitest.config.ts`);
  const child = spawn(process.execPath, cdkArguments(writeCdkConfig(config)), {
    cwd: REPO_ROOT,
    env: cdkEnvironment(base, marker, "whole-sigkill"),
    stdio: "ignore",
  });
  const outcome = new Promise<CdkProcessOutcome>(resolve => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, marker, outcome };
}

/**
 * Wait for a complete assembly marker from a live CDK worker.
 * @param marker - Parent-owned marker path
 * @param child - The worker being waited on, so a timeout can report whether it
 *   was still running at the deadline or had already exited
 * @returns Real assembly directory
 */
export async function waitForCdkAssembly(
  marker: string,
  child?: ChildProcess
): Promise<string> {
  const budget = ioLatencyBudgetMs(CDK_MARKER_BUDGET_MS);
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    if (fs.existsSync(marker)) return fs.readFileSync(marker, "utf8");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  // A live child and a dead one produce the same silence here, and the two
  // want opposite investigations: still running means the budget was short,
  // already exited means the worker failed before it could write.
  const fate =
    child === undefined
      ? "child not supplied"
      : child.exitCode === null && child.signalCode === null
        ? "child still running at the deadline, so it was too slow rather than broken"
        : `child already exited: code=${String(child.exitCode)} signal=${String(child.signalCode)}`;
  throw new Error(
    `CDK assembly marker did not appear: ${path.basename(marker)} ` +
      `after ${budget}ms (${CDK_MARKER_BUDGET_MS}ms base x ${workerSpawnSlowdown()}x measured slowdown). ${fate}`
  );
}

/**
 * Resolve the real Vitest child of one lisa-test-run wrapper.
 * @param wrapperPid - Live wrapper PID
 * @returns Vitest PID beneath the bootstrap process
 */
export async function waitForVitestPid(wrapperPid: number): Promise<number> {
  const deadline = Date.now() + ioLatencyBudgetMs(CDK_MARKER_BUDGET_MS);
  while (Date.now() < deadline) {
    const rows = boundedSpawnSync({
      label: "CDK wrapper process inventory",
      command: "/bin/ps",
      args: ["-axo", "pid=,ppid=,command="],
      baseMs: 2_000,
    })
      .stdout.split("\n")
      .map(row => row.trim().split(/\s+/u));
    const bootstrap = rows.find(
      fields =>
        Number(fields[1]) === wrapperPid &&
        fields.some(field => field.includes("lisa-test-run-bootstrap"))
    );
    const vitest = rows.find(
      fields =>
        Number(fields[1]) === Number(bootstrap?.[0]) &&
        fields.some(field => field.includes("vitest"))
    );
    if (vitest !== undefined) return Number(vitest[0]);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Real CDK Vitest process did not become observable");
}

/**
 * Capture immutable owner, inode, token, and sentinel facts for a live run.
 * @param assembly - Live CDK assembly directory
 * @returns Pinned suite/worker authority and usable sentinel
 */
export function captureLiveCdkRun(assembly: string): LiveCdkRunControl {
  const workerRoot = path.dirname(assembly);
  const workerOwner = readScratchOwnerRecord(workerRoot);
  const runRoot = workerOwner.namespace.canonicalPath;
  const sentinel = path.join(assembly, "live-sibling-sentinel.txt");
  fs.writeFileSync(sentinel, "live sibling before kill\n", "utf8");
  return {
    assembly,
    runIdentity: scratchPathIdentity(runRoot),
    runOwner: readScratchOwnerRecord(runRoot),
    sentinel,
    workerIdentity: scratchPathIdentity(workerRoot),
    workerOwner,
  };
}

/**
 * Bound failure teardown for a still-live real-CDK wrapper.
 * @param run - Wrapper and its preattached terminal observation
 */
export async function stopWaitingCdkRun(run: WaitingCdkRun): Promise<void> {
  const controller = new AbortController();
  const timeout = delay(ioLatencyBudgetMs(10_000), undefined, {
    signal: controller.signal,
  }).then(() => {
    throw new Error("Real CDK wrapper did not terminate");
  });
  if (run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill("SIGKILL");
  }
  try {
    await Promise.race([run.outcome, timeout]);
  } finally {
    controller.abort();
  }
}

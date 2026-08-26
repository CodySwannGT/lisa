#!/usr/bin/env node
/* eslint-disable code-organization/enforce-statement-order, functional/no-let, jsdoc/require-param, jsdoc/require-returns, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- ordered ACK protocol is an explicit mutable process state machine */
/** Foreground supervisor for test process groups and bounded scratch ownership. */
import { fork, type ChildProcess } from "node:child_process";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { invokedAsScript } from "../../scripts/lib/invoked-as-script.mjs";

import {
  materializeOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  registeredScratchPrefixes,
  removeOwnedScratchRunRoot,
  scratchBaseDir,
  scratchSuiteLabel,
  type ScratchRunRootIntentV1,
} from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
} from "../configs/vitest/scratch-supervision.js";
import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "./lisa-test-run-process-group.js";

/** Protocol timeout for an inert local acknowledgement. */
const ACK_TIMEOUT_MS = 10_000;

/** Dedicated operational-failure exit status. */
const OPERATIONAL_FAILURE_EXIT = 1;

/** Grace period for a payload to honor a forwarded catchable signal. */
const FORWARDED_SIGNAL_GRACE_MS = 1_000;

/** Private deterministic protocol-fault seam, never inherited by the payload. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Catchable signals forwarded to the target process group. */
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/** Child outcome retained until cleanup and disarm are proven. */
interface PayloadOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Cancellable escalation armed by the first forwarded catchable signal. */
interface SignalEscalation {
  readonly promise: Promise<PayloadOutcome>;
  readonly begin: (signal: NodeJS.Signals) => void;
  readonly cancel: () => void;
}

/** Locate a source sibling under tsx or a built sibling under Node. */
function siblingModule(name: string): string {
  const self = fileURLToPath(import.meta.url);
  return path.join(path.dirname(self), `${name}${path.extname(self)}`);
}

/** Reject unsupported process-group platforms before creating a run root. */
export function assertTestRunPlatform(
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `lisa-test-run requires Darwin or Linux process-group authority; received ${platform}`
    );
  }
}

/** Parse the exact public `-- <command>` syntax. */
function commandArgv(argv: readonly string[]): readonly [string, ...string[]] {
  if (argv[0] !== "--" || argv.length < 2 || argv[1] === undefined) {
    throw new Error("Usage: lisa-test-run -- <executable> [args...]");
  }
  return argv.slice(1) as [string, ...string[]];
}

/** Wait for one exact child acknowledgement or fail closed. */
function waitForMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}`));
    }, ACK_TIMEOUT_MS);
    const onMessage = (message: unknown): void => {
      if ((message as { type?: unknown }).type !== expected) return;
      cleanup();
      resolve();
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error(`Protocol process exited before ${expected}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

/** Wait until a protocol companion is absent from the process table. */
function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise(resolve => child.once("exit", () => resolve()));
}

/** Send one versioned message or reject a closed IPC channel. */
function send(
  child: ChildProcess,
  message: Readonly<Record<string, unknown>>
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send({ schema: 1, ...message }, error => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

/** Wait for the payload result while treating bootstrap death as operational failure. */
function waitForPayload(
  bootstrap: ChildProcess,
  signalEscalating: () => boolean = () => false
): Promise<PayloadOutcome> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      const value = message as {
        type?: unknown;
        code?: number | null;
        signal?: NodeJS.Signals | null;
        message?: string;
      };
      if (value.type === "PAYLOAD_ERROR") {
        cleanup();
        reject(new Error(value.message ?? "Payload spawn failed"));
      }
      if (value.type === "PAYLOAD_EXIT") {
        cleanup();
        resolve({ code: value.code ?? null, signal: value.signal ?? null });
      }
    };
    const onExit = (): void => {
      cleanup();
      if (signalEscalating()) return;
      reject(new Error("Bootstrap exited before reporting payload result"));
    };
    const cleanup = (): void => {
      bootstrap.off("message", onMessage);
      bootstrap.off("exit", onExit);
    };
    bootstrap.on("message", onMessage);
    bootstrap.once("exit", onExit);
  });
}

/** Stop the inert leader and wait for it to leave the target group. */
async function stopBootstrap(bootstrap: ChildProcess): Promise<void> {
  if (bootstrap.exitCode !== null || bootstrap.signalCode !== null) return;
  const exited = new Promise<void>(resolve =>
    bootstrap.once("exit", () => resolve())
  );
  await send(bootstrap, { type: "STOP" });
  await exited;
}

/** Convert inherited environment values to the string-only spawn contract. */
function payloadEnvironment(lease: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...env,
      [SCRATCH_SUPERVISION_LEASE_ENV]: lease,
    }).filter(
      (entry): entry is [string, string] =>
        entry[0] !== TEST_FAULT_ENV && entry[1] !== undefined
    )
  );
}

/** Reject if the armed detached cleanup authority exits during the payload. */
function rejectOnReaperExit(reaper: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    reaper.once("exit", () =>
      reject(new Error("Detached reaper exited while the payload was active"))
    );
  });
}

/** Start a detached IPC child in its own process session. */
function forkDetached(
  modulePath: string,
  args: readonly string[] = []
): ChildProcess {
  return fork(modulePath, args, {
    cwd: process.cwd(),
    detached: true,
    execArgv: process.execArgv,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}

/** Drain with private deterministic birth-probe failures when requested. */
function drainSupervisedTarget(
  target: TestRunTargetIntent | undefined
): Promise<void> {
  const fault = env[TEST_FAULT_ENV];
  if (fault === "birth-unavailable-on-drain") {
    return drainTestRunTarget(target, {
      probes: { processBirthFingerprint: () => undefined },
    });
  }
  if (fault === "birth-mismatch-on-drain") {
    return drainTestRunTarget(target, {
      probes: { processBirthFingerprint: () => "mismatched-birth-control" },
    });
  }
  return drainTestRunTarget(target);
}

/**
 * Convert ignored catchable signals into the same bounded TERM-to-KILL drain
 * used by every other supervisor terminal path.
 * @param target - Armed birth-bound process group
 * @returns Cancellable escalation promise
 */
function createSignalEscalation(target: TestRunTargetIntent): SignalEscalation {
  let timer: NodeJS.Timeout | undefined;
  let started = false;
  let settle:
    | {
        readonly resolve: (outcome: PayloadOutcome) => void;
        readonly reject: (error: unknown) => void;
      }
    | undefined;
  const promise = new Promise<PayloadOutcome>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return {
    promise,
    begin: signal => {
      if (started) return;
      started = true;
      timer = setTimeout(() => {
        void drainSupervisedTarget(target).then(
          () => settle?.resolve({ code: null, signal }),
          error => settle?.reject(error)
        );
      }, FORWARDED_SIGNAL_GRACE_MS);
    },
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** Arm and execute one supervised command. */
async function supervise(
  argv: readonly [string, ...string[]]
): Promise<PayloadOutcome> {
  assertTestRunPlatform();
  delete env[SCRATCH_SUPERVISION_LEASE_ENV];
  const base = scratchBaseDir();
  const intent: ScratchRunRootIntentV1 = prepareOwnedScratchRunRoot(base);
  const reaper = forkDetached(siblingModule("lisa-test-run-reaper"));
  let bootstrap: ChildProcess | undefined;
  let target: TestRunTargetIntent | undefined;
  let rootMaterialized = false;
  let disarmed = false;
  let signalEscalation: SignalEscalation | undefined;
  try {
    await waitForMessage(reaper, "REAPER_READY");
    const intentArmed = waitForMessage(reaper, "ROOT_INTENT_ARMED");
    await send(reaper, { type: "ROOT_INTENT", intent });
    await intentArmed;
    materializeOwnedScratchRunRoot(intent);
    rootMaterialized = true;
    if (env[TEST_FAULT_ENV] === "kill-reaper-after-root") {
      reaper.kill("SIGKILL");
    }
    const rootArmed = waitForMessage(reaper, "ROOT_ARMED");
    await send(reaper, { type: "ROOT_MATERIALIZED" });
    await rootArmed;

    const lease = createScratchSupervisionLease(intent, {
      suiteLabel: scratchSuiteLabel(),
      registeredPrefixes: registeredScratchPrefixes(),
    });
    const command = {
      schema: 1,
      argv,
      env: payloadEnvironment(JSON.stringify(lease)),
    };
    bootstrap = forkDetached(siblingModule("lisa-test-run-bootstrap"));
    await waitForMessage(bootstrap, "BOOTSTRAP_READY");
    const commandReady = waitForMessage(bootstrap, "COMMAND_READY");
    await send(bootstrap, { type: "COMMAND", command });
    await commandReady;
    const birth = processBirthFingerprint(bootstrap.pid ?? 0);
    if (bootstrap.pid === undefined || birth === undefined) {
      throw new Error("Could not bind bootstrap process birth");
    }
    target = {
      pid: bootstrap.pid,
      pgid: bootstrap.pid,
      processBirthFingerprint: birth,
    };
    const targetArmed = waitForMessage(reaper, "TARGET_ARMED");
    await send(reaper, {
      type: "TARGET_INTENT",
      target,
    });
    await targetArmed;

    let forwardedSignal: NodeJS.Signals | undefined;
    signalEscalation = createSignalEscalation(target);
    for (const signal of FORWARDED_SIGNALS) {
      process.once(signal, () => {
        forwardedSignal = signal;
        void send(bootstrap as ChildProcess, { type: "SIGNAL", signal });
        signalEscalation?.begin(signal);
      });
    }
    const outcomePromise = waitForPayload(
      bootstrap,
      () => forwardedSignal !== undefined
    );
    await send(bootstrap, { type: "GO" });
    if (env[TEST_FAULT_ENV] === "kill-reaper-after-go") {
      reaper.kill("SIGKILL");
    }
    const outcome = await Promise.race([
      outcomePromise,
      rejectOnReaperExit(reaper),
      signalEscalation.promise,
    ]);
    signalEscalation.cancel();
    await drainSupervisedTarget(target);
    await stopBootstrap(bootstrap);
    removeOwnedScratchRunRoot(intent);
    const disarmedAck = waitForMessage(reaper, "DISARMED");
    await send(reaper, { type: "CLEANED" });
    await disarmedAck;
    await waitForExit(reaper);
    disarmed = true;
    if (forwardedSignal !== undefined)
      return { code: null, signal: forwardedSignal };
    return outcome;
  } catch (error) {
    let cleanupError: unknown;
    try {
      await drainSupervisedTarget(target);
    } catch (drainError) {
      cleanupError = drainError;
    }
    if (cleanupError !== undefined) throw cleanupError;
    if (bootstrap !== undefined) {
      try {
        await stopBootstrap(bootstrap);
      } catch {
        bootstrap.kill("SIGKILL");
      }
    }
    if (rootMaterialized) removeOwnedScratchRunRoot(intent);
    throw error;
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.removeAllListeners(signal);
    signalEscalation?.cancel();
    if (!disarmed && reaper.connected) reaper.disconnect();
  }
}

/** Run the public CLI and preserve the child result only after cleanup. */
async function main(): Promise<void> {
  let argv: readonly [string, ...string[]];
  try {
    argv = commandArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
  try {
    const outcome = await supervise(argv);
    if (outcome.signal !== null) {
      process.removeAllListeners(outcome.signal);
      process.kill(process.pid, outcome.signal);
      return;
    }
    process.exit(outcome.code ?? OPERATIONAL_FAILURE_EXIT);
  } catch (error) {
    process.stderr.write(
      `lisa-test-run failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(OPERATIONAL_FAILURE_EXIT);
  }
}

if (invokedAsScript(import.meta.url)) {
  void main();
}
/* eslint-enable code-organization/enforce-statement-order, functional/no-let, jsdoc/require-param, jsdoc/require-returns, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- end ordered ACK state machine */

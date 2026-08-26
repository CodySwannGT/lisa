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
  removeOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
} from "../configs/vitest/scratch-supervision.js";
import {
  SCRATCH_PREFIXES_ENV,
  SCRATCH_SUITE_ENV,
  resolveScratchRouteProfile,
  type ScratchRouteProfile,
} from "../configs/vitest/scratch-route-profile.js";
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

/** Deterministic test-only representation of a closed IPC transport. */
class ClosedIpcChannelError extends Error {
  readonly code = "ERR_IPC_CHANNEL_CLOSED";
}

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

/** Fully parsed public invocation before any scratch authority is created. */
interface TestRunInvocation {
  readonly profile: ScratchRouteProfile;
  readonly argv: readonly [string, ...string[]];
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

/** Parse the exact public `--profile <route> -- <command>` syntax. */
function commandArgv(argv: readonly string[]): TestRunInvocation {
  if (
    argv[0] !== "--profile" ||
    argv[1] === undefined ||
    argv[2] !== "--" ||
    argv.length < 4 ||
    argv[3] === undefined
  ) {
    throw new Error(
      "Usage: lisa-test-run --profile <route> -- <executable> [args...]"
    );
  }
  return {
    profile: resolveScratchRouteProfile(argv[1]),
    argv: argv.slice(3) as [string, ...string[]],
  };
}

/** Wait for one exact child acknowledgement or fail closed. */
function waitForMessage(
  child: ChildProcess,
  expected: string,
  correlation?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}`));
    }, ACK_TIMEOUT_MS);
    const onMessage = (message: unknown): void => {
      const value = message as { type?: unknown; correlation?: unknown };
      if (
        value.type !== expected ||
        (correlation !== undefined && value.correlation !== correlation)
      ) {
        return;
      }
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
  if (
    env[TEST_FAULT_ENV] === "signal-send-rejected" &&
    message["type"] === "SIGNAL"
  ) {
    return Promise.reject(new Error("deterministic signal-send rejection"));
  }
  if (
    env[TEST_FAULT_ENV] === "stop-send-rejected" &&
    message["type"] === "STOP"
  ) {
    return Promise.reject(new Error("deterministic STOP send rejection"));
  }
  if (
    env[TEST_FAULT_ENV] === "stop-send-closed" &&
    message["type"] === "STOP"
  ) {
    return new Promise((_resolve, reject) => {
      child.send({ schema: 1, ...message }, () => {
        reject(new ClosedIpcChannelError("deterministic closed STOP channel"));
      });
    });
  }
  return new Promise((resolve, reject) => {
    child.send({ schema: 1, ...message }, error => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

/** Whether an IPC send failure proves the channel is already unusable. */
function isClosedIpcError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ERR_IPC_CHANNEL_CLOSED" || code === "ERR_IPC_DISCONNECTED";
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
  try {
    await send(bootstrap, { type: "STOP" });
  } catch (error) {
    const alreadyExited =
      bootstrap.exitCode !== null || bootstrap.signalCode !== null;
    if (!alreadyExited && !isClosedIpcError(error)) throw error;
  }
  await exited;
}

/** Convert inherited environment values to the string-only spawn contract. */
function payloadEnvironment(
  lease: string,
  profile: ScratchRouteProfile
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...env,
      [SCRATCH_SUPERVISION_LEASE_ENV]: lease,
      [SCRATCH_SUITE_ENV]: profile.suiteLabel,
      [SCRATCH_PREFIXES_ENV]: JSON.stringify(profile.registeredPrefixes),
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
  if (fault === "stop-send-closed" || fault === "stop-send-rejected") {
    return Promise.resolve();
  }
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
  argv: readonly [string, ...string[]],
  profile: ScratchRouteProfile
): Promise<PayloadOutcome> {
  assertTestRunPlatform();
  delete env[SCRATCH_SUPERVISION_LEASE_ENV];
  const intent: ScratchRunRootIntentV1 = prepareOwnedScratchRunRoot(
    env[TEST_FAULT_ENV] === "birth-unavailable-on-prepare"
      ? {
          platform: process.platform,
          processBirthFingerprint: () => undefined,
          suiteLabel: profile.suiteLabel,
          registeredPrefixes: profile.registeredPrefixes,
        }
      : {
          suiteLabel: profile.suiteLabel,
          registeredPrefixes: profile.registeredPrefixes,
        }
  );
  const reaper = forkDetached(siblingModule("lisa-test-run-reaper"));
  let bootstrap: ChildProcess | undefined;
  let target: TestRunTargetIntent | undefined;
  let rootMaterialized = false;
  let disarmed = false;
  let signalEscalation: SignalEscalation | undefined;
  try {
    await waitForMessage(reaper, "REAPER_READY");
    bootstrap = forkDetached(siblingModule("lisa-test-run-bootstrap"));
    await waitForMessage(bootstrap, "BOOTSTRAP_READY");
    const birth = processBirthFingerprint(bootstrap.pid ?? 0);
    if (bootstrap.pid === undefined || birth === undefined) {
      throw new Error("Could not bind bootstrap process birth");
    }
    target = {
      pid: bootstrap.pid,
      pgid: bootstrap.pid,
      processBirthFingerprint: birth,
    };

    const intentArmed = waitForMessage(
      reaper,
      "ROOT_INTENT_ARMED",
      intent.token
    );
    await send(reaper, {
      type: "ROOT_INTENT",
      correlation: intent.token,
      intent,
    });
    await intentArmed;
    const targetArmed = waitForMessage(reaper, "TARGET_ARMED", intent.token);
    await send(reaper, {
      type: "TARGET_INTENT",
      correlation: intent.token,
      target,
    });
    await targetArmed;

    materializeOwnedScratchRunRoot(intent);
    rootMaterialized = true;
    if (env[TEST_FAULT_ENV] === "kill-reaper-after-root") {
      reaper.kill("SIGKILL");
    }
    const rootArmed = waitForMessage(reaper, "ROOT_ARMED", intent.token);
    await send(reaper, {
      type: "ROOT_MATERIALIZED",
      correlation: intent.token,
    });
    await rootArmed;

    const lease = createScratchSupervisionLease(intent, {
      suiteLabel: intent.suiteLabel,
      registeredPrefixes: intent.registeredPrefixes,
    });
    const command = {
      schema: 1,
      argv,
      env: payloadEnvironment(JSON.stringify(lease), profile),
    };
    const commandReady = waitForMessage(bootstrap, "COMMAND_READY");
    await send(bootstrap, { type: "COMMAND", command });
    await commandReady;
    let forwardedSignal: NodeJS.Signals | undefined;
    signalEscalation = createSignalEscalation(target);
    for (const signal of FORWARDED_SIGNALS) {
      process.once(signal, () => {
        forwardedSignal = signal;
        void send(bootstrap as ChildProcess, { type: "SIGNAL", signal }).catch(
          () => undefined
        );
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
  let invocation: TestRunInvocation;
  try {
    invocation = commandArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
  try {
    const outcome = await supervise(invocation.argv, invocation.profile);
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

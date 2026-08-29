/** Runtime-only companion, environment, and signal escalation primitives. */
import { fork, type ChildProcess } from "node:child_process";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import {
  SCRATCH_PREFIXES_ENV,
  SCRATCH_SUITE_ENV,
  type ScratchRouteProfile,
} from "../configs/vitest/scratch-route-profile.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../configs/vitest/scratch-supervision.js";
import type { PayloadOutcome } from "./lisa-test-run-ipc.js";
import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "./lisa-test-run-process-group.js";

/** Grace period for a payload to honor a forwarded catchable signal. */
const FORWARDED_SIGNAL_GRACE_MS = 1_000;

/** Private deterministic protocol-fault seam. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Catchable signals forwarded to the target process group. */
export const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/** Cancellable escalation armed by the first forwarded catchable signal. */
export interface SignalEscalation {
  readonly promise: Promise<PayloadOutcome>;
  readonly begin: (signal: NodeJS.Signals) => void;
  readonly cancel: () => void;
}

/**
 * Start one source-or-built sibling as a detached IPC child.
 * @param name - Sibling module basename
 * @returns Detached protocol companion
 */
export function forkDetachedSibling(name: string): ChildProcess {
  const self = fileURLToPath(import.meta.url);
  const modulePath = path.join(
    path.dirname(self),
    `${name}${path.extname(self)}`
  );
  return fork(modulePath, [], {
    cwd: process.cwd(),
    detached: true,
    execArgv: process.execArgv,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}

/**
 * Convert inherited values plus the frozen lease to the spawn contract.
 * @param lease - Serialized exact suite lease
 * @param profile - Frozen wrapper route profile
 * @param directScratchRoot - Direct-adapter platform temp root, when applicable
 * @returns String-only payload environment
 */
export function payloadEnvironment(
  lease: string,
  profile: ScratchRouteProfile,
  directScratchRoot?: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...env,
      [SCRATCH_SUPERVISION_LEASE_ENV]: lease,
      [SCRATCH_SUITE_ENV]: profile.suiteLabel,
      [SCRATCH_PREFIXES_ENV]: JSON.stringify(profile.registeredPrefixes),
      ...(directScratchRoot === undefined
        ? {}
        : {
            TMPDIR: directScratchRoot,
            TMP: directScratchRoot,
            TEMP: directScratchRoot,
          }),
    }).filter(
      (entry): entry is [string, string] =>
        entry[0] !== TEST_FAULT_ENV && entry[1] !== undefined
    )
  );
}

/**
 * Reject if the detached cleanup authority exits during the payload.
 * @param reaper - Armed detached reaper
 * @returns Promise that only rejects on exit
 */
export function rejectOnReaperExit(reaper: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    const onExit = (): void => {
      reaper.off("exit", onExit);
      reject(new Error("Detached reaper exited while the payload was active"));
    };
    reaper.once("exit", onExit);
    if (reaper.exitCode !== null || reaper.signalCode !== null) onExit();
  });
}

/**
 * Drain with deterministic birth-probe failures only in dedicated controls.
 * @param target - Armed target authority
 * @returns Bounded drain promise
 */
export function drainSupervisedTarget(
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
 * Build one cancellable TERM-to-KILL escalation.
 * @param target - Armed birth-bound target
 * @returns Cancellable escalation
 */
export function createSignalEscalation(
  target: TestRunTargetIntent
): SignalEscalation {
  const state: {
    timer?: NodeJS.Timeout;
    started: boolean;
    settle?: {
      readonly resolve: (outcome: PayloadOutcome) => void;
      readonly reject: (error: unknown) => void;
    };
  } = { started: false };
  const promise = new Promise<PayloadOutcome>((resolve, reject) => {
    // eslint-disable-next-line functional/immutable-data -- one promise settlement handle
    state.settle = { resolve, reject };
  });
  return {
    promise,
    begin: signal => {
      if (state.started) return;
      // eslint-disable-next-line functional/immutable-data -- first forwarded signal wins
      state.started = true;
      // eslint-disable-next-line functional/immutable-data -- cancellable bounded timer
      state.timer = setTimeout(() => {
        void drainSupervisedTarget(target).then(
          () => state.settle?.resolve({ code: null, signal }),
          error => state.settle?.reject(error)
        );
      }, FORWARDED_SIGNAL_GRACE_MS);
    },
    cancel: () => {
      if (state.timer !== undefined) clearTimeout(state.timer);
    },
  };
}

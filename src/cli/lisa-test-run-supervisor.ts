/** Foreground orchestration of companions, payload, and scratch ownership. */
import type { ChildProcess } from "node:child_process";
import { env } from "node:process";

import {
  materializeOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";
import type { ScratchRouteProfile } from "../configs/vitest/scratch-route-profile.js";
import {
  SCRATCH_SUPERVISION_LEASE_ENV,
  createScratchSupervisionLease,
} from "../configs/vitest/scratch-supervision.js";
import {
  sendMessage,
  stopBootstrap,
  waitForExit,
  waitForMessage,
  waitForPayload,
  type PayloadOutcome,
} from "./lisa-test-run-ipc.js";
import { assertTestRunPlatform } from "./lisa-test-run-process-group.js";
import { type TestRunTargetIntent } from "./lisa-test-run-process-group.js";
import {
  FORWARDED_SIGNALS,
  createSignalEscalation,
  drainSupervisedTarget,
  forkDetachedSibling,
  payloadEnvironment,
  rejectOnReaperExit,
  type SignalEscalation,
} from "./lisa-test-run-runtime.js";

/** Private deterministic protocol-fault seam, never inherited by the payload. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Mutable facts confined to one foreground supervision invocation. */
interface SupervisorState {
  readonly intent: ScratchRunRootIntentV1;
  readonly reaper: ChildProcess;
  bootstrap?: ChildProcess;
  target?: TestRunTargetIntent;
  signalEscalation?: SignalEscalation;
  forwardedSignal?: NodeJS.Signals;
  rootMaterialized: boolean;
  disarmed: boolean;
}

/**
 * Prepare the immutable root intent before starting protocol companions.
 * @param profile - Frozen wrapper route profile
 * @returns Immutable root intent
 */
function prepareIntent(profile: ScratchRouteProfile): ScratchRunRootIntentV1 {
  return prepareOwnedScratchRunRoot(
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
}

/**
 * Arm both companions and materialize only after root/target acknowledgements.
 * @param state - One foreground supervision state
 */
async function armAuthorities(state: SupervisorState): Promise<void> {
  await waitForMessage(state.reaper, "REAPER_READY");
  const bootstrap = forkDetachedSibling("lisa-test-run-bootstrap");
  // eslint-disable-next-line functional/immutable-data -- companion handle captured once
  state.bootstrap = bootstrap;
  await waitForMessage(bootstrap, "BOOTSTRAP_READY");
  const birth = processBirthFingerprint(bootstrap.pid ?? 0);
  if (bootstrap.pid === undefined || birth === undefined) {
    throw new Error("Could not bind bootstrap process birth");
  }
  const target: TestRunTargetIntent = {
    pid: bootstrap.pid,
    pgid: bootstrap.pid,
    processBirthFingerprint: birth,
  };
  // eslint-disable-next-line functional/immutable-data -- target authority captured once
  state.target = target;
  const rootAck = waitForMessage(
    state.reaper,
    "ROOT_INTENT_ARMED",
    state.intent.token
  );
  await sendMessage(state.reaper, {
    type: "ROOT_INTENT",
    correlation: state.intent.token,
    intent: state.intent,
  });
  await rootAck;
  const targetAck = waitForMessage(
    state.reaper,
    "TARGET_ARMED",
    state.intent.token
  );
  await sendMessage(state.reaper, {
    type: "TARGET_INTENT",
    correlation: state.intent.token,
    target,
  });
  await targetAck;
  materializeOwnedScratchRunRoot(state.intent);
  // eslint-disable-next-line functional/immutable-data -- exact materialization transition
  state.rootMaterialized = true;
  if (env[TEST_FAULT_ENV] === "kill-reaper-after-root") {
    state.reaper.kill("SIGKILL");
  }
  // eslint-disable-next-line code-organization/enforce-statement-order -- the post-materialization ACK must be registered after materialization
  const rootArmed = waitForMessage(
    state.reaper,
    "ROOT_ARMED",
    state.intent.token
  );
  await sendMessage(state.reaper, {
    type: "ROOT_MATERIALIZED",
    correlation: state.intent.token,
  });
  await rootArmed;
}

/**
 * Send one immutable command after root and target authority are armed.
 * @param state - One foreground supervision state
 * @param argv - Exact payload argv
 * @param profile - Frozen wrapper route profile
 */
async function configurePayload(
  state: SupervisorState,
  argv: readonly [string, ...string[]],
  profile: ScratchRouteProfile
): Promise<void> {
  if (state.bootstrap === undefined) throw new Error("Bootstrap is not armed");
  const lease = createScratchSupervisionLease(state.intent, {
    suiteLabel: state.intent.suiteLabel,
    registeredPrefixes: state.intent.registeredPrefixes,
  });
  const command = {
    schema: 1,
    argv,
    env: payloadEnvironment(JSON.stringify(lease), profile),
  };
  const commandReady = waitForMessage(state.bootstrap, "COMMAND_READY");
  await sendMessage(state.bootstrap, { type: "COMMAND", command });
  await commandReady;
}

/**
 * Execute the armed payload while retaining the first forwarded signal.
 * @param state - One foreground supervision state
 * @returns Exact payload outcome
 */
async function executePayload(state: SupervisorState): Promise<PayloadOutcome> {
  const bootstrap = state.bootstrap;
  const target = state.target;
  if (bootstrap === undefined || target === undefined) {
    throw new Error("Payload authority is not fully armed");
  }
  const escalation = createSignalEscalation(target);
  // eslint-disable-next-line functional/immutable-data -- cancellable handle scoped to this run
  state.signalEscalation = escalation;
  for (const signal of FORWARDED_SIGNALS) {
    process.once(signal, () => {
      // eslint-disable-next-line functional/immutable-data -- first observed terminal signal is preserved
      state.forwardedSignal = signal;
      void sendMessage(bootstrap, { type: "SIGNAL", signal }).catch(
        () => undefined
      );
      escalation.begin(signal);
    });
  }
  const outcomePromise = waitForPayload(
    bootstrap,
    () => state.forwardedSignal !== undefined
  );
  await sendMessage(bootstrap, { type: "GO" });
  if (env[TEST_FAULT_ENV] === "kill-reaper-after-go") {
    state.reaper.kill("SIGKILL");
  }
  return await Promise.race([
    outcomePromise,
    rejectOnReaperExit(state.reaper),
    escalation.promise,
  ]);
}

/**
 * Drain, clean, and disarm after one payload result.
 * @param state - One foreground supervision state
 * @param outcome - Exact payload outcome
 * @returns Outcome after cleanup and disarm
 */
async function finishSuccess(
  state: SupervisorState,
  outcome: PayloadOutcome
): Promise<PayloadOutcome> {
  state.signalEscalation?.cancel();
  await drainSupervisedTarget(state.target);
  if (state.bootstrap !== undefined) await stopBootstrap(state.bootstrap);
  removeOwnedScratchRunRoot(state.intent);
  // eslint-disable-next-line code-organization/enforce-statement-order -- disarm is meaningful only after foreground removal
  const disarmedAck = waitForMessage(state.reaper, "DISARMED");
  await sendMessage(state.reaper, { type: "CLEANED" });
  await disarmedAck;
  await waitForExit(state.reaper);
  // eslint-disable-next-line functional/immutable-data -- terminal verified state
  state.disarmed = true;
  return state.forwardedSignal === undefined
    ? outcome
    : { code: null, signal: state.forwardedSignal };
}

/**
 * Best-effort foreground cleanup that never hides a drain authority failure.
 * @param state - One foreground supervision state
 */
async function cleanupFailure(state: SupervisorState): Promise<void> {
  await drainSupervisedTarget(state.target);
  if (state.bootstrap !== undefined) {
    try {
      await stopBootstrap(state.bootstrap);
    } catch {
      state.bootstrap.kill("SIGKILL");
    }
  }
  if (state.rootMaterialized) removeOwnedScratchRunRoot(state.intent);
}

/**
 * Arm and execute one supervised command.
 * @param argv - Exact payload argv
 * @param profile - Frozen wrapper route profile
 * @returns Payload outcome after proven cleanup
 */
export async function superviseTestRun(
  argv: readonly [string, ...string[]],
  profile: ScratchRouteProfile
): Promise<PayloadOutcome> {
  assertTestRunPlatform();
  delete env[SCRATCH_SUPERVISION_LEASE_ENV];
  // eslint-disable-next-line code-organization/enforce-statement-order -- inherited authority must be cleared before intent preparation
  const state: SupervisorState = {
    intent: prepareIntent(profile),
    reaper: forkDetachedSibling("lisa-test-run-reaper"),
    rootMaterialized: false,
    disarmed: false,
  };
  try {
    await armAuthorities(state);
    await configurePayload(state, argv, profile);
    return await finishSuccess(state, await executePayload(state));
  } catch (error) {
    await cleanupFailure(state);
    throw error;
  } finally {
    for (const signal of FORWARDED_SIGNALS) process.removeAllListeners(signal);
    state.signalEscalation?.cancel();
    if (!state.disarmed && state.reaper.connected) state.reaper.disconnect();
  }
}

#!/usr/bin/env node
/** Detached one-run reaper for supervisor death and scratch cleanup. */
import { env } from "node:process";

import {
  materializeOwnedScratchRunRoot,
  openOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "../configs/vitest/scratch.js";
import {
  processBirthFingerprint,
  writeScratchOwnerRecord,
  type ScratchPathIdentity,
} from "../configs/vitest/scratch-owner.js";
import {
  parseScratchProtocolMessage,
  validateScratchRunRootIntent,
  type ScratchProtocolMessageV1,
} from "../configs/vitest/scratch-supervision.js";

import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "./lisa-test-run-process-group.js";

/** Private deterministic fault seam, stripped before payload execution. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** All mutable authority facts confined to this one detached process. */
interface ReaperState {
  intent?: ScratchRunRootIntentV1;
  target?: TestRunTargetIntent;
  disarmed: boolean;
  recovering: boolean;
  phase:
    | "await-root-intent"
    | "await-target-intent"
    | "await-materialization"
    | "armed"
    | "disarmed";
}

/**
 * Validate and arm one pre-materialization root intent.
 * @param value - Exact root-intent message
 * @returns Immutable root intent
 */
function armRootIntent(
  value: ScratchProtocolMessageV1
): ScratchRunRootIntentV1 {
  const candidate = validateScratchRunRootIntent(value["intent"]);
  if (
    value["correlation"] !== candidate.token ||
    openOwnedScratchRunRoot(candidate) !== undefined ||
    env[TEST_FAULT_ENV] === "reaper-refuse-root-intent"
  ) {
    throw new Error("Scratch root intent was not conclusively absent");
  }
  return candidate;
}

/**
 * Materialize the exact armed intent inside the detached authority.
 * @param value - Exact correlated materialization request
 * @param intent - Previously armed root intent
 * @returns Newly persisted root identity
 */
function materializeArmedRoot(
  value: ScratchProtocolMessageV1,
  intent: ScratchRunRootIntentV1 | undefined
): ScratchPathIdentity {
  if (
    intent === undefined ||
    value["correlation"] !== intent.token ||
    openOwnedScratchRunRoot(intent) !== undefined
  ) {
    throw new Error("Scratch root materialization does not match armed intent");
  }
  const owned = materializeOwnedScratchRunRoot(intent, {
    writeOwnerRecord: (root, owner) => {
      if (env[TEST_FAULT_ENV] === "pause-before-owner-marker") {
        process.kill(process.pid, "SIGSTOP");
      }
      writeScratchOwnerRecord(root, owner);
    },
  });
  return owned.owner.root;
}

/**
 * Validate and arm one birth-bound target before root materialization.
 * @param value - Exact target-intent message
 * @param intent - Previously armed root intent
 * @returns Immutable target authority
 */
function armTargetIntent(
  value: ScratchProtocolMessageV1,
  intent: ScratchRunRootIntentV1 | undefined
): TestRunTargetIntent {
  const candidate = value["target"] as TestRunTargetIntent;
  if (
    intent === undefined ||
    value["correlation"] !== intent.token ||
    openOwnedScratchRunRoot(intent) !== undefined ||
    processBirthFingerprint(candidate.pid) !==
      candidate.processBirthFingerprint ||
    env[TEST_FAULT_ENV] === "reaper-refuse-target-intent"
  ) {
    throw new Error("Target intent does not match the armed root correlation");
  }
  return candidate;
}

/**
 * Run detached recovery once, then exit with no permanent companion.
 * @param state - Reaper lifecycle state
 */
async function recover(state: ReaperState): Promise<void> {
  if (state.recovering || state.disarmed) return;
  // eslint-disable-next-line functional/immutable-data -- exactly-once recovery transition
  state.recovering = true;
  try {
    await drainTestRunTarget(state.target);
    if (state.intent !== undefined) removeOwnedScratchRunRoot(state.intent);
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `lisa-test-run reaper failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

/**
 * Send one exact acknowledgement or enter detached recovery.
 * @param state - Reaper lifecycle state
 * @param type - Exact acknowledgement type
 * @param correlation - Optional root token correlation
 * @param body - Exact type-specific acknowledgement fields
 */
function sendAcknowledgement(
  state: ReaperState,
  type: string,
  correlation?: string,
  body: Readonly<Record<string, unknown>> = {}
): void {
  if (
    env[TEST_FAULT_ENV] === "reaper-close-root-armed" &&
    type === "ROOT_ARMED" &&
    process.connected
  ) {
    process.disconnect();
  }
  if (!process.connected || process.send === undefined) {
    void recover(state);
    return;
  }
  try {
    process.send(
      {
        schema: 1,
        type,
        ...(correlation === undefined ? {} : { correlation }),
        ...body,
      },
      error => {
        if (error !== null) void recover(state);
      }
    );
  } catch {
    void recover(state);
  }
}

/**
 * Apply one exact message to the current reaper phase.
 * @param state - Reaper lifecycle state
 * @param message - Untrusted IPC message
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- four explicit protocol phases are kept visibly fail-closed
function handleMessage(state: ReaperState, message: unknown): void {
  const value = parseScratchProtocolMessage(message);
  if (state.phase === "await-root-intent" && value.type === "ROOT_INTENT") {
    const intent = armRootIntent(value);
    // eslint-disable-next-line functional/immutable-data -- immutable authority captured once
    state.intent = intent;
    // eslint-disable-next-line functional/immutable-data -- ordered protocol transition
    state.phase = "await-target-intent";
    sendAcknowledgement(state, "ROOT_INTENT_ARMED", intent.token);
    return;
  }
  if (state.phase === "await-target-intent" && value.type === "TARGET_INTENT") {
    const target = armTargetIntent(value, state.intent);
    // eslint-disable-next-line functional/immutable-data -- immutable target captured once
    state.target = target;
    // eslint-disable-next-line functional/immutable-data -- ordered protocol transition
    state.phase = "await-materialization";
    sendAcknowledgement(state, "TARGET_ARMED", state.intent?.token);
    return;
  }
  if (
    state.phase === "await-materialization" &&
    value.type === "MATERIALIZE_ROOT"
  ) {
    const root = materializeArmedRoot(value, state.intent);
    // eslint-disable-next-line functional/immutable-data -- ordered protocol transition
    state.phase = "armed";
    sendAcknowledgement(state, "ROOT_ARMED", state.intent?.token, { root });
    return;
  }
  if (state.phase === "armed" && value.type === "CLEANED") {
    if (
      state.intent !== undefined &&
      openOwnedScratchRunRoot(state.intent) !== undefined
    ) {
      throw new Error("Foreground cleanup did not remove the armed root");
    }
    // eslint-disable-next-line functional/immutable-data -- terminal disarm transition
    state.disarmed = true;
    // eslint-disable-next-line functional/immutable-data -- terminal disarm transition
    state.phase = "disarmed";
    sendAcknowledgement(state, "DISARMED");
    process.disconnect();
    process.exit(0);
  }
  throw new Error(`Unexpected ${value.type} in reaper state ${state.phase}`);
}

/** Start the one-shot detached recovery protocol. */
function main(): void {
  const state: ReaperState = {
    disarmed: false,
    recovering: false,
    phase: "await-root-intent",
  };
  process.on("message", message => {
    try {
      handleMessage(state, message);
    } catch (error) {
      process.stderr.write(
        `lisa-test-run reaper refused protocol: ${error instanceof Error ? error.message : String(error)}\n`
      );
      void recover(state);
    }
  });
  process.once("disconnect", () => void recover(state));
  sendAcknowledgement(state, "REAPER_READY");
}

if (env[TEST_FAULT_ENV] === "reaper-startup") process.exit(77);
main();

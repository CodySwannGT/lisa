#!/usr/bin/env node
/* eslint-disable functional/no-let, jsdoc/require-param, jsdoc/require-returns -- one-shot IPC recovery is an explicit mutable state machine */
/** Detached one-run reaper for supervisor death and scratch cleanup. */
import {
  openOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";
import {
  parseScratchProtocolMessage,
  validateScratchRunRootIntent,
  type ScratchProtocolMessageV1,
} from "../configs/vitest/scratch-supervision.js";
import { env } from "node:process";

import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "./lisa-test-run-process-group.js";

/** Private deterministic fault seam, stripped before payload execution. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Recovery callback shared by protocol arms. */
type Recover = () => Promise<void>;

/** Correlated acknowledgement sender shared by protocol arms. */
type SendAcknowledgement = (type: string, correlation?: string) => void;

/** Enter recovery and return no newly armed value. */
function refuse<T>(recover: Recover): T | undefined {
  void recover();
  return undefined;
}

/** Validate and arm one pre-materialization root intent. */
function armRootIntent(
  value: ScratchProtocolMessageV1,
  recover: Recover,
  send: SendAcknowledgement
): ScratchRunRootIntentV1 | undefined {
  const candidate = validateScratchRunRootIntent(value["intent"]);
  if (
    value["correlation"] !== candidate.token ||
    openOwnedScratchRunRoot(candidate) !== undefined ||
    env[TEST_FAULT_ENV] === "reaper-refuse-root-intent"
  ) {
    return refuse(recover);
  }
  send("ROOT_INTENT_ARMED", candidate.token);
  return candidate;
}

/** Revalidate one materialized root before arming cleanup. */
function armMaterializedRoot(
  value: ScratchProtocolMessageV1,
  intent: ScratchRunRootIntentV1 | undefined,
  recover: Recover,
  send: SendAcknowledgement
): void {
  if (
    intent === undefined ||
    value["correlation"] !== intent.token ||
    openOwnedScratchRunRoot(intent) === undefined
  ) {
    void recover();
    return;
  }
  send("ROOT_ARMED", intent.token);
}

/** Validate and arm one target process group before root materialization. */
function armTargetIntent(
  value: ScratchProtocolMessageV1,
  intent: ScratchRunRootIntentV1 | undefined,
  recover: Recover,
  send: SendAcknowledgement
): TestRunTargetIntent | undefined {
  const candidate = value["target"] as TestRunTargetIntent;
  if (
    intent === undefined ||
    value["correlation"] !== intent.token ||
    openOwnedScratchRunRoot(intent) !== undefined ||
    candidate.pgid !== candidate.pid ||
    processBirthFingerprint(candidate.pid) !==
      candidate.processBirthFingerprint ||
    env[TEST_FAULT_ENV] === "reaper-refuse-target-intent"
  ) {
    return refuse(recover);
  }
  send("TARGET_ARMED", intent.token);
  return candidate;
}

/** Whether the armed root is conclusively absent after foreground cleanup. */
function rootIsCleaned(intent: ScratchRunRootIntentV1 | undefined): boolean {
  return intent === undefined || openOwnedScratchRunRoot(intent) === undefined;
}

/** Run detached recovery once, then exit with no permanent companion. */
function main(): void {
  let intent: ScratchRunRootIntentV1 | undefined;
  let target: TestRunTargetIntent | undefined;
  let disarmed = false;
  let recovering = false;

  const recover = async (): Promise<void> => {
    if (recovering || disarmed) return;
    recovering = true;
    try {
      await drainTestRunTarget(target);
      if (intent !== undefined) removeOwnedScratchRunRoot(intent);
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `lisa-test-run reaper failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exit(1);
    }
  };

  /** Send one correlated acknowledgement or enter detached recovery. */
  const send = (type: string, correlation?: string): void => {
    if (
      env[TEST_FAULT_ENV] === "reaper-close-root-armed" &&
      type === "ROOT_ARMED" &&
      process.connected
    ) {
      process.disconnect();
    }
    if (!process.connected || process.send === undefined) {
      void recover();
      return;
    }
    try {
      process.send(
        {
          schema: 1,
          type,
          ...(correlation === undefined ? {} : { correlation }),
        },
        error => {
          if (error !== null) void recover();
        }
      );
    } catch {
      void recover();
    }
  };

  process.on("message", message => {
    const value = parseScratchProtocolMessage(message);
    if (value["type"] === "ROOT_INTENT") {
      intent = armRootIntent(value, recover, send);
      return;
    }
    if (value["type"] === "ROOT_MATERIALIZED") {
      armMaterializedRoot(value, intent, recover, send);
      return;
    }
    if (value["type"] === "TARGET_INTENT") {
      target = armTargetIntent(value, intent, recover, send);
      return;
    }
    if (value["type"] === "CLEANED") {
      if (!rootIsCleaned(intent)) {
        void recover();
        return;
      }
      disarmed = true;
      send("DISARMED");
      process.disconnect();
      process.exit(0);
    }
  });

  process.once("disconnect", () => void recover());
  send("REAPER_READY");
}

if (env[TEST_FAULT_ENV] === "reaper-startup") process.exit(77);
main();
/* eslint-enable functional/no-let, jsdoc/require-param, jsdoc/require-returns -- end one-shot IPC state machine */

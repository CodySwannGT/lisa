#!/usr/bin/env node
/* eslint-disable code-organization/enforce-statement-order, functional/no-let, jsdoc/require-param, jsdoc/require-returns, sonarjs/cognitive-complexity -- one-shot IPC recovery is an explicit mutable state machine */
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
} from "../configs/vitest/scratch-supervision.js";
import { env } from "node:process";

import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "./lisa-test-run-process-group.js";

/** Private deterministic fault seam, stripped before payload execution. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Armed target process-group facts. */
/** Send one acknowledgement while the supervisor IPC channel exists. */
function send(type: string): void {
  if (process.connected) process.send?.({ schema: 1, type });
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

  process.on("message", message => {
    const value = parseScratchProtocolMessage(message);
    if (value["type"] === "ROOT_INTENT") {
      intent = validateScratchRunRootIntent(value["intent"]);
      if (openOwnedScratchRunRoot(intent) !== undefined) {
        void recover();
        return;
      }
      send("ROOT_INTENT_ARMED");
      return;
    }
    if (value["type"] === "ROOT_MATERIALIZED") {
      if (
        intent === undefined ||
        openOwnedScratchRunRoot(intent) === undefined
      ) {
        void recover();
        return;
      }
      send("ROOT_ARMED");
      return;
    }
    if (value["type"] === "TARGET_INTENT") {
      const candidate = value["target"] as TestRunTargetIntent;
      if (
        candidate.pgid !== candidate.pid ||
        processBirthFingerprint(candidate.pid) !==
          candidate.processBirthFingerprint
      ) {
        void recover();
        return;
      }
      target = candidate;
      send("TARGET_ARMED");
      return;
    }
    if (value["type"] === "CLEANED") {
      if (
        intent !== undefined &&
        openOwnedScratchRunRoot(intent) !== undefined
      ) {
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
/* eslint-enable code-organization/enforce-statement-order, functional/no-let, jsdoc/require-param, jsdoc/require-returns, sonarjs/cognitive-complexity -- end one-shot IPC state machine */

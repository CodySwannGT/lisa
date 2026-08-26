#!/usr/bin/env node
/* eslint-disable code-organization/enforce-statement-order, functional/no-let, jsdoc/require-param, jsdoc/require-returns, sonarjs/cognitive-complexity -- one-shot IPC recovery is an explicit mutable state machine */
/** Detached one-run reaper for supervisor death and scratch cleanup. */
import {
  isProcessAlive,
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

/** Private deterministic fault seam, stripped before payload execution. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Armed target process-group facts. */
interface TargetIntent {
  readonly pid: number;
  readonly pgid: number;
  readonly processBirthFingerprint: string;
}

/** Time allowed for one process-group drain phase. */
const DRAIN_GRACE_MS = 2_000;

/** Poll interval for bounded group drain. */
const DRAIN_POLL_MS = 25;

/** Send one acknowledgement while the supervisor IPC channel exists. */
function send(type: string): void {
  if (process.connected) process.send?.({ schema: 1, type });
}

/** Whether any member still occupies a process group. */
function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Signal a group without turning an already-absent group into a failure. */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

/** Wait without a permanent timer handle. */
const delay = async (milliseconds: number): Promise<void> =>
  await new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * Drain only the group whose leader still has its armed process birth.
 * @param target - Armed leader and group identity
 */
async function drainTarget(target: TargetIntent | undefined): Promise<void> {
  if (target === undefined) return;
  const observedBirth = processBirthFingerprint(target.pid);
  if (
    isProcessAlive(target.pid) &&
    observedBirth !== target.processBirthFingerprint
  ) {
    return;
  }
  if (!processGroupAlive(target.pgid)) return;
  signalGroup(target.pgid, "SIGTERM");
  const deadline = Date.now() + DRAIN_GRACE_MS;
  while (processGroupAlive(target.pgid) && Date.now() < deadline) {
    await delay(DRAIN_POLL_MS);
  }
  if (processGroupAlive(target.pgid)) {
    signalGroup(target.pgid, "SIGKILL");
    const killDeadline = Date.now() + DRAIN_GRACE_MS;
    while (processGroupAlive(target.pgid) && Date.now() < killDeadline) {
      await delay(DRAIN_POLL_MS);
    }
  }
  if (processGroupAlive(target.pgid)) {
    throw new Error("target process group survived bounded drain");
  }
}

/** Run detached recovery once, then exit with no permanent companion. */
function main(): void {
  let intent: ScratchRunRootIntentV1 | undefined;
  let target: TargetIntent | undefined;
  let disarmed = false;
  let recovering = false;

  const recover = async (): Promise<void> => {
    if (recovering || disarmed) return;
    recovering = true;
    try {
      await drainTarget(target);
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
      const candidate = value["target"] as TargetIntent;
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

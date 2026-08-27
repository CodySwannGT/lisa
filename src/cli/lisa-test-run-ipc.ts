/** Exact, bounded parent-side IPC operations for lisa-test-run companions. */
import type { ChildProcess } from "node:child_process";
import { env } from "node:process";

import {
  parseScratchProtocolMessage,
  type ScratchProtocolMessageV1,
} from "../configs/vitest/scratch-supervision.js";

/** Protocol timeout for one inert local acknowledgement. */
const ACK_TIMEOUT_MS = 10_000;

/** Private deterministic protocol-fault seam. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Child outcome retained until cleanup and disarm are proven. */
export interface PayloadOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Deterministic test-only representation of a closed IPC transport. */
class ClosedIpcChannelError extends Error {
  readonly code = "ERR_IPC_CHANNEL_CLOSED";
}

/**
 * Wait for one exact child acknowledgement or fail closed.
 * @param child - Protocol companion
 * @param expected - Exact expected type
 * @param correlation - Optional exact root token
 * @returns Promise settled by the exact validated acknowledgement
 */
export function waitForMessage(
  child: ChildProcess,
  expected: string,
  correlation?: string
): Promise<ScratchProtocolMessageV1> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}`));
    }, ACK_TIMEOUT_MS);
    const onMessage = (message: unknown): void => {
      try {
        const value = parseScratchProtocolMessage(message);
        if (
          value.type !== expected ||
          (correlation !== undefined && value["correlation"] !== correlation) ||
          (correlation === undefined && Object.hasOwn(value, "correlation"))
        ) {
          throw new Error(
            `Unexpected ${value.type} while waiting for ${expected}`
          );
        }
        cleanup();
        resolve(value);
      } catch (error) {
        cleanup();
        reject(error);
      }
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

/**
 * Wait until a protocol companion is absent from the process table.
 * @param child - Protocol companion
 * @returns Promise settled after exit
 */
export function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise(resolve => child.once("exit", () => resolve()));
}

/**
 * Send one versioned message or reject a closed IPC channel.
 * @param child - Protocol companion
 * @param message - Exact message body without schema
 * @returns Callback-settled send promise
 */
export function sendMessage(
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

/**
 * Whether an IPC send failure proves the channel is already unusable.
 * @param error - IPC callback or synchronous error
 * @returns Whether the channel is conclusively closed
 */
function isClosedIpcError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ERR_IPC_CHANNEL_CLOSED" || code === "ERR_IPC_DISCONNECTED";
}

/**
 * Wait for the payload result and reject every other message.
 * @param bootstrap - Inert bootstrap leader
 * @param signalEscalating - Whether parent signal escalation owns its exit
 * @returns Exact payload result
 */
export function waitForPayload(
  bootstrap: ChildProcess,
  signalEscalating: () => boolean = () => false
): Promise<PayloadOutcome> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      try {
        const value = parseScratchProtocolMessage(message);
        if (value.type === "PAYLOAD_ERROR") {
          throw new Error(value["message"] as string);
        }
        if (value.type !== "PAYLOAD_EXIT") {
          throw new Error(`Unexpected ${value.type} during payload execution`);
        }
        cleanup();
        resolve({
          code: value["code"] as number | null,
          signal: value["signal"] as NodeJS.Signals | null,
        });
      } catch (error) {
        cleanup();
        reject(error);
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

/**
 * Stop the inert leader and wait for it to leave the target group.
 * @param bootstrap - Inert bootstrap leader
 */
export async function stopBootstrap(bootstrap: ChildProcess): Promise<void> {
  if (bootstrap.exitCode !== null || bootstrap.signalCode !== null) return;
  const exited = new Promise<void>(resolve =>
    bootstrap.once("exit", () => resolve())
  );
  try {
    await sendMessage(bootstrap, { type: "STOP" });
  } catch (error) {
    const alreadyExited =
      bootstrap.exitCode !== null || bootstrap.signalCode !== null;
    if (!alreadyExited && !isClosedIpcError(error)) throw error;
  }
  await exited;
}

#!/usr/bin/env node
/* eslint-disable functional/no-let, jsdoc/require-param, jsdoc/require-returns -- process lifecycle state is inherently event-driven */
/** Inert process-group leader that gates a supervised test payload on GO. */
import { spawn, type ChildProcess } from "node:child_process";
import { env } from "node:process";

import { parseScratchProtocolMessage } from "../configs/vitest/scratch-supervision.js";

/** Bootstrap command passed as one bounded JSON argv value. */
interface BootstrapCommandV1 {
  readonly schema: 1;
  readonly argv: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
}

/** Private deterministic IPC-close seam, never inherited by the payload. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Parse the bounded inert command envelope. */
function validateCommand(value: unknown): BootstrapCommandV1 {
  const candidate = value as Partial<BootstrapCommandV1>;
  if (
    typeof value !== "object" ||
    value === null ||
    candidate.schema !== 1 ||
    !Array.isArray(candidate.argv) ||
    candidate.argv.length === 0 ||
    !candidate.argv.every(argument => typeof argument === "string") ||
    typeof candidate.env !== "object" ||
    candidate.env === null ||
    !Object.values(candidate.env).every(entry => typeof entry === "string")
  ) {
    throw new Error("Invalid lisa-test-run bootstrap command schema");
  }
  return candidate as BootstrapCommandV1;
}

/** Forward one signal to the payload when it is still present. */
function signalPayload(
  payload: ChildProcess | undefined,
  signal: NodeJS.Signals
): void {
  try {
    payload?.kill(signal);
  } catch {
    // A concurrently exiting payload is already drained.
  }
}

/** Run the process-group leader protocol. */
function main(): void {
  let command: BootstrapCommandV1 | undefined;
  let payload: ChildProcess | undefined;
  let payloadExited = false;
  let failingClosed = false;

  /** Kill the payload and exit once when the supervisor channel is lost. */
  const failClosed = (): void => {
    if (failingClosed) return;
    failingClosed = true;
    if (!payloadExited) signalPayload(payload, "SIGKILL");
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  };

  /** Send with callback settlement so a close race cannot become unhandled. */
  const send = (message: Readonly<Record<string, unknown>>): void => {
    const type = message["type"];
    const fault = env[TEST_FAULT_ENV];
    if (
      (fault === "bootstrap-close-command-ready" && type === "COMMAND_READY") ||
      (fault === "bootstrap-close-payload-exit" && type === "PAYLOAD_EXIT")
    ) {
      if (process.connected) process.disconnect();
    }
    if (!process.connected || process.send === undefined) {
      failClosed();
      return;
    }
    try {
      process.send(message, error => {
        if (error !== null) failClosed();
      });
    } catch {
      failClosed();
    }
  };

  send({ schema: 1, type: "BOOTSTRAP_READY", pid: process.pid });

  process.on("message", message => {
    const protocolMessage = parseScratchProtocolMessage(message);
    const type = protocolMessage.type;
    if (type === "COMMAND" && command === undefined) {
      command = validateCommand(protocolMessage["command"]);
      send({ schema: 1, type: "COMMAND_READY" });
      return;
    }
    if (type === "GO" && payload === undefined && command !== undefined) {
      payload = spawn(command.argv[0], command.argv.slice(1), {
        cwd: process.cwd(),
        env: command.env,
        detached: false,
        shell: false,
        stdio: "inherit",
      });
      payload.once("error", error => {
        send({ schema: 1, type: "PAYLOAD_ERROR", message: error.message });
      });
      payload.once("exit", (code, signal) => {
        payloadExited = true;
        send({ schema: 1, type: "PAYLOAD_EXIT", code, signal });
      });
      return;
    }
    if (type === "SIGNAL") {
      const signal = (protocolMessage as { signal?: NodeJS.Signals }).signal;
      if (signal !== undefined) signalPayload(payload, signal);
      return;
    }
    if (type === "STOP") {
      if (!payloadExited) signalPayload(payload, "SIGKILL");
      process.disconnect();
      process.exit(0);
    }
  });

  process.on("disconnect", failClosed);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `lisa-test-run bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
/* eslint-enable functional/no-let, jsdoc/require-param, jsdoc/require-returns -- end process lifecycle state machine */

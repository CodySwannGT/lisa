#!/usr/bin/env node
/* eslint-disable functional/no-let, jsdoc/require-param, jsdoc/require-returns -- process lifecycle state is inherently event-driven */
/** Inert process-group leader that gates a supervised test payload on GO. */
import { spawn, type ChildProcess } from "node:child_process";

import { parseScratchProtocolMessage } from "../configs/vitest/scratch-supervision.js";

/** Bootstrap command passed as one bounded JSON argv value. */
interface BootstrapCommandV1 {
  readonly schema: 1;
  readonly argv: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
}

/** Maximum command envelope accepted from the foreground supervisor. */
const MAX_COMMAND_BYTES = 128 * 1024;

/** Send one IPC message only while the supervisor channel is open. */
function send(message: Readonly<Record<string, unknown>>): void {
  if (process.connected) process.send?.(message);
}

/** Parse the bounded inert command envelope. */
function commandFromArgv(): BootstrapCommandV1 {
  const raw = process.argv[2];
  if (raw === undefined || Buffer.byteLength(raw, "utf8") > MAX_COMMAND_BYTES) {
    throw new Error("Invalid lisa-test-run bootstrap command envelope");
  }
  const value = JSON.parse(raw) as Partial<BootstrapCommandV1>;
  if (
    value.schema !== 1 ||
    !Array.isArray(value.argv) ||
    value.argv.length === 0 ||
    !value.argv.every(argument => typeof argument === "string") ||
    typeof value.env !== "object" ||
    value.env === null ||
    !Object.values(value.env).every(entry => typeof entry === "string")
  ) {
    throw new Error("Invalid lisa-test-run bootstrap command schema");
  }
  return value as BootstrapCommandV1;
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
  const command = commandFromArgv();
  let payload: ChildProcess | undefined;
  let payloadExited = false;
  send({ schema: 1, type: "BOOTSTRAP_READY", pid: process.pid });

  process.on("message", message => {
    const protocolMessage = parseScratchProtocolMessage(message);
    const type = protocolMessage.type;
    if (type === "GO" && payload === undefined) {
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

  process.on("disconnect", () => {
    if (!payloadExited) signalPayload(payload, "SIGKILL");
    process.exit(1);
  });
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

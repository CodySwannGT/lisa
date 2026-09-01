#!/usr/bin/env node
/** Inert process-group leader that gates a supervised test payload on GO. */
import { spawn, type ChildProcess } from "node:child_process";
import { env } from "node:process";

import { parseScratchProtocolMessage } from "../configs/vitest/scratch-supervision.js";

/** Bootstrap command passed as one bounded JSON IPC value. */
interface BootstrapCommandV1 {
  readonly schema: 1;
  readonly argv: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
}

/** Mutable lifecycle facts confined to this one inert protocol process. */
interface BootstrapState {
  command?: BootstrapCommandV1;
  payload?: ChildProcess;
  payloadExited: boolean;
  failingClosed: boolean;
  phase:
    | "await-command"
    | "await-go"
    | "running"
    | "payload-exited"
    | "stopping";
}

/** Private deterministic IPC-close seam, never inherited by the payload. */
const TEST_FAULT_ENV = "LISA_TEST_RUN_TEST_FAULT";

/** Signals the foreground supervisor owns and the group leader must survive. */
const SUPERVISED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/**
 * Parse the exact bounded inert command envelope.
 * @param value - Parsed IPC command body
 * @returns Validated command
 */
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

/**
 * Forward one signal to the payload when it is still present.
 * @param payload - Current payload process
 * @param signal - Signal to deliver
 */
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

/**
 * Kill the payload and mark operational failure after channel loss.
 * @param state - Bootstrap lifecycle state
 */
function failClosed(state: BootstrapState): void {
  if (state.failingClosed) return;
  // eslint-disable-next-line functional/immutable-data -- one-process protocol state transition
  state.failingClosed = true;
  if (!state.payloadExited) signalPayload(state.payload, "SIGKILL");
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}

/**
 * Send one exact response with callback-safe channel settlement.
 * @param state - Bootstrap lifecycle state
 * @param message - Exact protocol response
 */
function sendResponse(
  state: BootstrapState,
  message: Readonly<Record<string, unknown>>
): void {
  const type = message["type"];
  const fault = env[TEST_FAULT_ENV];
  const closeForFault =
    (fault === "bootstrap-close-command-ready" && type === "COMMAND_READY") ||
    (fault === "bootstrap-close-payload-exit" && type === "PAYLOAD_EXIT");
  if (closeForFault && process.connected) process.disconnect();
  if (!process.connected || process.send === undefined) {
    failClosed(state);
    return;
  }
  try {
    process.send(message, error => {
      if (error !== null) failClosed(state);
    });
  } catch {
    failClosed(state);
  }
}

/**
 * Start one payload only after the ordered COMMAND/GO handshake.
 * @param state - Bootstrap lifecycle state
 * @param command - Immutable payload command
 */
function startPayload(
  state: BootstrapState,
  command: BootstrapCommandV1
): void {
  // eslint-disable-next-line functional/immutable-data -- ordered protocol transition before spawn
  state.phase = "running";
  const payload = spawn(command.argv[0], command.argv.slice(1), {
    cwd: process.cwd(),
    env: command.env,
    detached: false,
    shell: false,
    stdio: "inherit",
  });
  // eslint-disable-next-line functional/immutable-data -- single owned payload handle
  state.payload = payload;
  payload.once("error", error => {
    sendResponse(state, {
      schema: 1,
      type: "PAYLOAD_ERROR",
      message: error.message,
    });
  });
  payload.once("exit", (code, signal) => {
    // eslint-disable-next-line functional/immutable-data -- terminal payload state
    state.payloadExited = true;
    // eslint-disable-next-line functional/immutable-data -- terminal payload state
    state.phase = "payload-exited";
    sendResponse(state, { schema: 1, type: "PAYLOAD_EXIT", code, signal });
  });
}

/**
 * Deliver a forwarded signal, treating one outside `running` as the race it is.
 *
 * Two windows produce a legitimate out-of-phase SIGNAL: the supervisor arms its
 * handlers before it sends GO, so a signal there arrives in `await-go`; and the
 * payload's own exit records `payload-exited` before PAYLOAD_EXIT reaches the
 * supervisor, so a signal forwarded in that gap arrives after there is anything
 * left to signal. Refusing either would fail this process closed -- exit 1 and
 * an abrupt disconnect -- reporting an ordinary signal-terminated run as a
 * protocol refusal plus an unexpected channel loss.
 * @param state - Bootstrap lifecycle state
 * @param signal - Signal the supervisor forwarded
 */
function forwardSignal(state: BootstrapState, signal: NodeJS.Signals): void {
  if (state.phase !== "running") return;
  signalPayload(state.payload, signal);
}

/**
 * Apply one already-validated message to the exact protocol phase.
 * @param state - Bootstrap lifecycle state
 * @param message - Untrusted IPC message
 */
function handleMessage(state: BootstrapState, message: unknown): void {
  const protocol = parseScratchProtocolMessage(message);
  const type = protocol.type;
  if (state.phase === "await-command" && type === "COMMAND") {
    // eslint-disable-next-line functional/immutable-data -- command becomes immutable after the one accepted transition
    state.command = validateCommand(protocol["command"]);
    // eslint-disable-next-line functional/immutable-data -- ordered protocol transition
    state.phase = "await-go";
    sendResponse(state, { schema: 1, type: "COMMAND_READY" });
    return;
  }
  if (state.phase === "await-go" && type === "GO" && state.command) {
    startPayload(state, state.command);
    return;
  }
  if (type === "SIGNAL") {
    forwardSignal(state, protocol["signal"] as NodeJS.Signals);
    return;
  }
  if (type === "STOP" && state.phase !== "stopping") {
    // eslint-disable-next-line functional/immutable-data -- terminal protocol transition
    state.phase = "stopping";
    if (!state.payloadExited) signalPayload(state.payload, "SIGKILL");
    process.disconnect();
    process.exit(0);
  }
  throw new Error(`Unexpected ${type} in bootstrap state ${state.phase}`);
}

/** Run the process-group leader protocol. */
function main(): void {
  const state: BootstrapState = {
    payloadExited: false,
    failingClosed: false,
    phase: "await-command",
  };
  for (const signal of SUPERVISED_SIGNALS) {
    process.on(signal, () => undefined);
  }
  sendResponse(state, { schema: 1, type: "BOOTSTRAP_READY", pid: process.pid });
  process.on("message", message => {
    try {
      handleMessage(state, message);
    } catch (error) {
      process.stderr.write(
        `lisa-test-run bootstrap refused protocol: ${error instanceof Error ? error.message : String(error)}\n`
      );
      failClosed(state);
    }
  });
  process.on("disconnect", () => failClosed(state));
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `lisa-test-run bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}

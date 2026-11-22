/**
 * Run the test payload as a plain foreground child.
 *
 * This replaced the supervised launch (bootstrap, detached reaper, owned
 * scratch run root and process-group authority) when the per-test temp-folder
 * and process policing was retired (CodySwannGT/lisa#4602). What it still owes
 * the caller is small: the payload inherits this process's stdio and
 * environment (which by now carries the sweep's `LISA_TEST_RUN_OWNER` marker),
 * a signal sent to this process reaches the payload, and the payload's own exit
 * code or signal comes back unchanged. Orphans a killed run leaves behind are
 * the next run's start-of-run sweep's to clear (CodySwannGT/lisa#4597).
 * @module cli/lisa-test-run-payload
 */
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

/** Payload delivery the public CLI still accepts; both now run the same way. */
export type TestRunAdapter = "vitest" | "direct";

/** How the payload ended. */
export interface PayloadOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Signals relayed from this process to the payload. */
export const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/** Seams for {@link runTestPayload}; production uses the defaults. */
export interface RunTestPayloadSeams {
  readonly spawnChild?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcess;
  readonly signalSource?: Pick<NodeJS.Process, "on" | "off">;
}

/**
 * Start the payload, relay signals to it, and resolve with how it ended.
 * @param argv - Payload executable and arguments
 * @param environment - Environment the payload inherits
 * @param seams - Injected spawn and signal source
 * @returns The payload's exit code or terminating signal
 */
export function runTestPayload(
  argv: readonly [string, ...string[]],
  environment: NodeJS.ProcessEnv,
  seams: RunTestPayloadSeams = {}
): Promise<PayloadOutcome> {
  const { spawnChild = spawn, signalSource = process } = seams;
  return new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    const child = spawnChild(command, args, {
      stdio: "inherit",
      env: environment,
    });
    const relay = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    const detach = (): void => {
      for (const signal of FORWARDED_SIGNALS) signalSource.off(signal, relay);
    };
    for (const signal of FORWARDED_SIGNALS) signalSource.on(signal, relay);
    child.once("error", error => {
      detach();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      detach();
      resolve({ code, signal });
    });
  });
}

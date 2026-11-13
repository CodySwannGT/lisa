/**
 * Headroom-based admission for heavy runs (CodySwannGT/lisa#4596).
 *
 * Runs go in parallel while the machine has capacity and queue only when it
 * does not. The wait is bounded and ends in a refusal that names the runs
 * holding the machine; there is no "start anyway". It replaces the fixed-count
 * fleet admission that only ever covered Lisa's own Vitest runs.
 *
 * Callers: `lisa admit --workers <n> -- <command>` (the gate runner and other
 * scripts) and `lisa-test-run` (in process). Both switch it on only where
 * `.lisa.config.json` sets `pushGate.admission: true`.
 * @module core/admission
 */
import { rmSync } from "node:fs";
import { env } from "node:process";

import {
  type AdmissionReservation,
  decideHeadroom,
  describeHolders,
  type MachineReading,
} from "./admission-decision.js";
import {
  ADMISSION_HOLDER_ENV,
  ADMITTED_WORKERS_ENV,
  type AdmissionSettings,
} from "./admission-settings.js";
import {
  acquireDecisionLock,
  pidAlive,
  processStartTimes,
  readLiveReservations,
  readMachine,
  type ReservationProbes,
  writeReservation,
} from "./admission-state.js";

/** Exit status of a run refused after the wait bound (EX_TEMPFAIL). */
export const ADMISSION_REFUSED_EXIT = 75;

/** What a caller asks for. */
export interface AdmissionRequest {
  /** Workers the run declares. */
  readonly workers: number;
  /** Fewest workers it accepts; defaults to `workers` (not sizable). */
  readonly minimumWorkers?: number;
  /** The command, as the waiting message names it. */
  readonly command: string;
  /** Working directory recorded in the reservation. */
  readonly cwd: string;
  /** Resolved settings. */
  readonly settings: AdmissionSettings;
  /** Environment, read for a parent reservation. */
  readonly environment: NodeJS.ProcessEnv;
}

/** Seams, so tests state the machine and the clock. */
export interface AdmissionRuntime {
  /** This run's pid, which names its reservation. */
  readonly pid: number;
  /** Read the machine. */
  readonly readMachine: () => MachineReading;
  /** Liveness probes. */
  readonly probes: ReservationProbes;
  /** Wall clock. */
  readonly now: () => number;
  /** Wait. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Where messages go. */
  readonly log: (line: string) => void;
}

/** The result of asking. */
export type AdmissionOutcome =
  | {
      readonly kind: "admitted";
      readonly granted: number;
      readonly release: () => void;
    }
  | { readonly kind: "skipped"; readonly granted: number }
  | { readonly kind: "refused"; readonly message: string };

/**
 * Test seam: a stated machine reading in place of the real one.
 *
 * Integration tests start real `lisa admit` processes against one state
 * directory and need a machine whose headroom they choose; real load average
 * is whatever the host happens to carry. Only the reading is replaced — the
 * lock, the reservation files and the liveness probes stay real.
 */
export const FAKE_MACHINE_ENV = "LISA_ADMISSION_FAKE_MACHINE";

/**
 * The reading source: real, or the stated test reading.
 * @param environment - Environment
 * @returns Reader
 */
function machineReader(environment: NodeJS.ProcessEnv): () => MachineReading {
  const stated = environment[FAKE_MACHINE_ENV];
  if (stated === undefined || stated === "") return readMachine;
  const reading = JSON.parse(stated) as MachineReading;
  return () => reading;
}

/**
 * The runtime a real run uses.
 * @param environment - Environment, read for the test seam
 * @returns Seams bound to this machine
 */
export function defaultAdmissionRuntime(
  environment: NodeJS.ProcessEnv = env
): AdmissionRuntime {
  return {
    pid: process.pid,
    readMachine: machineReader(environment),
    probes: { isAlive: pidAlive, startTimes: processStartTimes },
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: line => process.stderr.write(`${line}\n`),
  };
}

/**
 * Whether this process already runs inside another run's reservation.
 * @param environment - Environment
 * @param self - This pid
 * @returns The holder pid, or undefined
 */
function parentHolder(
  environment: NodeJS.ProcessEnv,
  self: number
): number | undefined {
  const pid = Number(environment[ADMISSION_HOLDER_ENV]);
  return Number.isInteger(pid) && pid > 0 && pid !== self && pidAlive(pid)
    ? pid
    : undefined;
}

/** One attempt's result. */
type Attempt =
  | { readonly admitted: true; readonly granted: number; readonly path: string }
  | {
      readonly admitted: false;
      readonly reason: string;
      readonly holders: readonly AdmissionReservation[];
    };

/**
 * Decide once, under the lock, and reserve when admitted.
 * @param request - The request
 * @param runtime - Seams
 * @returns The attempt
 */
async function attemptOnce(
  request: AdmissionRequest,
  runtime: AdmissionRuntime
): Promise<Attempt> {
  const { settings } = request;
  const release = await acquireDecisionLock(settings.stateDir, runtime.sleep);
  try {
    const holders = readLiveReservations(
      settings.stateDir,
      runtime.probes
    ).filter(reservation => reservation.pid !== runtime.pid);
    const now = runtime.now();
    const decision = decideHeadroom({
      reading: runtime.readMachine(),
      reservations: holders,
      now,
      workers: request.workers,
      minimumWorkers: request.minimumWorkers ?? request.workers,
      thresholds: settings.thresholds,
    });
    if (!decision.admit) {
      return { admitted: false, reason: decision.reason, holders };
    }
    const path = writeReservation(settings.stateDir, {
      pid: runtime.pid,
      processStartTime:
        runtime.probes.startTimes([runtime.pid]).get(runtime.pid) ?? null,
      workers: decision.granted,
      command: request.command,
      cwd: request.cwd,
      startedAt: now,
    });
    return { admitted: true, granted: decision.granted, path };
  } finally {
    await release();
  }
}

/**
 * The refusal an operator reads when the bound expires.
 * @param request - The request
 * @param attempt - The last attempt
 * @param waitedMs - How long it waited
 * @param now - Wall clock
 * @returns Message
 */
function refusal(
  request: AdmissionRequest,
  attempt: Extract<Attempt, { admitted: false }>,
  waitedMs: number,
  now: number
): string {
  const hint = request.settings.push
    ? " Run `lisa check` (or the slow step) first so the push finds the machine free, or raise LISA_ADMISSION_PUSH_MAX_WAIT."
    : " Retry when they finish, or raise LISA_ADMISSION_MAX_WAIT.";
  return (
    `lisa admission: refused \`${request.command}\` after ${String(Math.round(waitedMs / 1000))}s — the machine stayed busy (${attempt.reason}). ` +
    `Runs holding it: ${describeHolders(attempt.holders, now)}. Nothing was started.${hint}`
  );
}

/**
 * Ask until admitted or the bound expires.
 * @param request - The request
 * @param runtime - Seams
 * @param startedAt - When waiting began
 * @param announced - The last waiting message printed
 * @returns The outcome
 */
async function poll(
  request: AdmissionRequest,
  runtime: AdmissionRuntime,
  startedAt: number,
  announced: string
): Promise<AdmissionOutcome> {
  const attempt = await attemptOnce(request, runtime);
  if (attempt.admitted) {
    runtime.log(
      `lisa admission: admitted \`${request.command}\` with ${String(attempt.granted)} worker(s)`
    );
    return {
      kind: "admitted",
      granted: attempt.granted,
      release: () => rmSync(attempt.path, { force: true }),
    };
  }
  const now = runtime.now();
  const waited = now - startedAt;
  const remaining = request.settings.maxWaitMs - waited;
  if (remaining <= 0) {
    return { kind: "refused", message: refusal(request, attempt, waited, now) };
  }
  const holders = describeHolders(attempt.holders, now).replace(
    /, \d+s ago\)/gu,
    ")"
  );
  if (holders !== announced) {
    runtime.log(
      `lisa admission: waiting for headroom for \`${request.command}\` — ${attempt.reason}. ` +
        `Held by: ${describeHolders(attempt.holders, now)}. Gives up in ${String(Math.ceil(remaining / 1000))}s.`
    );
  }
  await runtime.sleep(Math.min(request.settings.pollMs, remaining));
  return poll(request, runtime, startedAt, holders);
}

/**
 * Admit a heavy run when the machine has headroom for it.
 * @param request - The request
 * @param runtime - Seams; defaults to this machine
 * @returns Admitted (with a release), skipped, or refused
 */
export async function requestAdmission(
  request: AdmissionRequest,
  runtime: AdmissionRuntime = defaultAdmissionRuntime()
): Promise<AdmissionOutcome> {
  if (request.settings.skipped !== null) {
    runtime.log(`lisa admission: ${request.settings.skipped}; starting now`);
    return { kind: "skipped", granted: request.workers };
  }
  const holder = parentHolder(request.environment, runtime.pid);
  if (holder !== undefined) {
    // A nested run (a gate inside an admitted push step, a suite spawning a
    // suite) already lives inside its parent's reservation. Reserving again
    // would count one unit of work twice and can deadlock parent against child.
    const inherited = Number(request.environment[ADMITTED_WORKERS_ENV]);
    return {
      kind: "skipped",
      granted:
        Number.isInteger(inherited) && inherited > 0
          ? Math.min(inherited, request.workers)
          : request.workers,
    };
  }
  return poll(request, runtime, runtime.now(), "");
}

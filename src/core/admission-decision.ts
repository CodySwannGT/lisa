/**
 * The headroom rule that decides whether a heavy run may start now.
 *
 * Several agent sessions share one machine. When they all start heavy suites at
 * once, a ten-minute run becomes a multi-hour flaky one (CodySwannGT/lisa#4505).
 * The rule here admits a run when the machine has room for the workers it
 * declares, and queues it when it does not:
 *
 * `headroom = cores x maxLoadPerCore - load1 - workers of reservations started
 * in the last 60 s`
 *
 * The recent reservations are subtracted because load average lags new work: a
 * run admitted a second ago has not raised `load1` yet, and without that term
 * two runs asking at the same moment would both spend the same headroom.
 *
 * Everything in this file is pure. The readings, the clock and the reservation
 * list come in as arguments, so every rule is unit-tested without a machine.
 * @module core/admission-decision
 */

/** One admitted run, as its reservation file records it. */
export interface AdmissionReservation {
  /** Process id of the admitted run. */
  readonly pid: number;
  /** The process start time `ps` reported at admission, or null when unknown. */
  readonly processStartTime: string | null;
  /** Workers the run was granted. */
  readonly workers: number;
  /** The command the run executes, for the waiting message. */
  readonly command: string;
  /** Working directory of the run, so a reader can tell repositories apart. */
  readonly cwd: string;
  /** Epoch milliseconds at which the run was admitted. */
  readonly startedAt: number;
}

/** One reading of the machine. */
export interface MachineReading {
  /** Logical cores available. */
  readonly cores: number;
  /** One-minute load average. */
  readonly load1: number;
  /** Memory available to a new process, in megabytes. */
  readonly freeMemoryMb: number;
}

/** The thresholds a decision is made against. */
export interface HeadroomThresholds {
  /** Load per core the machine may carry; capacity is `cores x` this. */
  readonly maxLoadPerCore: number;
  /** Free memory that must remain, in megabytes. */
  readonly minFreeMemoryMb: number;
  /** How long a fresh reservation counts against headroom, in milliseconds. */
  readonly recentWindowMs: number;
}

/** Everything one decision is made from. */
export interface HeadroomInput {
  /** The machine right now. */
  readonly reading: MachineReading;
  /** Live reservations (dead ones already removed). */
  readonly reservations: readonly AdmissionReservation[];
  /** Wall clock, epoch milliseconds. */
  readonly now: number;
  /** Workers this run asks for. */
  readonly workers: number;
  /** The fewest workers this run accepts; equal to `workers` when it cannot be sized. */
  readonly minimumWorkers: number;
  /** Thresholds. */
  readonly thresholds: HeadroomThresholds;
}

/** What a decision concluded. */
export interface HeadroomDecision {
  /** Whether the run may start now. */
  readonly admit: boolean;
  /** Workers granted, or 0 when the run must wait. */
  readonly granted: number;
  /** Whole workers of headroom observed. */
  readonly headroom: number;
  /** Why it must wait, in plain words; empty when admitted. */
  readonly reason: string;
}

/** Default load a core may carry before the machine counts as busy. */
export const DEFAULT_MAX_LOAD_PER_CORE = 1;

/** Default free-memory floor, in megabytes. */
export const DEFAULT_MIN_FREE_MEMORY_MB = 512;

/** How long a fresh reservation counts against headroom. */
export const RECENT_RESERVATION_WINDOW_MS = 60_000;

/**
 * Workers held by reservations too new to show up in `load1`.
 * @param reservations - Live reservations
 * @param now - Wall clock, epoch milliseconds
 * @param windowMs - How long a reservation counts
 * @returns The sum of their workers
 */
export function recentlyReservedWorkers(
  reservations: readonly AdmissionReservation[],
  now: number,
  windowMs: number
): number {
  return reservations
    .filter(reservation => now - reservation.startedAt < windowMs)
    .reduce((sum, reservation) => sum + reservation.workers, 0);
}

/**
 * Decide whether a run may start now, and with how many workers.
 *
 * A run cannot ask for more than the whole machine: on a two-core host a suite
 * declaring eight workers would otherwise wait forever, so demand is clamped to
 * the capacity (never below one).
 * @param input - Readings, reservations and thresholds
 * @returns The decision
 */
export function decideHeadroom(input: HeadroomInput): HeadroomDecision {
  const { reading, thresholds } = input;
  const capacity = reading.cores * thresholds.maxLoadPerCore;
  const recent = recentlyReservedWorkers(
    input.reservations,
    input.now,
    thresholds.recentWindowMs
  );
  const headroom = Math.floor(capacity - reading.load1 - recent);
  const demand = Math.min(input.workers, Math.max(1, Math.floor(capacity)));
  const minimum = Math.max(1, Math.min(input.minimumWorkers, demand));
  if (reading.freeMemoryMb < thresholds.minFreeMemoryMb) {
    return {
      admit: false,
      granted: 0,
      headroom,
      reason: `only ${String(Math.round(reading.freeMemoryMb))} MB of memory is free (needs ${String(thresholds.minFreeMemoryMb)} MB)`,
    };
  }
  if (headroom < minimum) {
    return {
      admit: false,
      granted: 0,
      headroom,
      reason: `needs ${String(minimum)} worker(s) but the headroom is ${String(Math.max(0, headroom))} (load ${reading.load1.toFixed(1)} on ${String(reading.cores)} cores, ${String(recent)} worker(s) just admitted)`,
    };
  }
  return {
    admit: true,
    granted: Math.min(demand, headroom),
    headroom,
    reason: "",
  };
}

/**
 * Describe the runs holding the machine, for a waiting or refusal message.
 * @param reservations - Live reservations
 * @param now - Wall clock, epoch milliseconds
 * @returns One line per run, or a sentence saying there are none
 */
export function describeHolders(
  reservations: readonly AdmissionReservation[],
  now: number
): string {
  if (reservations.length === 0) {
    return "no Lisa run holds a reservation; the load comes from other work on this machine";
  }
  return reservations
    .map(
      reservation =>
        `pid ${String(reservation.pid)}: \`${reservation.command}\` in ${reservation.cwd} (${String(reservation.workers)} worker(s), ${String(Math.round((now - reservation.startedAt) / 1000))}s ago)`
    )
    .join("; ");
}

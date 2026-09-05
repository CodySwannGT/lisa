/**
 * Admission control for the fleet's test runs.
 *
 * ## The gap this fills
 *
 * `resolveMaxWorkers` has three layers and all three size a *pool*. None of
 * them decides whether a run may start. Past the point where the divisor
 * saturates that distinction becomes the whole problem: on eighteen cores
 * `floor(cores / 2 / fleet)` clamps to {@link MIN_FLEET_WORKERS} from a fleet of
 * five upward, so fleets of 5, 13, 20 and 50 all resolve to two workers each and
 * the fleet's TOTAL demand is `2 x fleet` — 26 workers at thirteen runs, 100 at
 * fifty, on a machine with eighteen cores. The layer's own docstring says it
 * bounds the fleet "rather than multiplied by its own size"; past four runs it
 * multiplies (CodySwannGT/lisa#3941).
 *
 * The arithmetic is not a bug in the divisor. **With a per-run floor that may
 * not be lowered, no pool-sizing rule can bound a sum over an unbounded number
 * of runs.** Bounding it requires deciding that some run does not execute yet.
 * That decision is what this module is.
 *
 * ## Why the floor is not the lever
 *
 * {@link MIN_FLEET_WORKERS} is measured and deliberately out of scope. One
 * worker serialises a suite, so every file waits behind every other file and
 * per-test budgets expire even as machine load falls — the recorded 124-timeouts
 * -against-54 result. Lowering it trades a visible failure for a subtler one,
 * which is the move this module exists to avoid rather than to make.
 *
 * ## The rule, and why it cannot deadlock
 *
 * Every supervised run registers a `run-<pid>-<startedAt>-<suffix>` root before
 * its payload starts. A run admits itself when its own root is among the
 * {@link fleetCapacity} OLDEST live roots. That is a total order on facts each
 * run can read for itself: no lock, no leader, no coordinator, and no message
 * anybody has to receive. At least `capacity` runs always satisfy it, so the
 * fleet always makes progress, and a waiting run's rank improves for free as
 * older runs finish and their roots disappear.
 *
 * Ranking by age rather than by, say, pid also makes the queue fair in the one
 * direction that matters: the run that has been waiting longest goes first, so
 * nothing starves.
 *
 * ## Every unknown admits
 *
 * This runs before a single test does, so a mistake here does not degrade a run,
 * it prevents one. Unranked (the run registered no root, or is unsupervised), an
 * unreadable namespace, a capacity of zero, a disabled switch, an expired
 * deadline — all admit. The control bounds demand when it can see the fleet and
 * gets out of the way when it cannot. It is deliberately NOT fail-closed:
 * refusing to run on missing information would turn a load control into a
 * correctness signal, and a red gate reads exactly like a regression.
 *
 * ## Why the deadline exists
 *
 * A run that waits forever is worse than an overloaded machine. The agent
 * watching it sees a hang, kills it, and retries — which is the cascade the cap
 * exists to stop, arriving through the control rather than around it. So the
 * wait is bounded, and expiry admits with a notice rather than refusing. Past
 * the deadline the behaviour degrades exactly to what shipped before this
 * module, loudly.
 * @module configs/vitest/fleet-admission
 */
import { env } from "node:process";

import { MIN_FLEET_WORKERS, fleetShare } from "./base.js";
import { parseScratchRunRootName } from "./scratch-owner.js";

/**
 * Environment variable that switches admission off entirely.
 *
 * The value `off` disables the wait; anything else leaves it armed. This
 * matches the escape hatch `LISA_VITEST_MAX_WORKERS` already provides and the
 * reason given for it — a cap nobody can lift is a cap that gets worked around
 * by deleting it. This is a load control, not a safety guard, and the two want
 * opposite answers about overrides.
 */
export const FLEET_ADMISSION_VAR = "LISA_FLEET_ADMISSION";

/** Value of {@link FLEET_ADMISSION_VAR} that disables the wait. */
export const FLEET_ADMISSION_OFF = "off";

/** Environment variable overriding how long a run may wait for a slot. */
export const FLEET_ADMISSION_DEADLINE_VAR = "LISA_FLEET_ADMISSION_DEADLINE_MS";

/**
 * How long a run waits for a slot before starting anyway.
 *
 * Two minutes is long enough for a typical unit suite ahead of it to finish and
 * short enough that a stuck older run cannot look like a hang. It is not a
 * measured optimum and is overridable; what matters is that it is finite.
 */
export const DEFAULT_ADMISSION_DEADLINE_MS = 120_000;

/** How often a waiting run re-reads the namespace. */
export const ADMISSION_POLL_MS = 2_000;

/** One live run root, as the namespace names it. */
export interface FleetRunRoot {
  /** The directory basename, which is the run's identity. */
  readonly basename: string;
  /** Owning process id. */
  readonly pid: number;
  /** Epoch milliseconds at which the root was created. */
  readonly startedAt: number;
}

/** What admission decided, and why. */
export type AdmissionDecision =
  | "admit-alone"
  | "admit-within-capacity"
  | "admit-unranked"
  | "admit-disabled"
  | "admit-deadline-expired"
  | "wait";

/** One admission verdict, with the sentence an operator reads. */
export interface AdmissionVerdict {
  /** What was decided. */
  readonly decision: AdmissionDecision;
  /** Whether the run may execute now. */
  readonly admitted: boolean;
  /** Operator-readable single line, or empty when there is nothing to say. */
  readonly notice: string;
}

/**
 * How many runs may execute workers at once before demand exceeds the machine.
 *
 * The bound is the same one the divisor layer starts from — half the cores —
 * divided by the smallest pool a run may be given. Below that, admitting
 * another run necessarily pushes total demand past the machine, because every
 * admitted run is entitled to {@link MIN_FLEET_WORKERS}.
 *
 * Never zero. A machine too small to host one run at the minimum still has to
 * run its tests, and a capacity of zero would refuse every run on every
 * two-core CI runner.
 * @param cores - Logical cores available.
 * @returns The number of runs that may execute concurrently, at least one.
 */
export function fleetCapacity(cores: number): number {
  return Math.max(1, Math.floor(cores / 2 / MIN_FLEET_WORKERS));
}

/**
 * Total workers the fleet demands once admission is enforced.
 *
 * The property #3941 asks for, expressed as a number a test can check at any
 * fleet size. Pool sizing alone cannot satisfy it: `fleetShare(cores, fleet) *
 * fleet` grows without bound in `fleet`, because the share stops falling at the
 * floor. Capping the count of runs that execute is what makes the product stop
 * growing.
 * @param fleet - How many runs want to execute.
 * @param cores - Logical cores available.
 * @returns Workers demanded by the runs actually executing.
 */
export function admittedWorkerDemand(fleet: number, cores: number): number {
  const wanted = Math.max(1, Math.floor(fleet));
  const admitted = Math.min(wanted, fleetCapacity(cores));
  return admitted * fleetShare(cores, wanted);
}

/**
 * Where a run stands in the queue, oldest first.
 *
 * Ordered by creation time, then by pid, then by basename — a total order over
 * facts every run reads identically, so two runs never both believe they hold
 * the same slot. Ties on the millisecond are real: several lanes launched
 * together routinely share a timestamp.
 * @param roots - Live run roots read from the namespace.
 * @param selfBasename - This run's own root basename, if it has one.
 * @returns The zero-based position, or undefined when this run is not among them.
 */
export function admissionRank(
  roots: readonly FleetRunRoot[],
  selfBasename: string | undefined
): number | undefined {
  if (selfBasename === undefined) return undefined;
  const ordered = [...roots].sort(
    (left, right) =>
      left.startedAt - right.startedAt ||
      left.pid - right.pid ||
      (left.basename < right.basename
        ? -1
        : left.basename > right.basename
          ? 1
          : 0)
  );
  const position = ordered.findIndex(root => root.basename === selfBasename);
  return position === -1 ? undefined : position;
}

/**
 * Parse the run roots out of one namespace listing.
 * @param names - Directory basenames, already bounded by the caller.
 * @returns The entries that are run roots, in the order given.
 */
export function readFleetRunRoots(
  names: readonly string[]
): readonly FleetRunRoot[] {
  return names.flatMap(basename => {
    const owner = parseScratchRunRootName(basename);
    return owner === undefined
      ? []
      : [{ basename, pid: owner.pid, startedAt: owner.startedAt }];
  });
}

/**
 * Read the admission deadline an operator stated, or the default.
 * @param environment - Environment to read.
 * @returns Milliseconds a run may wait before starting anyway.
 */
export function admissionDeadlineMs(
  environment: NodeJS.ProcessEnv = env
): number {
  const raw = environment[FLEET_ADMISSION_DEADLINE_VAR]?.trim();
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    return DEFAULT_ADMISSION_DEADLINE_MS;
  }
  const value = Number(raw);
  return value > 0 ? value : DEFAULT_ADMISSION_DEADLINE_MS;
}

/**
 * Whether admission is armed at all.
 * @param environment - Environment to read.
 * @returns Whether the wait should be attempted.
 */
export function admissionEnabled(
  environment: NodeJS.ProcessEnv = env
): boolean {
  return environment[FLEET_ADMISSION_VAR]?.trim() !== FLEET_ADMISSION_OFF;
}

/** Everything one admission decision is made from. */
export interface AdmissionInput {
  /** This run's queue position, or undefined when it has none. */
  readonly rank: number | undefined;
  /** How many runs may execute at once. */
  readonly capacity: number;
  /** How many live runs were observed, including this one. */
  readonly liveRuns: number;
  /** Milliseconds spent waiting so far. */
  readonly elapsedMs: number;
  /** Milliseconds this run may wait in total. */
  readonly deadlineMs: number;
  /** Whether admission is armed. */
  readonly enabled: boolean;
}

/**
 * Decide whether this run may execute now, and say so in one line.
 *
 * The order of the branches is the order of confidence. Anything this cannot
 * measure admits before anything it can measure is consulted, so a defect in
 * the ranking can only make the control weaker, never make it refuse a run it
 * should have allowed.
 * @param input - The facts the decision is made from.
 * @returns The verdict and its operator-readable notice.
 */
export function admissionVerdict(input: AdmissionInput): AdmissionVerdict {
  if (!input.enabled) {
    return { decision: "admit-disabled", admitted: true, notice: "" };
  }
  if (input.rank === undefined) {
    return { decision: "admit-unranked", admitted: true, notice: "" };
  }
  if (input.rank < input.capacity) {
    return {
      decision: input.liveRuns <= 1 ? "admit-alone" : "admit-within-capacity",
      admitted: true,
      notice: "",
    };
  }
  if (input.elapsedMs >= input.deadlineMs) {
    return {
      decision: "admit-deadline-expired",
      admitted: true,
      notice: overCapacityNotice(input),
    };
  }
  return { decision: "wait", admitted: false, notice: waitingNotice(input) };
}

/**
 * The line a run prints while it is waiting for a slot.
 * @param input - The facts the decision was made from.
 * @returns One operator-readable line.
 */
function waitingNotice(input: AdmissionInput): string {
  return (
    `lisa fleet admission: waiting for a worker slot — ` +
    `${String(input.liveRuns)} run(s) live, this run is #${String((input.rank ?? 0) + 1)}, ` +
    `${String(input.capacity)} may execute at once. ` +
    `Starting anyway in ${String(Math.max(0, Math.ceil((input.deadlineMs - input.elapsedMs) / 1000)))}s. ` +
    `Set ${FLEET_ADMISSION_VAR}=${FLEET_ADMISSION_OFF} to disable this wait.`
  );
}

/**
 * The line a run prints when it starts despite being over capacity.
 * @param input - The facts the decision was made from.
 * @returns One operator-readable line.
 */
function overCapacityNotice(input: AdmissionInput): string {
  return (
    `lisa fleet admission: starting OVER CAPACITY after ` +
    `${String(Math.round(input.elapsedMs / 1000))}s — ` +
    `${String(input.liveRuns)} run(s) live, this run is #${String((input.rank ?? 0) + 1)}, ` +
    `${String(input.capacity)} may execute at once. ` +
    `The machine is oversubscribed; expect timeouts rather than failures.`
  );
}

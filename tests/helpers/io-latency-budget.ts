import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Budget for suites whose work has unbounded latency, expressed in units of
 * the machine rather than in units of the wall clock.
 *
 * Two mechanisms, one cause. CodySwannGT/lisa#2490 names both: a case either
 * spawns an external process synchronously (`bash`, `git`, `tsc`, `npm pack`)
 * or performs many `fsync`-paired filesystem transactions. Neither has a bound
 * under contention, and both are billed against a fixed wall-clock budget. The
 * helper is named for the latency, not the spawn, because the fsync-heavy
 * suites fail exactly the same way and a name covering only half the cause
 * would send the next person looking for the wrong thing.
 *
 * EVERY figure below cites the machine state it was measured under, and that is
 * a hard requirement rather than a courtesy. A timing number is meaningless
 * without its conditions, and this module exists because one was reported
 * without them: `check-learnings-budget` was measured at 45.8s "in isolation"
 * while ~56 sibling vitest processes were live, and that retracted number very
 * nearly shipped here as a permanent code comment. Nothing errors when this
 * happens — the command succeeds and returns a true number about the wrong
 * thing — so no guard, exit code, or reviewer catches it. Publishing the
 * conditions is the only defense: it turns an unfalsifiable figure into one the
 * next person can re-measure and contradict.
 *
 * ## Why a fixed number was replaced by a measured ratio
 *
 * CodySwannGT/lisa#2822: a fixed wall-clock budget over a subprocess measures
 * the machine, not the code, and the number had already been guessed twice
 * (10s, then 60s). A third guess is the same move again. So the budget is no
 * longer a number — it is `base x measured spawn slowdown`, where the slowdown
 * is this worker's own `spawnSync` latency divided by a recorded quiet-box
 * figure. When the box is slow the budget widens in exact proportion; when the
 * box is quiet the budget stays tight, so a genuine hang still surfaces in
 * roughly `base` rather than in ten minutes.
 *
 * Measured on this repository, 18 cores, `bun run vitest` over the four suites
 * CodySwannGT/lisa#2822 names, `ps aux | grep -c '[v]itest'` stated per arm
 * (`pgrep -f vitest` under-reports and `pgrep -fc` is not a count):
 *
 * | arm | vitest procs | 1-min load | node spawn latency (median of 9) |
 * |---|---|---|---|
 * | quiet-ish | 5 | 8.0 | 17.3-19.1ms |
 * | 12 concurrent suite runs | 79 | 21.5-41.8 | 70.5ms (min 38.8, max 116.0) |
 *
 * A ~4x inflation in the cost of the one operation these suites are made of,
 * from load alone, with no code change. Same arm, same suites, per-case wall
 * time: `npm pack` case 2.7s -> 36.6s, `plugin-sync-scripts` 1.8-4.6s ->
 * 27.3-30.7s, `standards-proof-typescript` 3.8-4.1s -> 17.5-24.5s,
 * `learnings-writer` contention 1.3s -> 13.8s. Nothing about the code moved.
 *
 * ## The margin is asserted, not hoped for
 *
 * A budget with no headroom fails to jitter forever — `learnings-writer` failed
 * at **10,259ms against a 10,000ms budget (2.6% over)** and then passed 5/5 on
 * immediate re-run under the SAME conditions. Unchanged box, changed result:
 * that is no headroom, not load-sensitivity. So {@link useIoLatencyBudget}
 * installs a guard that fails a suite whose *quiet-equivalent* cost climbs past
 * {@link MARGIN_FRACTION} of its base budget — before it starts flaking, with a
 * message that names the remedy. Reduce the work; do not raise the budget.
 */

/** Base per-test and per-hook budget on a quiet box, in milliseconds. */
export const IO_LATENCY_TEST_TIMEOUT_MS = 60_000;

/**
 * Median cost of one `node -e ""` spawn on a quiet box, in milliseconds.
 *
 * Measured on this repository at `ps aux | grep -c '[v]itest'` = 5, 1-minute
 * load average 8.01 on 18 cores: four samples of nine spawns gave medians of
 * 18.30 / 19.10 / 16.94 / 17.33ms. 18ms is the middle of that band, and it
 * agrees with the 19.8ms figure recorded independently on CodySwannGT/lisa#2490.
 * A machine whose quiet spawn cost differs simply reports a slowdown factor
 * centred somewhere other than 1, which is the correct behaviour: the ratio is
 * what the budget is expressed in.
 */
export const QUIET_SPAWN_LATENCY_MS = 18;

/**
 * Ceiling on the measured slowdown, so a pathological box cannot buy silence.
 *
 * The observed inflation at 12-way concurrency was ~4x. 8x leaves room for a
 * markedly worse box while keeping the worst-case budget bounded — a wider
 * budget, never an absent one. Past this the suite is expected to fail, because
 * a box that slow is not one anybody should be trusting a green from.
 */
export const MAX_SPAWN_SLOWDOWN = 8;

/**
 * Share of the base budget a passing case may consume, quiet-equivalent.
 *
 * 0.5 demands 2x headroom. The worst quiet-equivalent figure measured across
 * the four suites CodySwannGT/lisa#2822 names was 9.4s against a 30s ceiling,
 * so the guard has a ~3x cushion against its own instrument's error and still
 * fires long before the 60s cliff the suites were actually losing to.
 */
export const MARGIN_FRACTION = 0.5;

/** Number of reference spawns timed to characterise this worker's machine. */
const REFERENCE_SPAWN_SAMPLES = 5;

/** One measured window of a case, and the machine it was measured on. */
export interface MarginReading {
  /** Wall time the case consumed, hooks included, in milliseconds. */
  readonly elapsedMs: number;
  /** Quiet-box base budget the case is judged against, in milliseconds. */
  readonly baseMs: number;
  /** Measured spawn slowdown of the machine the case ran on. */
  readonly slowdown: number;
}

/**
 * Deadline for the reference spawn, in milliseconds. Not scaled, and cannot be.
 *
 * This is the one child in the tree whose bound must be a constant, because it
 * is the measurement every other bound is derived FROM: reaching for
 * {@link ioLatencyBudgetMs} here would read `WORKER_SPAWN_SLOWDOWN` while that
 * binding is still being initialised by this very call.
 *
 * The number is not a performance assertion. A `node -e ""` measured 45-50ms
 * on a box already 2.7x slower than the recorded quiet figure, so 30,000ms is
 * roughly 600x the contended cost — it can only ever fire on a child that has
 * stopped advancing. Unbounded is what it was, and an unbounded reference spawn
 * hangs the worker before a single case runs, which is the worst place in the
 * tree for it to happen: nothing has started, so nothing names it.
 */
const REFERENCE_SPAWN_DEADLINE_MS = 30_000;

/**
 * Time one `node -e ""` spawn, the cheapest honest unit of subprocess cost.
 * @returns Wall time of a single no-op child process, in milliseconds
 */
function timeOneSpawn(): number {
  const startedAt = performance.now();
  spawnSync(process.execPath, ["-e", ""], {
    killSignal: "SIGKILL",
    stdio: "ignore",
    timeout: REFERENCE_SPAWN_DEADLINE_MS,
  });
  return performance.now() - startedAt;
}

/**
 * Measure this worker's subprocess spawn latency.
 *
 * The median rather than the mean: a single descheduled sample would otherwise
 * inflate the whole characterisation, and the point of the figure is what a
 * spawn typically costs here, not what the worst one cost.
 * @param samples - Number of reference spawns to time
 * @returns Median spawn latency in milliseconds
 */
export function measureSpawnLatencyMs(
  samples: number = REFERENCE_SPAWN_SAMPLES
): number {
  const timings = Array.from({ length: samples }, () => timeOneSpawn()).sort(
    (left, right) => left - right
  );
  return timings[Math.floor(timings.length / 2)] ?? QUIET_SPAWN_LATENCY_MS;
}

/**
 * Convert a measured spawn latency into a bounded budget multiplier.
 *
 * Clamped at 1 from below so the budget can never come out TIGHTER than the
 * quiet-box base — this helper is only ever allowed to buy headroom, never to
 * remove it — and at {@link MAX_SPAWN_SLOWDOWN} from above so an unusable box
 * cannot widen the budget without limit.
 * @param latencyMs - Measured spawn latency on this machine
 * @returns Multiplier in the closed range [1, {@link MAX_SPAWN_SLOWDOWN}]
 */
export function slowdownFactorFrom(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) return 1;
  return Math.min(
    MAX_SPAWN_SLOWDOWN,
    Math.max(1, latencyMs / QUIET_SPAWN_LATENCY_MS)
  );
}

/**
 * This worker's spawn slowdown, measured once when the module is first loaded.
 *
 * Once per worker process rather than once per case: the measurement itself
 * costs five spawns, and vitest's `forks` pool gives each file its own process,
 * so file-scoped is both cheap and representative of the conditions that file
 * will actually run under.
 */
const WORKER_SPAWN_SLOWDOWN = slowdownFactorFrom(measureSpawnLatencyMs());

/**
 * Read the slowdown this worker measured at load time.
 * @returns Multiplier in the closed range [1, {@link MAX_SPAWN_SLOWDOWN}]
 */
export function workerSpawnSlowdown(): number {
  return WORKER_SPAWN_SLOWDOWN;
}

/**
 * Scale a quiet-box budget by this worker's measured slowdown.
 *
 * Use this for every `spawnSync` timeout in a test as well as for the case
 * budget. A hardcoded child timeout is the same defect at a smaller scale, and
 * it fails worse: `spawnSync` kills the child and returns empty output, so the
 * assertion that follows reports "expected '' to contain ..." and says nothing
 * about time at all. {@link assertChildCompleted} exists for that.
 * @param baseMs - Budget that holds on a quiet box, in milliseconds
 * @returns Budget scaled for the machine this worker is running on
 */
export function ioLatencyBudgetMs(baseMs: number): number {
  return Math.round(baseMs * WORKER_SPAWN_SLOWDOWN);
}

/**
 * Judge one measured case against its quiet-equivalent margin.
 *
 * Pure so the guard can be tested without a slow machine: divide the observed
 * time by the measured slowdown to get what the case would have cost on a quiet
 * box, and compare THAT to the margin ceiling. Dividing is the whole idea —
 * an observed number is `code x machine`, and only the first factor is the
 * suite's business.
 * @param reading - Observed time, base budget, and measured machine slowdown
 * @returns Failure message, or undefined when the case has margin to spare
 */
export function marginFailure(reading: MarginReading): string | undefined {
  const ceilingMs = reading.baseMs * MARGIN_FRACTION;
  const quietEquivalentMs = reading.elapsedMs / reading.slowdown;
  if (quietEquivalentMs <= ceilingMs) return undefined;
  return (
    `This case consumed ${(reading.elapsedMs / 1_000).toFixed(1)}s on a machine ` +
    `measured ${reading.slowdown.toFixed(2)}x slower than the recorded quiet box, ` +
    `i.e. ${(quietEquivalentMs / 1_000).toFixed(1)}s quiet-equivalent against a ` +
    `${(ceilingMs / 1_000).toFixed(1)}s ceiling ` +
    `(${MARGIN_FRACTION * 100}% of a ${(reading.baseMs / 1_000).toFixed(1)}s budget). ` +
    `A case this close to its budget is decided by machine noise rather than by ` +
    `the code under test. REDUCE THE WORK — hoist a subprocess out of the ` +
    `per-case path, share a built fixture across cases, or split the case — ` +
    `rather than raising the budget, which has already been tried twice ` +
    `(CodySwannGT/lisa#2522, CodySwannGT/lisa#2822).`
  );
}

/** Shape of a completed synchronous child process, as `spawnSync` reports it. */
export interface ChildOutcome {
  /** Error surfaced by the runtime, including the timeout kill. */
  readonly error?: Error | undefined;
  /** Signal that terminated the child, or null when it exited normally. */
  readonly signal?: NodeJS.Signals | null;
  /**
   * Exit code the child reported, or null when it never exited normally.
   *
   * Read only for the pipe-error branch, where it is the fact that settles the
   * diagnosis: a child that exited 0 did not hang, whatever the parent's write
   * did afterwards. It is also the verdict a declared early exit hands back —
   * see {@link PipeErrorTolerance} — so on that path it is not merely
   * diagnostic, it is the measurement.
   */
  readonly status?: number | null;
}

/**
 * What the caller claims about its child's relationship to its own stdin.
 *
 * A pair of named claims rather than a boolean, because the two values are not
 * "on" and "off": each is a different statement about the child, and a reader
 * of a callsite has to be able to tell which statement is being made without
 * opening this file.
 *
 * `"child-must-consume-input"` is the default and the safe one. An EPIPE under
 * it is a real signal — either the child has an exit path that skips its input,
 * or the child was never there at all — and it fails, naming the child.
 *
 * `"child-may-exit-before-reading"` is for the narrow case where the early exit
 * is the POINT: a deliberately-broken control, whose whole job is to exit
 * without doing the work, and which cannot be "fixed" to drain stdin without
 * destroying what it measures (CodySwannGT/lisa#3122). It tolerates the
 * parent's failed write and hands the child's exit status back, so the case can
 * assert the verdict it came for. It does NOT tolerate a child that never
 * existed, and it does NOT tolerate a kill.
 */
export type PipeErrorTolerance =
  | "child-may-exit-before-reading"
  | "child-must-consume-input";

/**
 * Errno the runtime reports when a write lands on a closed read end.
 *
 * Spelled out rather than inlined because the whole point of the branch below
 * is that this ONE code means something categorically different from every
 * other way a child can fail to complete.
 */
const PIPE_CLOSED_CODE = "EPIPE";

/**
 * Exit status a shell reports when the command it was asked to run is absent.
 *
 * Load-bearing on the EPIPE branch, because it separates two causes that look
 * identical from the parent: a child that read stdin and exited, and a child
 * that never existed. `bash /path/that/is/not/there` is the second, and it is
 * the one CodySwannGT/lisa#3020 was.
 */
const COMMAND_NOT_FOUND_STATUS = 127;

/**
 * Read the errno code off an error, when the runtime attached one.
 *
 * `spawnSync` types its `error` as a bare `Error`, but the runtime attaches
 * `code`/`errno`/`syscall` to it. Narrowed here rather than asserted at the
 * callsite so the one unchecked read lives in one place.
 * @param error - Error the runtime surfaced
 * @returns The errno code, or undefined when the error carries none
 */
function errnoCodeOf(error: Error): string | undefined {
  const { code } = error as NodeJS.ErrnoException;
  return code;
}

/**
 * Describe a write that failed because there was no reader on the other end.
 *
 * Two causes wear the same errno, and the exit status is the only thing that
 * tells them apart — so the message must read it rather than assert one cause
 * for both.
 *
 * **The child ran and exited first** (CodySwannGT/lisa#2949,
 * CodySwannGT/lisa#3122). It consumed no stdin on some exit path, and the
 * parent's write is racing that exit — so whether it surfaces is decided by the
 * box, and it is intermittent by construction. Measured: the shipped
 * `parity-safety-net.sh` run under `/bin/sh`, which on Linux is `dash`, dies on
 * `set -o pipefail` at line 84 — nine lines before its `input="$(cat)"` — so it
 * exits 2 having read nothing. One core, a 72-byte payload, 300 spawns per arm:
 * **0 EPIPE at rest, 3 under 4 CPU hogs, 31 under 16.** Same code, same
 * payload; only the load moved. The `/bin/sh` on macOS is `bash`, which accepts
 * `pipefail`, reaches the `cat` and drains — which is why 4MB of payload
 * produces no EPIPE there and the mechanism is invisible on a developer's box.
 *
 * **The child never existed** (CodySwannGT/lisa#3020). `bash <missing file>`
 * exits {@link COMMAND_NOT_FOUND_STATUS} immediately. Here the failure IS
 * load-sensitive — the parent's write and the shell's exit are racing, so a
 * quiet box completes the write and reports nothing while a busy box EPIPEs —
 * and the earlier text, written for the case above, asserted the opposite in
 * exactly the situation where it was false.
 * @param outcome - Result returned by `spawnSync`
 * @param label - Human-readable name of the command, for the diagnostic
 * @returns The full diagnostic for a pipe error
 */
function pipeClosedDiagnostic(outcome: ChildOutcome, label: string): string {
  const opening =
    `${label} did not complete: I/O error on the pipe — ${PIPE_CLOSED_CODE} ` +
    `while writing its input. `;
  if (outcome.status === COMMAND_NOT_FOUND_STATUS) {
    return (
      `${opening}It exited with status ${COMMAND_NOT_FOUND_STATUS}, which is a ` +
      `shell reporting that the command it was handed DOES NOT EXIST — so ` +
      `there was never a child to read stdin at all. Whether this surfaces is ` +
      `load-sensitive, because the parent's write is racing an immediate exit: ` +
      `the same absent script writes cleanly on a quiet box and fails here on ` +
      `a busy one. Do NOT re-run and do NOT widen the budget; both leave a ` +
      `case measuring an absent script rather than the code it names ` +
      `(CodySwannGT/lisa#3020). Fix the path being resolved so it points at a ` +
      `file that exists in a fresh checkout. ` +
      `See tests/helpers/io-latency-budget.ts.`
    );
  }
  return (
    `${opening}The child closed stdin before the write ` +
    `finished, which is what a process does when it exits before reading; it ` +
    `exited with status ${String(outcome.status ?? "unknown")}, so it reported ` +
    `nothing wrong on its own side. The parent's write is RACING that exit, so ` +
    `whether it surfaces is decided by the box: one core, a 72-byte payload, ` +
    `300 spawns per arm gave 0 EPIPE at rest, 3 under 4 CPU hogs and 31 under ` +
    `16 (CodySwannGT/lisa#3122). Expect it to be intermittent, and do NOT read ` +
    `a green re-run as proof it is gone. Two remedies, and which one applies ` +
    `is a fact about the child. If the child is SUPPOSED to consume its input, ` +
    `the exit path that skips it is the defect (CodySwannGT/lisa#2949). If the ` +
    `child is supposed to exit early — a deliberately-broken control is exactly ` +
    `that, and draining stdin would destroy what it measures — declare it with ` +
    `childMayExitBeforeReading: true on the boundedSpawnSync spec, and the exit ` +
    `status comes back for the case to assert on instead of this error. ` +
    `See tests/helpers/io-latency-budget.ts.`
  );
}

/**
 * Decide whether a pipe error is the early exit the caller said to expect.
 *
 * Deliberately narrow, because a tolerance this branch grants is a signal it
 * destroys. Only a child that exited under its own power qualifies: a numeric
 * status that is not {@link COMMAND_NOT_FOUND_STATUS} — an absent script is
 * never the control the caller meant (CodySwannGT/lisa#3020) — and no
 * terminating signal, so a timeout kill still reports itself as a kill.
 * @param outcome - Result returned by `spawnSync`
 * @returns True when the child exited on its own with a real status
 */
function isDeclaredEarlyExit(outcome: ChildOutcome): boolean {
  return (
    typeof outcome.status === "number" &&
    outcome.status !== COMMAND_NOT_FOUND_STATUS &&
    (outcome.signal ?? null) === null
  );
}

/**
 * Fail with the real cause when a child did not run to completion.
 *
 * Two causes, kept apart on purpose.
 *
 * **Killed or timed out.** Without this, a `spawnSync` timeout is silent: the
 * child is killed, `stdout` comes back empty, and the next assertion fails with
 * a message about content. Twelve of twelve concurrent runs of the `npm pack`
 * case failed exactly that way — `expected '' to contain 'learnings budget
 * passed'` — while the actual cause was a hardcoded 10s child budget on a box
 * where a spawn cost 4x its quiet figure.
 *
 * **An I/O error on the pipe.** The first version of this helper fired on ANY
 * `outcome.error` and then asserted the failure was "a real hang or a machine
 * past 8x". For EPIPE that is simply false — it is not a time event at all, and
 * one instance printed that sentence while reporting a measured 1.16x slowdown,
 * self-contradictory on its face. Inferring a mechanism from an effect is the
 * error this whole diagnostic exists to prevent, so it must not commit it
 * itself (CodySwannGT/lisa#2949).
 *
 * **An I/O error the caller declared.** A control that exists to induce an
 * early child exit has no verdict at all if that exit is reported as a hard
 * error — it stops measuring the thing it was written for, which is worse than
 * the flake (CodySwannGT/lisa#3122). So a caller may declare the early exit
 * with {@link PipeErrorTolerance}, and only then does the child's exit status
 * come back for the case to assert on. Undeclared, EPIPE still fails, and an
 * absent command or a kill still fails even when it IS declared.
 *
 * Call this immediately after every `spawnSync` whose timeout came from
 * {@link ioLatencyBudgetMs}.
 * @param outcome - Result returned by `spawnSync`
 * @param label - Human-readable name of the command, for the diagnostic
 * @param tolerance - What the caller claims about the child's use of its stdin.
 * Defaults to `"child-must-consume-input"`, so tolerating a pipe error is
 * always an explicit act at the callsite.
 */
export function assertChildCompleted(
  outcome: ChildOutcome,
  label: string,
  tolerance: PipeErrorTolerance = "child-must-consume-input"
): void {
  if (outcome.error === undefined && (outcome.signal ?? null) === null) return;
  if (
    outcome.error !== undefined &&
    errnoCodeOf(outcome.error) === PIPE_CLOSED_CODE
  ) {
    if (
      tolerance === "child-may-exit-before-reading" &&
      isDeclaredEarlyExit(outcome)
    )
      return;
    throw new Error(pipeClosedDiagnostic(outcome, label));
  }
  const cause =
    outcome.error === undefined
      ? `killed by signal ${String(outcome.signal)}`
      : outcome.error.message;
  throw new Error(
    `${label} did not complete: ${cause}. Its budget was scaled by a measured ` +
      `${WORKER_SPAWN_SLOWDOWN.toFixed(2)}x spawn slowdown, so this is a real ` +
      `hang or a machine past ${MAX_SPAWN_SLOWDOWN}x — not ordinary variance. ` +
      `See tests/helpers/io-latency-budget.ts.`
  );
}

/**
 * Quiet-box budget for a child a test fixture starts, in milliseconds.
 *
 * Derived, not chosen. Two constraints bracket it.
 *
 * From above: the scaled budget must stay UNDER the per-case budget, or the
 * case dies of a vitest timeout that names nothing while the child is still
 * running. {@link MAX_SPAWN_SLOWDOWN} is 8 and `vitest.config.local.ts` sets
 * `testTimeout` to 300,000ms, so any base at or under 37,500ms guarantees the
 * child dies first. 15,000ms puts the worst case at 120,000ms — 2.5x under the
 * case budget, the same ratio `LISA_WORK_ITEM_TIMEOUT_MS` already uses for
 * exactly this reason.
 *
 * From below: it must never bite ordinary variance. Measured on this
 * repository, 18 cores, `ps aux | grep -c '[v]itest'` = 19 and a 1-minute load
 * average of 50.2 — i.e. a contended box, not a quiet one — nine runs of
 * `check-bdd-coverage.mjs --json` against a fixture project cost 72-91ms while
 * `node -e ""` cost 45-50ms against the 18ms quiet figure recorded in
 * {@link QUIET_SPAWN_LATENCY_MS}. That is a 2.7x machine, so the quiet-
 * equivalent child costs about 27-34ms. 15,000ms is roughly 440x that, and
 * roughly 185x the contended figure.
 *
 * So the bound is nowhere near the work and comfortably inside the case
 * budget. It is a LIVENESS bound on a child that has stopped advancing —
 * CodySwannGT/lisa#2906 watched one sit for 15:04 — and not a performance
 * assertion about anything.
 */
export const BOUNDED_SPAWN_BASE_MS = 15_000;

/** One child process a test wants started with a bound it cannot forget. */
export interface BoundedSpawn {
  /** Human-readable name of the command, used in the kill diagnostic. */
  readonly label: string;
  /** Absolute path to the executable. */
  readonly command: string;
  /** Arguments, excluding the executable. */
  readonly args: readonly string[];
  /** Quiet-box budget. Defaults to {@link BOUNDED_SPAWN_BASE_MS}. */
  readonly baseMs?: number;
  /** Working directory for the child. */
  readonly cwd?: string;
  /** Complete environment for the child. Inherited when omitted. */
  readonly env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin, which is then closed. */
  readonly input?: string;
  /**
   * Declare that this child may exit before it reads {@link input}.
   *
   * Off by default, and turning it on is a claim about THIS child rather than a
   * way to quiet a noisy case. Set it only where the early exit is the property
   * under test — a control that runs a bash-shebang script under `/bin/sh` to
   * prove an all-refusing harness would be caught, say — because such a child
   * cannot be made to drain stdin without ceasing to be the control
   * (CodySwannGT/lisa#3122).
   *
   * When it fires, the parent's write failed, so the child received a truncated
   * payload or none of it. Read `status`; do not read the streams.
   */
  readonly childMayExitBeforeReading?: boolean;
  /**
   * Stream wiring for the child. Captured on both pipes when omitted.
   *
   * Carried through rather than fixed, because `stdio: "ignore"` is how a
   * fixture that starts thirty `git` children keeps thirty buffers out of the
   * worker, and `"inherit"` is how a case shows a tool's own progress.
   */
  readonly stdio?: SpawnSyncOptions["stdio"];
  /**
   * Largest stream the child may return, in bytes. Node's default is 1MB.
   *
   * Carried through for the same reason it was set at the original callsites:
   * a `git ls-files` over this repository exceeds the default, and exceeding
   * it surfaces as ENOBUFS with a TRUNCATED stream rather than as an error the
   * caller notices — a size problem wearing a content problem's clothes.
   */
  readonly maxBuffer?: number;
  /** Test seam: stands in for `spawnSync` so the budget can be observed. */
  readonly spawn?: typeof spawnSync;
}

/**
 * Start a child with a scaled budget and a kill that names itself.
 *
 * The two halves of the remedy CodySwannGT/lisa#2822 shipped were a scaled
 * `timeout:` and {@link assertChildCompleted}, and this module asked callers to
 * pair them by hand. CodySwannGT/lisa#2906 is what that costs: four fixture
 * spawns shipped with NO `timeout:` at all, and `spawnSync` blocks the worker's
 * event loop for the whole life of the child, so vitest's per-case budget — a
 * timer on that loop — could not fire for the very case it was written for. A
 * budget that cannot fire is not a smaller budget; it is no budget. The case
 * simply took as long as the child took, and one child took 15:04.
 *
 * So the pair is now one call. There is no way to spend this function's budget
 * without also getting the diagnostic, which is the only version of the rule a
 * reviewer cannot miss.
 *
 * `SIGKILL` rather than the default `SIGTERM` deliberately: the hang this
 * exists for was a process at 0% CPU in state `U`, and a fixture child has no
 * cleanup worth waiting on.
 * @param spec - The child to start, and the budget to hold it to
 * @returns The completed child, streams decoded as UTF-8
 */
export function boundedSpawnSync(spec: BoundedSpawn): SpawnSyncReturns<string> {
  const spawn = spec.spawn ?? spawnSync;
  const outcome = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    encoding: "utf-8",
    env: spec.env,
    input: spec.input,
    killSignal: "SIGKILL",
    maxBuffer: spec.maxBuffer,
    stdio: spec.stdio,
    timeout: ioLatencyBudgetMs(spec.baseMs ?? BOUNDED_SPAWN_BASE_MS),
  });
  assertChildCompleted(
    outcome,
    spec.label,
    spec.childMayExitBeforeReading === true
      ? "child-may-exit-before-reading"
      : "child-must-consume-input"
  );
  return outcome;
}

/**
 * A non-zero exit, reported the way `execFileSync` reports one.
 *
 * `execFileSync` throws on a non-zero exit and hangs `status`, `stdout` and
 * `stderr` off the error, and callsites in this tree read all three. A
 * replacement that threw a bare `Error` would compile, and every
 * "assert this command fails" case that reads those fields would quietly stop
 * asserting anything.
 */
export class ChildFailure extends Error {
  /**
   * Exit code the child reported, or null when it was signalled.
   *
   * Node spells this `status` on the error `execFileSync` throws. It is spelled
   * `exitCode` here because `status` on a thrown Error means an HTTP response
   * code to a structural rule this repository enforces, and an exit code is not
   * one. Converted callsites that read `error.status` read `error.exitCode`.
   */
  readonly exitCode: number | null;

  /** Everything the child wrote to stdout before exiting. */
  readonly stdout: string;

  /** Everything the child wrote to stderr before exiting. */
  readonly stderr: string;

  /**
   * Describe a child that ran to completion and reported failure.
   * @param spec - The child that was started
   * @param outcome - What it returned
   */
  constructor(spec: BoundedSpawn, outcome: SpawnSyncReturns<string>) {
    super(
      `Command failed: ${spec.command} ${spec.args.join(" ")}\n` +
        `${outcome.stderr ?? ""}`
    );
    this.name = "ChildFailure";
    this.exitCode = outcome.status;
    this.stdout = outcome.stdout ?? "";
    this.stderr = outcome.stderr ?? "";
  }
}

/**
 * Start a child with a bound, and throw its output on a non-zero exit.
 *
 * The bounded stand-in for `execFileSync`. Built on {@link boundedSpawnSync}
 * rather than on `execFileSync` deliberately: `execFileSync` reports a timeout
 * kill as an ordinary command failure, so the one fact worth knowing — that
 * the child never finished — arrives indistinguishable from the child having
 * failed. Running the completion assertion FIRST keeps the two apart.
 *
 * A child wired with `stdio: "ignore"` has no stdout to return, so this
 * returns the empty string for it rather than null. Nothing reads the return
 * of a call that asked for the streams to be discarded.
 * @param spec - The child to start, and the budget to hold it to
 * @returns Everything the child wrote to stdout
 * @throws {ChildFailure} When the child exits non-zero
 */
export function boundedExecFileSync(spec: BoundedSpawn): string {
  const outcome = boundedSpawnSync(spec);
  if (outcome.status === 0) return outcome.stdout ?? "";
  throw new ChildFailure(spec, outcome);
}

/**
 * Widen the budget for the current file and assert its margin, per case.
 *
 * Deliberately opt-in per file rather than a global `testTimeout` bump. A
 * genuine deadlock in an ordinary suite should still surface in ten seconds,
 * and it will, because every suite that does not call this keeps the default.
 *
 * The honest cost of calling it: a real hang in one of these suites now takes
 * `base x slowdown` to report instead of 10s. That is the price of trusting the
 * rest of the suite under load, and it is bounded.
 *
 * The suites wired to this helper are where the failures were observed — they
 * are NOT a closed set, and the roster grew again while CodySwannGT/lisa#2822
 * was being measured: `lisa-owned-hash-ledger` timed out inside a full
 * `test:unit` run and passed in isolation moments later under the same load.
 * Expect the mechanism to reach further than the roster, and add suites on
 * evidence rather than trusting the roster's edges.
 *
 * Call once at module scope, above the `describe` blocks.
 * @param baseMs - Budget that holds on a quiet box. Defaults to
 * {@link IO_LATENCY_TEST_TIMEOUT_MS}. Any override needs a measured wall time
 * and the `ps aux | grep -c '[v]itest'` count it was taken at, in the calling
 * comment — a number measured while other work was running is a property of
 * that machine, not of the test.
 */
export function useIoLatencyBudget(
  baseMs: number = IO_LATENCY_TEST_TIMEOUT_MS
): void {
  const budgetMs = ioLatencyBudgetMs(baseMs);
  // A file-scoped pair, so the window spans the describe-level `beforeEach` and
  // `afterEach` too: for `plugin-sync-scripts` the entire cost WAS the hook, and
  // a guard that only timed the case body would have watched the cheap half.
  // Keyed by task rather than held in a shared slot, so a nested case can never
  // read a sibling's start time.
  const startedAt = new WeakMap<object, number>();
  vi.setConfig({ testTimeout: budgetMs, hookTimeout: budgetMs });
  beforeEach(context => {
    if (context.task !== undefined)
      startedAt.set(context.task, performance.now());
  });
  afterEach(context => {
    // Never mask a real failure with a timing complaint; a failing case has
    // already told the author something more useful than its duration.
    if (context.task?.result?.state !== "pass") return;
    const at = startedAt.get(context.task);
    if (at === undefined) return;
    const failure = marginFailure({
      elapsedMs: performance.now() - at,
      baseMs,
      slowdown: WORKER_SPAWN_SLOWDOWN,
    });
    if (failure !== undefined) throw new Error(failure);
  });
}

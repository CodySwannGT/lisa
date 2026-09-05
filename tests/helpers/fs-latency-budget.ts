/**
 * The filesystem proxy that deletion-dominated budgets scale on.
 *
 * A sibling of `io-latency-budget.ts` rather than a section inside it, because
 * the two answer different questions with different measurements and only the
 * handful of deletion-dominated suites need this one. Everything that module's
 * opening says about citing the machine state a figure was measured under
 * applies here unchanged and is not restated.
 * @module tests/helpers/fs-latency-budget
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * ## The second proxy, and why one was not enough
 *
 * CodySwannGT/lisa#3936. Spawn latency was doing double duty: it characterised
 * subprocess cost, which it measures directly, and it stood in for general I/O
 * contention on hooks whose entire cost is `fs.rmSync` over a large corpus.
 * For the second job it is a proxy, not a measurement, and the proxy
 * UNDER-SCALES. Three consecutive derivations against the 100k-entry teardown
 * came out 176,498 / 190,878 / 211,660ms — a 1.47-1.76x widening of a 120,000ms
 * base — and the hook exceeded all three, once at a 1-minute load average of
 * 19.5, which is not a box anyone would call busy.
 *
 * The mismatch is structural rather than a bad constant. A `spawnSync` of
 * `node -e ""` and a recursive unlink of 100,000 directory entries share no
 * bottleneck: one is dominated by process creation and image loading, the
 * other by metadata operations against the filesystem. Their costs are free to
 * move in opposite directions, and the budget derived from the first can be
 * simultaneously too generous on a quiet box and too tight on a contended one.
 *
 * Measured on this repository, 2026-09-05, `ps aux | grep -c '[v]itest'` = 1,
 * 18-core arm64, APFS. Eight paired samples taken 25s apart across 1-minute
 * load averages of 8.64 to 28.75, each one timing a `node -e ""` spawn, a
 * 20-entry probe cycle, and a real 5,000-entry `rmSync`, in that order:
 *
 * | measurement                        | observed range   | spread |
 * | ---------------------------------- | ---------------- | ------ |
 * | real 5,000-entry deletion, /entry  | 28.0 - 74.0us    | 2.64x  |
 * | 20-entry probe, /entry             | 26.8 - 64.3us    | 2.40x  |
 * | spawn median                       | 14.7 - 25.8ms    | —      |
 * | spawn-derived slowdown factor      | 1.00 - 1.43x     | 1.43x  |
 *
 * **The guarded work swung 2.64x while the spawn-derived factor moved 1.43x**,
 * and the factor read exactly 1.00 — a quiet box, no widening at all — in
 * five of the eight samples, one of which had the real deletion running 71%
 * above its cheapest reading. The probe, meanwhile, stayed within a 0.56-1.15
 * ratio of the real deletion it stands for, at 250x the scale, in every
 * sample.
 *
 * That is the defect and its repair in one table: the spawn proxy is capable of
 * reporting no contention at all while the guarded deletion work is the thing
 * under contention, and a measurement of the operation itself is not.
 *
 * A ninth paired sample, taken at a 1-minute load average of 16.36 with the
 * filesystem genuinely slow, puts the two derivations side by side against the
 * 120,000ms base this repository's largest teardown uses:
 *
 * | derivation                     | at that instant |
 * | ------------------------------ | --------------- |
 * | spawn median 22.81ms           | 152,073ms       |
 * | probe 57.7us per entry         | 230,800ms       |
 * | real deletion, 103.9us / entry | 3.46x the quiet reference |
 *
 * **The filesystem was running 3.46x slow and the spawn proxy widened by
 * 1.27x.** That sample is also the widest disagreement observed between the
 * probe and the operation it stands for (a 0.56 ratio rather than the 0.78-1.15
 * of the eight-sample window): the 20-entry probe under-reports somewhat on a
 * heavily contended box, because its fixed `mkdtemp`/`rmdir` ends amortise
 * differently from a 5,000-entry corpus. It under-reports by a factor of two
 * where the spawn proxy under-reports by a factor of three, in the direction
 * that matters, which is the honest claim and the whole of it.
 *
 * So deletion-dominated budgets get their own proxy, measured from the
 * operation they guard.
 *
 * ## Why this may derive a TIGHTER budget than the spawn proxy did
 *
 * It may, and that is the repair rather than a regression. A budget that was
 * wide because an unrelated measurement happened to be large was not protecting
 * the deletion; it was buying silence. The invariant this helper keeps is that
 * a budget is never tighter than its quiet-box BASE ({@link fsSlowdownFactorFrom}
 * clamps at 1 from below, exactly as the spawn path does) — not that it is
 * never tighter than some other proxy's reading.
 */

/**
 * Directory entries created per filesystem probe cycle.
 *
 * Twenty rather than one: a single unlink is dominated by the surrounding
 * `mkdtemp`/`rmdir` pair, so the per-entry figure it yields is not the per-entry
 * figure a 100,000-entry teardown pays. Twenty amortises the fixed ends while
 * keeping the probe at roughly 1/250 the cost of the smallest real corpus.
 */
const FS_PROBE_ENTRIES = 20;

/** Number of probe cycles timed to characterise this worker's filesystem. */
const FS_PROBE_SAMPLES = 5;

/**
 * Cost of unlinking one directory entry on a quiet box, in microseconds.
 *
 * Measured on this repository, 2026-09-05, `ps aux | grep -c '[v]itest'` = 1,
 * 18-core arm64, APFS, over the eight paired samples tabulated above. Sorted,
 * the probe reported 26.8 / 29.3 / 30.0 / 31.7 / 36.2 / 42.5 / 55.1 / 64.3us
 * per entry, and the real 5,000-entry `rmSync` taken in the same instants
 * reported 28.0 / 29.7 / 34.7 / 36.4 / 38.3 / 48.0 / 54.5 / 74.0us per entry.
 * **In every sample the probe stayed within a 0.56-1.15 ratio of the real
 * deletion it stands for**, which is the property the spawn proxy does not
 * have and the reason this figure is worth recording at all.
 *
 * 30 is the middle of the four cheapest readings, which is the closest this
 * box got to quiet. It was NOT idle for any of them — the lowest 1-minute load
 * average in the window was 8.64, on 18 cores — and saying so is the point: a
 * figure without its conditions is the failure this module opens by
 * describing. A machine whose true quiet cost is lower simply reports a
 * slowdown centred above 1, which is the correct behaviour, because the ratio
 * is what the budget is expressed in.
 *
 */
export const QUIET_UNLINK_LATENCY_US = 30;

/**
 * Ceiling on the measured filesystem slowdown.
 *
 * Deliberately the same 8 as `MAX_SPAWN_SLOWDOWN`, and for the same
 * reason: past it, the box is not one anybody should trust a green from, and an
 * unbounded multiplier lets a pathological machine buy silence. Matching the
 * two numbers is a choice, not a coincidence — a deletion budget that could
 * widen further than a spawn budget would make "reduce the work" avoidable
 * exactly where the corpus is largest.
 */
export const MAX_FS_SLOWDOWN = 8;

/**
 * Build the probe's throwaway directory.
 *
 * Separated from the timing so that only the unlink half is measured. Timing
 * the creation too would measure a cost the teardown hooks do not pay.
 * @returns Path to a directory holding {@link FS_PROBE_ENTRIES} small files
 */
function fillProbeDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-fs-probe-"));
  Array.from({ length: FS_PROBE_ENTRIES }, (_unused, index) => {
    writeFileSync(path.join(directory, `entry-${index}`), "x");
    return index;
  });
  return directory;
}

/**
 * Time one create-then-recursively-delete cycle.
 * @returns Per-entry unlink cost of one cycle, in microseconds
 */
function timeOneUnlinkCycle(): number {
  const directory = fillProbeDirectory();
  const startedAt = performance.now();
  rmSync(directory, { force: true, recursive: true });
  return ((performance.now() - startedAt) / FS_PROBE_ENTRIES) * 1000;
}

/**
 * Measure this worker's per-entry unlink cost.
 *
 * The median rather than the mean, for the reason
 * `measureSpawnLatencyMs` gives: one descheduled sample should not
 * characterise the machine.
 * @param samples - Number of probe cycles to time
 * @returns Median per-entry unlink cost in microseconds
 */
export function measureUnlinkLatencyUs(
  samples: number = FS_PROBE_SAMPLES
): number {
  const timings = Array.from({ length: samples }, () =>
    timeOneUnlinkCycle()
  ).sort((left, right) => left - right);
  return timings[Math.floor(timings.length / 2)] ?? QUIET_UNLINK_LATENCY_US;
}

/**
 * Convert a measured per-entry unlink cost into a bounded budget multiplier.
 *
 * Clamped at 1 from below and {@link MAX_FS_SLOWDOWN} from above, matching
 * `slowdownFactorFrom` — the budget can never come out tighter than its
 * quiet-box base, and a pathological box cannot widen it without limit.
 * @param perEntryUs - Measured per-entry unlink cost on this machine
 * @returns Multiplier in the closed range [1, {@link MAX_FS_SLOWDOWN}]
 */
export function fsSlowdownFactorFrom(perEntryUs: number): number {
  if (!Number.isFinite(perEntryUs) || perEntryUs <= 0) return 1;
  return Math.min(
    MAX_FS_SLOWDOWN,
    Math.max(1, perEntryUs / QUIET_UNLINK_LATENCY_US)
  );
}

/**
 * This worker's filesystem slowdown, measured once and then remembered.
 *
 * Lazy where the spawn probe is eager, and the asymmetry is deliberate: 47
 * files import the sibling module and only the deletion-dominated handful need
 * this figure, so charging every one of them a probe at load time would be
 * paying for a measurement nobody reads.
 *
 * A one-field holder rather than a bare `let`, which is this repository's
 * sanctioned shape for a memoised value.
 */
const fsSlowdown: { current: number | undefined } = { current: undefined };

/**
 * Read the filesystem slowdown for this worker, measuring it on first use.
 * @returns Multiplier in the closed range [1, {@link MAX_FS_SLOWDOWN}]
 */
export function workerFsSlowdown(): number {
  fsSlowdown.current ??= fsSlowdownFactorFrom(measureUnlinkLatencyUs());
  return fsSlowdown.current;
}

/**
 * Scale a quiet-box budget by this worker's measured FILESYSTEM slowdown.
 *
 * Use this — not `ioLatencyBudgetMs` — for a hook or case whose cost is
 * filesystem deletion rather than process spawning. A teardown that unlinks a
 * corpus spawns nothing at all, so a spawn-derived budget is measuring
 * something the hook never does.
 *
 * The test is what dominates the guarded window, not what the file does
 * elsewhere: a suite whose cases spawn a packed binary and whose `afterAll`
 * deletes a scratch tree wants the spawn budget on the cases and this one on
 * the teardown.
 * @param baseMs - Budget that holds on a quiet box, in milliseconds
 * @returns Budget scaled for this machine's measured deletion cost
 */
export function fsLatencyBudgetMs(baseMs: number): number {
  return Math.round(baseMs * workerFsSlowdown());
}

/**
 * The current filesystem derivation, in one operator-readable line.
 *
 * Exists so a failing deletion budget can say what it was derived FROM. A
 * budget reported without its measurement is the unfalsifiable-figure problem
 * this module opens by describing, one layer down.
 * @returns A line naming the measured cost, the quiet reference, and the factor
 */
export function fsBudgetDerivation(): string {
  const perEntryUs = measureUnlinkLatencyUs();
  const factor = fsSlowdownFactorFrom(perEntryUs);
  return (
    `filesystem slowdown ${factor.toFixed(2)}x: measured ` +
    `${perEntryUs.toFixed(1)}us per unlinked entry against a quiet-box ` +
    `${QUIET_UNLINK_LATENCY_US}us, ceiling ${MAX_FS_SLOWDOWN}x`
  );
}

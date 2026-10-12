/**
 * Capacity for the session manager: how many workers this machine can hold,
 * and whether one more may start right now.
 *
 * Each worker is a full Claude Code session running a build, so the real
 * limits are free memory and CPU, not a number someone guessed once. The
 * manager re-reads both every cycle and spawns only while all three agree:
 * memory over a reserve, a fraction of the cores, and a hard `maxWorkers`.
 *
 * Memory is read the way each platform reports *reclaimable* memory, because
 * plain "free" badly under-reports on both:
 * - macOS: `vm_stat` free + inactive + speculative pages, at the page size
 *   printed in its header (16 KiB on Apple silicon, 4 KiB on Intel).
 * - Linux: `MemAvailable` from `/proc/meminfo`, the kernel's own estimate.
 * - Anywhere else, or when those cannot be parsed: `os.freemem()`, labelled
 *   `mem_source: "os.freemem"` so nobody mistakes it for a precise reading.
 *
 * Every export is pure or takes injected seams. This module never reads the
 * environment and never runs a process itself: `session-manager.mjs` passes
 * a real `exec` in, and tests pass fixtures.
 * @module capacity
 */
import os from "node:os";

const GIB = 1024 ** 3;
const PROC_MEMINFO = "/proc/meminfo";
const VM_STAT_PAGE_ROWS = ["Pages free", "Pages inactive", "Pages speculative"];

/**
 * @typedef {{ availGb: number, cores: number, load1: number,
 *   memSource: "vm_stat" | "/proc/meminfo" | "os.freemem" }} MachineStats
 * @typedef {{ maxWorkers: number, gbPerWorker: number, reserveGb: number,
 *   cpuFraction: number, maxLoadPerCore: number }} CapacityConfig
 * @typedef {{ paused?: boolean, maxWorkers?: number | null }} CapacityControl
 */

/**
 * Reclaimable bytes from `vm_stat` output.
 * @param {string} text - Raw `vm_stat` stdout
 * @returns {number | null} Bytes, or null when the header or a row is missing
 */
export function parseVmStat(text) {
  const pageSize = /page size of (\d+) bytes/.exec(text);
  if (!pageSize) return null;
  let pages = 0;
  for (const label of VM_STAT_PAGE_ROWS) {
    const row = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, "m").exec(text);
    if (!row) return null;
    pages += Number(row[1]);
  }
  return pages * Number(pageSize[1]);
}

/**
 * `MemAvailable` from `/proc/meminfo`, in bytes.
 * @param {string} text - Raw meminfo contents
 * @returns {number | null} Bytes, or null without a MemAvailable row
 */
export function parseMeminfo(text) {
  const row = /^MemAvailable:\s+(\d+)\s*kB\s*$/m.exec(text);
  return row ? Number(row[1]) * 1024 : null;
}

/**
 * Read reclaimable bytes for `platform`, or null to fall back to freemem.
 * @param {object} seams - Injected platform, exec, readFile, meminfoPath
 * @returns {Promise<{ bytes: number, source: MachineStats["memSource"] } | null>} Reading
 */
async function readPlatformMemory({ platform, exec, readFile, meminfoPath }) {
  if (platform === "darwin") {
    if (typeof exec !== "function") {
      throw new TypeError("readMachineStats needs an injected exec on darwin");
    }
    const bytes = parseVmStat(String(await exec("vm_stat")));
    return bytes === null ? null : { bytes, source: "vm_stat" };
  }
  if (platform === "linux") {
    if (typeof readFile !== "function") {
      throw new TypeError(
        "readMachineStats needs an injected readFile on linux"
      );
    }
    const bytes = parseMeminfo(
      String(await readFile(meminfoPath ?? PROC_MEMINFO))
    );
    return bytes === null ? null : { bytes, source: PROC_MEMINFO };
  }
  return null;
}

/**
 * Read memory, cores and 1-minute load for this machine.
 *
 * `meminfoPath` exists for the CLI's hidden `--meminfo` test flag, so a CLI
 * test on any OS can exercise the Linux path from a fixture file.
 * @param {object} [seams] - Injected platform, exec, readFile, cpus, loadavg,
 *   freemem and optional meminfoPath; os.* defaults for the pure readers only
 * @returns {Promise<MachineStats>} Stats with availGb in GiB
 */
export async function readMachineStats(seams = {}) {
  const {
    platform = os.platform(),
    cpus = os.cpus,
    loadavg = os.loadavg,
    freemem = os.freemem,
  } = seams;
  const reading = await readPlatformMemory({ ...seams, platform });
  const memory = reading ?? { bytes: freemem(), source: "os.freemem" };
  return {
    availGb: memory.bytes / GIB,
    cores: cpus().length,
    load1: loadavg()[0],
    memSource: memory.source,
  };
}

/**
 * The effective worker ceiling. Precedence: the ledger's `control.maxWorkers`
 * (the operator's `cap N` from Telegram, newest intent), then the CLI's
 * `--max-workers`, then config. `null`/`undefined` means "not set"; 0 is a
 * real value that stops all spawning.
 * @param {{ control?: CapacityControl | null, flagMaxWorkers?: number | null,
 *   config: Pick<CapacityConfig, "maxWorkers"> }} input - Override sources
 * @returns {number} maxWorkers to apply
 */
export function resolveMaxWorkers({ control, flagMaxWorkers, config }) {
  const ledgerValue = control?.maxWorkers;
  if (ledgerValue !== null && ledgerValue !== undefined) return ledgerValue;
  if (flagMaxWorkers !== null && flagMaxWorkers !== undefined) {
    return flagMaxWorkers;
  }
  return config.maxWorkers;
}

/**
 * Round for display. The cap itself is computed from unrounded values.
 * @param {number} value - Number to round
 * @returns {number} Rounded to two decimals
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Decide the cap and whether one more worker may start.
 *
 * `running` is added back into the memory cap because the memory it already
 * uses is not in `availGb`: without it, every running worker would shrink the
 * cap twice and the fleet would ratchet down to zero.
 * @param {{ stats: MachineStats, running: number, config: CapacityConfig,
 *   control?: CapacityControl | null, flagMaxWorkers?: number | null }} input
 *   - Machine stats, running worker count, capacity config and overrides
 * @returns {{ running: number, cap: number, free_slots: number,
 *   avail_gb: number, load1: number, cores: number, overloaded: boolean,
 *   can_spawn: boolean, mem_source: string, paused: boolean }} Capacity report
 */
export function computeCapacity({
  stats,
  running,
  config,
  control,
  flagMaxWorkers,
}) {
  const maxWorkers = resolveMaxWorkers({ control, flagMaxWorkers, config });
  const memCap = Math.max(
    0,
    Math.floor((stats.availGb - config.reserveGb) / config.gbPerWorker) +
      running
  );
  const cpuCap = Math.floor(stats.cores * config.cpuFraction);
  const cap = Math.max(0, Math.min(maxWorkers, memCap, cpuCap));
  const overloaded = stats.load1 > stats.cores * config.maxLoadPerCore;
  const paused = control?.paused === true;
  return {
    running,
    cap,
    free_slots: Math.max(0, cap - running),
    avail_gb: round2(stats.availGb),
    load1: round2(stats.load1),
    cores: stats.cores,
    overloaded,
    can_spawn: !paused && !overloaded && running < cap,
    mem_source: stats.memSource,
    paused,
  };
}

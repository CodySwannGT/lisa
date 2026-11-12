/**
 * Measurement pieces for the hosted fs-probe diagnostic (CodySwannGT/lisa#4636).
 *
 * `fs-latency-budget.ts` widens deletion budgets by a factor its 20-entry probe
 * derives. On every sampled hosted run that factor read exactly 1.00 while
 * real removal there cost 39-129us per freed inode, because the probe then
 * timed one-byte files that were freed before they were given a block, so they
 * sent the `discard`-mounted device nothing to discard. This module holds what
 * it takes to measure that: the mount and the block device behind the probe's
 * directory, the device's discard counters around each removal, and three
 * sample kinds taken in the same instant — the probe, an allocated variant
 * (4 KiB, `fsync`ed files) and a real 5,000-file allocated corpus.
 *
 * Hosted run 43251544381 answered it (the allocated variant read 0.94-1.12 of
 * the real removal, the one-byte probe 0.25-0.28), and the probe now writes
 * allocated files itself ({@link fillProbeDirectory}). So the probe and variant
 * kinds now time the same allocated files, taken twice back to back; the
 * one-byte probe survives only in the table recorded in `fs-latency-budget.ts`
 * from that run.
 *
 * The mount-table and device-counter readers follow the design of the
 * diagnostics PR #4626 used and later removed. They return nothing off Linux,
 * so every sample still carries its timings there.
 * @module tests/helpers/fs-probe-diagnostic
 */
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";

import {
  fillProbeDirectory,
  FS_PROBE_ENTRIES,
  measureUnlinkLatencyUs,
} from "./fs-latency-budget.js";

/** Linux block-device counters, in the kernel's `stat` field order. */
export const DEVICE_FIELDS = [
  "readIos",
  "readMerges",
  "readSectors",
  "readMs",
  "writeIos",
  "writeMerges",
  "writeSectors",
  "writeMs",
  "inFlight",
  "ioMs",
  "queueMs",
  "discardIos",
  "discardMerges",
  "discardSectors",
  "discardMs",
  "flushIos",
  "flushMs",
] as const;

/** Named block-device counters; a field the kernel did not report is absent. */
export type DeviceCounters = Readonly<Record<string, number>>;

/** The mount holding a path, read from the kernel's own table. */
export interface MountRecord {
  readonly device: string;
  readonly mountPoint: string;
  readonly fsType: string;
  /** Per-mount options, then the superblock's, separated by `;`. */
  readonly options: string;
}

/** Cycles the probe takes its median over, and the variant with it. */
const PROBE_CYCLES = 5;

/** Files in the real corpus each pair is read against. */
const CORPUS_ENTRIES = 5000;

/**
 * Parse one mountinfo line into a record.
 * @param line - A line holding the ` - ` separator
 * @returns The mount record
 */
function mountRecord(line: string): MountRecord {
  const [left = "", right = ""] = line.split(" - ");
  const fields = left.split(" ");
  const [fsType = "", , superOptions = ""] = right.split(" ");
  return {
    device: fields[2] ?? "",
    mountPoint: fields[4] ?? "",
    fsType,
    options: `${fields[5] ?? ""};${superOptions}`,
  };
}

/**
 * Whether a mount point holds a path.
 * @param mountPoint - The mount's mount point
 * @param target - A resolved absolute path
 * @returns True when the path is the mount point or lies beneath it
 */
function holds(mountPoint: string, target: string): boolean {
  if (target === mountPoint) return true;
  const prefix = mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`;
  return target.startsWith(prefix);
}

/**
 * Find the mount holding a path in a mountinfo table, by the longest mount
 * point that holds it.
 * @param table - Contents of `/proc/self/mountinfo`
 * @param target - A resolved absolute path
 * @returns The mount record, or undefined when no mount holds it
 */
export function parseMountInfo(
  table: string,
  target: string
): MountRecord | undefined {
  return table
    .split("\n")
    .filter(line => line.includes(" - "))
    .map(mountRecord)
    .filter(mount => holds(mount.mountPoint, target))
    .reduce<MountRecord | undefined>(
      (best, mount) =>
        best === undefined || mount.mountPoint.length > best.mountPoint.length
          ? mount
          : best,
      undefined
    );
}

/**
 * Find the mount holding an existing path on this machine.
 * @param target - Existing path on the filesystem of interest
 * @param table - Mount table to read; the kernel's own by default
 * @returns The mount record, or undefined off Linux
 */
export function mountOf(
  target: string,
  table = "/proc/self/mountinfo"
): MountRecord | undefined {
  if (!existsSync(table)) return undefined;
  return parseMountInfo(readFileSync(table, "utf8"), realpathSync(target));
}

/**
 * Name the counters in one block-device `stat` line.
 * @param text - Contents of `/sys/dev/block/<maj:min>/stat`
 * @returns The counters the kernel reported, by name
 */
export function parseDeviceStat(text: string): DeviceCounters {
  const values = text.trim().split(/\s+/).map(Number);
  return Object.fromEntries(
    DEVICE_FIELDS.slice(0, values.length).map((name, index) => [
      name,
      values[index] ?? 0,
    ])
  );
}

/**
 * Read the counters of the block device behind a mount, when there is one.
 * @param mount - Mount holding the directory being measured
 * @returns The counters, or undefined when none are readable
 */
export function readDeviceCounters(
  mount: MountRecord | undefined
): DeviceCounters | undefined {
  const file = mount && `/sys/dev/block/${mount.device}/stat`;
  if (!file || !existsSync(file)) return undefined;
  return parseDeviceStat(readFileSync(file, "utf8"));
}

/**
 * What the device's discard counters moved by between two readings.
 * @param before - Reading before the removal
 * @param after - Reading after it
 * @returns The discard deltas, or null when they cannot be read
 */
export function discardDelta(
  before: DeviceCounters | undefined,
  after: DeviceCounters | undefined
): DeviceCounters | null {
  if (before === undefined || after === undefined) return null;
  const names = DEVICE_FIELDS.filter(
    name => name.startsWith("discard") && name in before && name in after
  );
  if (names.length === 0) return null;
  return Object.fromEntries(
    names.map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)])
  );
}

/**
 * Remove a directory recursively, timing only the removal.
 * @param directory - Directory to remove
 * @param entries - Files it holds, for the per-entry figure
 * @returns Per-entry removal cost, in microseconds
 */
export function timeRemovalUs(directory: string, entries: number): number {
  const startedAt = performance.now();
  rmSync(directory, { force: true, recursive: true });
  return ((performance.now() - startedAt) / entries) * 1000;
}

/** Discard deltas read straight after a removal and once more after a wait. */
export interface RemovalDiscards {
  readonly immediate: DeviceCounters | null;
  readonly settled: DeviceCounters | null;
}

/** One timed removal and the discards seen around it. */
interface ObservedRemoval {
  readonly perEntryUs: number;
  readonly discards: RemovalDiscards;
}

/**
 * Wait, so discards a journal commit issues after a removal are counted.
 * @param ms - How long to wait
 */
async function settle(ms: number): Promise<void> {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Time a removal and read the device's discard counters around it.
 *
 * Read twice afterwards: straight away, which is what the unlinking thread
 * could have waited on, and after a settle, which also catches discards a
 * journal commit issues later. The two answer whether discards are paid
 * inside the timed window at all.
 * @param mount - Mount holding the removed directories
 * @param settleMs - Wait before the second reading
 * @param timed - The removal; returns its per-entry cost
 * @returns The per-entry cost and the discard deltas
 */
async function observeRemoval(
  mount: MountRecord | undefined,
  settleMs: number,
  timed: () => number
): Promise<ObservedRemoval> {
  const before = readDeviceCounters(mount);
  const perEntryUs = timed();
  const immediate = readDeviceCounters(mount);
  await settle(settleMs);
  return {
    perEntryUs,
    discards: {
      immediate: discardDelta(before, immediate),
      settled: discardDelta(before, readDeviceCounters(mount)),
    },
  };
}

/** One paired sample: the three kinds, taken in that order, back to back. */
export interface PairedSample {
  readonly probeUs: number;
  readonly variantUs: number;
  readonly realUs: number;
  readonly variantToReal: number;
  readonly probeToReal: number;
  readonly entries: Readonly<Record<"probe" | "variant" | "real", number>>;
  readonly discards: Readonly<
    Record<"probe" | "variant" | "real", RemovalDiscards>
  >;
}

/** How one paired sample is taken. */
export interface PairedSampleOptions {
  readonly mount: MountRecord | undefined;
  readonly settleMs: number;
  /** Files in the real corpus; 5,000 unless a test shrinks it. */
  readonly corpusEntries?: number;
}

/**
 * Round a ratio for an operator-readable record.
 * @param value - The ratio
 * @returns It, to three decimal places
 */
const ratio = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Take one paired sample: the current probe, the allocated variant and a real
 * allocated corpus, each with its discard deltas.
 *
 * The probe and the variant now take the same measurement, back to back. Both
 * create their files inside the counted window, as the probe always has; creating files frees nothing, so it discards nothing.
 * The corpus is written before its window opens.
 * @param options - Mount, settle and corpus size
 * @returns The sample, with the variant and probe each as a ratio of the real
 */
export async function pairedSample(
  options: PairedSampleOptions
): Promise<PairedSample> {
  const { mount, settleMs, corpusEntries = CORPUS_ENTRIES } = options;
  await settle(settleMs);
  const probe = await observeRemoval(mount, settleMs, () =>
    measureUnlinkLatencyUs(PROBE_CYCLES)
  );
  const variant = await observeRemoval(mount, settleMs, () =>
    measureUnlinkLatencyUs(PROBE_CYCLES)
  );
  const corpus = fillProbeDirectory(corpusEntries);
  const real = await observeRemoval(mount, settleMs, () =>
    timeRemovalUs(corpus, corpusEntries)
  );
  return {
    probeUs: probe.perEntryUs,
    variantUs: variant.perEntryUs,
    realUs: real.perEntryUs,
    variantToReal: ratio(variant.perEntryUs / real.perEntryUs),
    probeToReal: ratio(probe.perEntryUs / real.perEntryUs),
    entries: {
      probe: FS_PROBE_ENTRIES * PROBE_CYCLES,
      variant: FS_PROBE_ENTRIES * PROBE_CYCLES,
      real: corpusEntries,
    },
    discards: {
      probe: probe.discards,
      variant: variant.discards,
      real: real.discards,
    },
  };
}

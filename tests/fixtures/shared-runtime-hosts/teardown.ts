/** Owned-root removal for the packed-host journey, observed per removal step. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanupTempDir } from "../../helpers/test-utils.js";

/** The removal options `cleanupTempDir` asks Node for. */
const REMOVAL_OPTIONS = {
  force: true,
  maxRetries: 10,
  recursive: true,
  retryDelay: 100,
} as const;

/** The promise-based removal `cleanupTempDir` performs. */
const PROMISES_RM = "promises-rm";

/** One removal step: what it removed and which implementation removed it. */
interface RemovalStep {
  readonly label: string;
  readonly target: string;
  readonly method: typeof PROMISES_RM | "rmSync";
}

/** Linux block-device counters, in the kernel's `stat` field order. */
const DEVICE_FIELDS = [
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

/** The mount that holds the owned root, read from the kernel's own table. */
interface MountRecord {
  readonly device: string;
  readonly mountPoint: string;
  readonly fsType: string;
  readonly options: string;
}

/**
 * Find the mount holding a path, by the longest mount point prefix.
 * @param target - Existing path on the filesystem of interest
 * @returns The mount record, or undefined off Linux
 */
function mountOf(target: string): MountRecord | undefined {
  const table = "/proc/self/mountinfo";
  if (!fs.existsSync(table)) return undefined;
  const real = fs.realpathSync(target);
  return fs
    .readFileSync(table, "utf8")
    .split("\n")
    .filter(line => line.includes(" - "))
    .map(line => {
      const [left = "", right = ""] = line.split(" - ");
      const fields = left.split(" ");
      const [fsType = "", , superOptions = ""] = right.split(" ");
      return {
        device: fields[2] ?? "",
        mountPoint: fields[4] ?? "",
        fsType,
        options: `${fields[5] ?? ""};${superOptions}`,
      };
    })
    .filter(
      mount =>
        real === mount.mountPoint ||
        real.startsWith(
          mount.mountPoint.endsWith("/")
            ? mount.mountPoint
            : `${mount.mountPoint}/`
        )
    )
    .reduce<MountRecord | undefined>(
      (best, mount) =>
        best === undefined || mount.mountPoint.length > best.mountPoint.length
          ? mount
          : best,
      undefined
    );
}

/**
 * Read the block-device counters behind a mount, when there is a device.
 * @param mount - Mount holding the owned root
 * @returns Named counters, or undefined when none are readable
 */
function deviceCounters(
  mount: MountRecord | undefined
): Readonly<Record<string, number>> | undefined {
  const file = mount && `/sys/dev/block/${mount.device}/stat`;
  if (!file || !fs.existsSync(file)) return undefined;
  const values = fs.readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
  return Object.fromEntries(
    DEVICE_FIELDS.map((name, index) => [name, values[index] ?? 0])
  );
}

/** Everything one sample captures, at one instant. */
interface Sample {
  readonly at: number;
  readonly cpu: NodeJS.CpuUsage;
  readonly usage: NodeJS.ResourceUsage;
  readonly fs: fs.StatsFs;
  readonly device: Readonly<Record<string, number>> | undefined;
}

/**
 * Capture time, process CPU, I/O counters and filesystem free space together.
 * @param parent - Existing directory on the owned root's filesystem
 * @param mount - Mount holding the owned root
 * @returns The sample
 */
function sample(parent: string, mount: MountRecord | undefined): Sample {
  return {
    at: performance.now(),
    cpu: process.cpuUsage(),
    usage: process.resourceUsage(),
    fs: fs.statfsSync(parent),
    device: deviceCounters(mount),
  };
}

/**
 * Express what changed between two samples, in operator units.
 * @param before - Sample taken before the step
 * @param after - Sample taken after the step
 * @returns Wall, CPU, freed-space and I/O deltas
 */
function delta(before: Sample, after: Sample): Record<string, unknown> {
  const device =
    before.device && after.device
      ? Object.fromEntries(
          Object.entries(after.device).map(([name, value]) => [
            name,
            value - (before.device?.[name] ?? 0),
          ])
        )
      : null;
  return {
    ms: Math.round(after.at - before.at),
    cpuUserMs: Math.round((after.cpu.user - before.cpu.user) / 1000),
    cpuSystemMs: Math.round((after.cpu.system - before.cpu.system) / 1000),
    inodesFreed: Number(after.fs.ffree - before.fs.ffree),
    bytesFreed: Number(after.fs.bfree - before.fs.bfree) * after.fs.bsize,
    inBlocks: after.usage.fsRead - before.usage.fsRead,
    outBlocks: after.usage.fsWrite - before.usage.fsWrite,
    voluntarySwitches:
      after.usage.voluntaryContextSwitches -
      before.usage.voluntaryContextSwitches,
    involuntarySwitches:
      after.usage.involuntaryContextSwitches -
      before.usage.involuntaryContextSwitches,
    device,
  };
}

/**
 * List a directory's entries in a stable order.
 * @param directory - Existing directory
 * @returns Entry names, sorted
 */
function sortedNames(directory: string): readonly string[] {
  return [...fs.readdirSync(directory)].sort((left, right) =>
    left.localeCompare(right)
  );
}

/**
 * Split the shared install cache into four interleaved quarters so the two
 * removal implementations each remove two statistically similar halves.
 * @param root - Owned fixture root
 * @returns Quarter directories, in removal order
 */
function quarterCache(root: string): readonly string[] {
  const cache = path.join(root, "artifact-bun-cache");
  const quarters = [0, 1, 2, 3].map(index =>
    path.join(root, `cache-quarter-${index}`)
  );
  quarters.forEach(directory => fs.mkdirSync(directory));
  if (fs.existsSync(cache))
    sortedNames(cache).forEach((name, index) =>
      fs.renameSync(
        path.join(cache, name),
        path.join(quarters[index % 4] ?? cache, name)
      )
    );
  return quarters;
}

/**
 * Remove one step's target with its named implementation.
 * @param step - Target and implementation
 */
async function removeStep(step: RemovalStep): Promise<void> {
  if (step.method === "rmSync") fs.rmSync(step.target, REMOVAL_OPTIONS);
  else await cleanupTempDir(step.target);
}

/**
 * Remove the owned root, observing each step on the machine it runs on.
 *
 * DIAGNOSTIC (CodySwannGT/lisa#4548): alternates the current promise-based
 * removal with `fs.rmSync` over interleaved quarters of the shared cache, so
 * one hosted run compares both on the same corpus at the same moment.
 * @param root - Owned fixture root
 * @param observe - Emits one named observation
 */
export async function removeOwnedRoot(
  root: string,
  observe: (phase: string, detail: Record<string, unknown>) => void
): Promise<void> {
  const parent = path.dirname(root);
  const mount = mountOf(parent);
  const topLevel = fs.existsSync(root) ? sortedNames(root) : [];
  const quarters = quarterCache(root);
  const steps: readonly RemovalStep[] = [
    { label: "tool", target: path.join(root, "tool"), method: PROMISES_RM },
    ...quarters.map(
      (target, index): RemovalStep => ({
        label: path.basename(target),
        target,
        method: index % 2 === 0 ? PROMISES_RM : "rmSync",
      })
    ),
    { label: "remainder", target: root, method: PROMISES_RM },
  ];
  observe("environment", {
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? null,
    loadAverage: os.loadavg(),
    totalMemMb: Math.round(os.totalmem() / 2 ** 20),
    freeMemMb: Math.round(os.freemem() / 2 ** 20),
    mount: mount ?? null,
    topLevel,
  });
  for (const step of steps) {
    const before = sample(parent, mount);
    await removeStep(step);
    observe(`remove:${step.label}`, {
      method: step.method,
      ...delta(before, sample(parent, mount)),
    });
  }
}

/**
 * Machine-wide admission state: the decision lock, reservations, and readings.
 *
 * The state directory (`${XDG_CACHE_HOME:-$HOME/.cache}/lisa/admission/`) is
 * shared by every repository and worktree of one user, so a run in repository
 * B counts a run admitted from repository A.
 *
 * ## The lock
 *
 * Held only while deciding. It is a listening Unix-domain socket at
 * `admission.sock`: the OS closes it when the holder dies, so a crashed holder
 * leaves at most a socket FILE nobody listens on. A connect that fails with
 * `ECONNREFUSED` proves that, and the file is replaced. Before replacing it the
 * file's inode is read twice around the probe, so a socket another process
 * created in between is never unlinked. Windows uses a named pipe, which the OS
 * removes with its owner.
 *
 * ## Reservations
 *
 * One `<pid>.json` per admitted run, removed when the run ends. A reservation
 * whose pid is dead, or whose process start time no longer matches (the pid was
 * reused), is ignored and deleted by whoever reads it next.
 * @module core/admission-state
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, freemem, loadavg } from "node:os";
import { createConnection, createServer, type Server } from "node:net";
import { join } from "node:path";

import type {
  AdmissionReservation,
  MachineReading,
} from "./admission-decision.js";

/** File name of the decision lock. */
export const LOCK_FILE = "admission.sock";

/**
 * Where the decision lock listens.
 * @param stateDir - State directory
 * @returns Socket path, or a named pipe on Windows
 */
export function lockAddress(stateDir: string): string {
  if (process.platform !== "win32") return join(stateDir, LOCK_FILE);
  const digest = createHash("sha256").update(stateDir).digest("hex");
  return `\\\\.\\pipe\\lisa-admission-${digest.slice(0, 16)}`;
}

/**
 * Inode of a path, or null when it is absent.
 * @param path - Path to stat
 * @returns Inode number
 */
function inodeOf(path: string): number | null {
  try {
    return statSync(path).ino;
  } catch {
    return null;
  }
}

/**
 * Whether anything is listening on the lock address.
 * @param address - Socket path
 * @returns True when a holder answered, false on `ECONNREFUSED`/`ENOENT`
 */
function holderListening(address: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection(address);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", error => {
      const code = (error as NodeJS.ErrnoException).code;
      resolve(code !== "ECONNREFUSED" && code !== "ENOENT");
    });
  });
}

/**
 * Try once to take the decision lock.
 * @param address - Socket path
 * @returns The listening server, or null when somebody else holds it
 */
function tryListen(address: string): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer(connection => connection.destroy());
    server.once("error", error => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        resolve(null);
      } else {
        reject(error);
      }
    });
    server.listen(address, () => resolve(server));
  });
}

/**
 * Take the decision lock, replacing a socket file its dead holder left behind.
 * @param stateDir - State directory
 * @param sleep - Wait between attempts
 * @returns A release function
 */
export async function acquireDecisionLock(
  stateDir: string,
  sleep: (ms: number) => Promise<void>
): Promise<() => Promise<void>> {
  mkdirSync(stateDir, { recursive: true });
  return takeLock(lockAddress(stateDir), sleep);
}

/**
 * Listen on the lock address, retrying until it is ours.
 * @param address - Socket path
 * @param sleep - Wait between attempts
 * @returns A release function
 */
async function takeLock(
  address: string,
  sleep: (ms: number) => Promise<void>
): Promise<() => Promise<void>> {
  const server = await tryListen(address);
  if (server !== null) {
    return () => new Promise(resolve => server.close(() => resolve()));
  }
  const before = inodeOf(address);
  const listening = await holderListening(address);
  if (!listening && before !== null && inodeOf(address) === before) {
    rmSync(address, { force: true });
  } else {
    // Jitter only spreads retries apart; nothing depends on its quality.
    // eslint-disable-next-line sonarjs/pseudo-random -- retry jitter, not a secret
    await sleep(25 + Math.floor(Math.random() * 75));
  }
  return takeLock(address, sleep);
}

/**
 * Start times of the given pids, as `ps` reports them.
 * @param pids - Process ids
 * @returns Map of pid to start time; a pid absent from the map is not running
 */
export function processStartTimes(
  pids: readonly number[]
): ReadonlyMap<number, string> {
  if (pids.length === 0 || process.platform === "win32") return new Map();
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed system ps executable
  const child = spawnSync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], {
    encoding: "utf8",
  });
  if (typeof child.stdout !== "string") return new Map();
  return new Map(
    child.stdout
      .split("\n")
      .map(line => line.trim())
      .flatMap(line => {
        const space = line.indexOf(" ");
        const pid = Number(line.slice(0, space));
        return space > 0 && Number.isInteger(pid)
          ? [[pid, line.slice(space + 1).trim()] as const]
          : [];
      })
  );
}

/**
 * Whether a pid names a live process (`EPERM` counts: it exists).
 * @param pid - Process id
 * @returns Whether it is alive
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Seams for reading reservations. */
export interface ReservationProbes {
  /** Process-liveness probe. */
  readonly isAlive: (pid: number) => boolean;
  /** Start-time probe. */
  readonly startTimes: (pids: readonly number[]) => ReadonlyMap<number, string>;
}

/**
 * Parse one reservation file, or undefined when it is not one.
 * @param text - File contents
 * @returns Reservation
 */
function parseReservation(text: string): AdmissionReservation | undefined {
  try {
    const value = JSON.parse(text) as Partial<AdmissionReservation>;
    return typeof value.pid === "number" &&
      typeof value.workers === "number" &&
      typeof value.startedAt === "number"
      ? {
          pid: value.pid,
          processStartTime: value.processStartTime ?? null,
          workers: value.workers,
          command: String(value.command ?? ""),
          cwd: String(value.cwd ?? ""),
          startedAt: value.startedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read live reservations, deleting every dead or reused one.
 * @param stateDir - State directory
 * @param probes - Liveness seams
 * @returns Live reservations
 */
export function readLiveReservations(
  stateDir: string,
  probes: ReservationProbes
): readonly AdmissionReservation[] {
  const files = readdirSync(stateDir).filter(name => /^\d+\.json$/u.test(name));
  const parsed = files.map(name => ({
    path: join(stateDir, name),
    reservation: parseReservation(readTextOrEmpty(join(stateDir, name))),
  }));
  const starts = probes.startTimes(
    parsed.flatMap(entry =>
      entry.reservation === undefined ? [] : [entry.reservation.pid]
    )
  );
  return parsed.flatMap(({ path, reservation }) => {
    const live =
      reservation !== undefined &&
      probes.isAlive(reservation.pid) &&
      (reservation.processStartTime === null ||
        starts.size === 0 ||
        starts.get(reservation.pid) === reservation.processStartTime);
    if (live) return [reservation];
    rmSync(path, { force: true });
    return [];
  });
}

/**
 * Read a file as text, or empty when it vanished.
 * @param path - File path
 * @returns Contents
 */
function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Write this run's reservation.
 * @param stateDir - State directory
 * @param reservation - Reservation to record
 * @returns Its path
 */
export function writeReservation(
  stateDir: string,
  reservation: AdmissionReservation
): string {
  const path = join(stateDir, `${String(reservation.pid)}.json`);
  writeFileSync(path, `${JSON.stringify(reservation)}\n`, "utf8");
  return path;
}

/**
 * Memory available to a new process, in megabytes.
 *
 * `os.freemem()` on macOS counts only never-used pages, which on a busy Mac is
 * a few hundred megabytes even with gigabytes reclaimable, so there the
 * reading adds inactive and speculative pages from `vm_stat`. Linux reads
 * `MemAvailable`.
 * @returns Megabytes
 */
export function availableMemoryMb(): number {
  const fallback = freemem() / 1_048_576;
  if (process.platform === "linux") {
    const match = /^MemAvailable:\s+(\d+) kB/mu.exec(
      readTextOrEmpty("/proc/meminfo")
    );
    return match?.[1] === undefined ? fallback : Number(match[1]) / 1024;
  }
  if (process.platform !== "darwin") return fallback;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed system vm_stat executable
  const text = spawnSync("vm_stat", { encoding: "utf8" }).stdout ?? "";
  const page = Number(/page size of (\d+) bytes/u.exec(text)?.[1] ?? 0);
  const pages = ["free", "inactive", "speculative"].map(kind =>
    Number(new RegExp(`Pages ${kind}:\\s+(\\d+)`, "u").exec(text)?.[1] ?? 0)
  );
  const total = pages.reduce((sum, count) => sum + count, 0) * page;
  return total > 0 ? total / 1_048_576 : fallback;
}

/**
 * Read the machine once.
 * @returns Cores, load and memory
 */
export function readMachine(): MachineReading {
  return {
    cores: availableParallelism(),
    load1: loadavg()[0] ?? 0,
    freeMemoryMb: availableMemoryMb(),
  };
}

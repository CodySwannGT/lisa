/**
 * The headroom-admission decision lock (CodySwannGT/lisa#4596).
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
 * Taking the lock is bounded by the caller's remaining wait. A holder that
 * never lets go — one suspended with Ctrl-Z, or another local user listening
 * at the address — used to make every acquirer retry forever. Past the bound,
 * or when the address cannot be ours (it belongs to another user, it is not a
 * socket, it cannot be opened), `acquireDecisionLock` reports the lock
 * unavailable instead, and admission starts the run without deciding rather
 * than block it (CodySwannGT/lisa#4596 review). Nothing at the address is
 * deleted unless it is a socket this user owns.
 * @module core/admission-lock
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  rmSync,
  type Stats,
  statSync,
} from "node:fs";
import { tmpdir as systemTmpdir } from "node:os";
import { createConnection, createServer, type Server } from "node:net";
import { dirname, join } from "node:path";

/** File name of the decision lock. */
export const LOCK_FILE = "admission.sock";

/**
 * Longest Unix socket path every supported platform can bind. macOS caps
 * `sun_path` at 104 bytes and, past it, binds a silently TRUNCATED path, so a
 * lock at the full path is never visible and `takeLock` would retry until its bound.
 */
export const UNIX_SOCKET_PATH_LIMIT = 103;

/** Mode of the per-user fallback lock directory. */
export const PRIVATE_DIR_MODE = 0o700;

/** The longest a probe of the lock holder may take before it counts as held. */
const PROBE_TIMEOUT_MS = 1_000;

/**
 * This process's uid, or undefined where the platform has none (Windows).
 * @returns The uid
 */
function currentUid(): number | undefined {
  return process.getuid?.();
}

/**
 * `lstat` of a path, or the error code when it cannot be read.
 * @param path - Path
 * @returns Stats, or the code
 */
function lstatOrCode(path: string): Stats | string {
  try {
    return lstatSync(path);
  } catch (error) {
    return codeOf(error);
  }
}

/**
 * Why an error happened, as its errno code when it has one.
 * @param error - Thrown value
 * @returns Code or message
 */
function codeOf(error: unknown): string {
  return String(
    (error as NodeJS.ErrnoException).code ?? (error as Error).message
  );
}

/**
 * Where the decision lock listens.
 *
 * A state directory deep enough to push `admission.sock` past the socket limit
 * (a long `XDG_CACHE_HOME`, a nested test scratch root) moves the lock to
 * `<tmp>/lisa-admission-<uid>/<digest>.sock`, named by the state directory so
 * every process sharing that directory still meets on one lock. The directory
 * is per user and created 0700 (see `privateLockDirProblem`): a predictable
 * name straight in a world-writable `/tmp` let another local user listen there,
 * or plant a file, and hang or break every push. The user's own temp directory
 * is preferred; `/tmp` is the fallback when that is too deep to fit.
 * @param stateDir - State directory
 * @param platform - Platform to decide for
 * @param tmp - The user's temp directory
 * @param uid - The user's uid
 * @returns Socket path, or a named pipe on Windows
 */
export function lockAddress(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
  tmp: string = systemTmpdir(),
  uid: number | undefined = currentUid()
): string {
  const digest = createHash("sha256")
    .update(stateDir)
    .digest("hex")
    .slice(0, 16);
  if (platform === "win32") return `\\\\.\\pipe\\lisa-admission-${digest}`;
  const beside = join(stateDir, LOCK_FILE);
  if (Buffer.byteLength(beside) <= UNIX_SOCKET_PATH_LIMIT) return beside;
  const name = `lisa-admission-${String(uid ?? "user")}`;
  const preferred = join(tmp, name, `${digest}.sock`);
  return Buffer.byteLength(preferred) <= UNIX_SOCKET_PATH_LIMIT
    ? preferred
    : join("/tmp", name, `${digest}.sock`);
}

/**
 * Why a path may not be used as this user's lock, or null when it may: it is
 * absent, or it is a socket this user owns.
 * @param path - Lock address
 * @param uid - The user's uid; undefined skips the check (Windows)
 * @returns The problem, or null
 */
export function lockPathProblem(
  path: string,
  uid: number | undefined = currentUid()
): string | null {
  const stat = lstatOrCode(path);
  if (uid === undefined || typeof stat === "string") return null;
  if (stat.uid !== uid)
    return `${path} belongs to another user (uid ${String(stat.uid)})`;
  if (!stat.isSocket()) return `${path} is not a socket`;
  return null;
}

/**
 * Why a fallback lock directory may not be used, or null when it may. It must
 * be a real directory (not a symlink) this user owns; one left group- or
 * world-accessible is tightened to 0700.
 * @param dir - Directory
 * @param uid - The user's uid
 * @returns The problem, or null
 */
export function privateLockDirProblem(
  dir: string,
  uid: number | undefined = currentUid()
): string | null {
  const stat = lstatOrCode(dir);
  if (uid === undefined) return null;
  if (typeof stat === "string") return `${dir} could not be read (${stat})`;
  if (!stat.isDirectory()) return `${dir} is not a directory`;
  if (stat.uid !== uid)
    return `${dir} belongs to another user (uid ${String(stat.uid)})`;
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, PRIVATE_DIR_MODE);
  return null;
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

/** What a probe of the lock address found. */
type Probe =
  | { readonly kind: "held" }
  | { readonly kind: "stale" }
  | { readonly kind: "denied"; readonly code: string };

/**
 * Whether anything is listening on the lock address. A probe that does not
 * finish within `timeoutMs` counts as held, so the probe itself cannot hang.
 * @param address - Socket path
 * @param timeoutMs - Longest the probe may take
 * @returns Held when a holder answered (or the probe timed out), stale on
 *   `ECONNREFUSED`/`ENOENT`, denied when the address refuses this user
 */
function probeHolder(address: string, timeoutMs: number): Promise<Probe> {
  return new Promise(resolve => {
    const socket = createConnection(address);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ kind: "held" });
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve({ kind: "held" });
    });
    socket.once("error", error => {
      const code = String((error as NodeJS.ErrnoException).code);
      if (code === "ECONNREFUSED" || code === "ENOENT") {
        resolve({ kind: "stale" });
      } else if (code === "EACCES" || code === "EPERM") {
        resolve({ kind: "denied", code });
      } else {
        resolve({ kind: "held" });
      }
    });
  });
}

/**
 * Try once to take the decision lock.
 * @param address - Socket path
 * @returns The listening server, null when somebody else holds it, or the
 *   error code when the address cannot be opened at all
 */
function tryListen(address: string): Promise<Server | null | string> {
  return new Promise(resolve => {
    const server = createServer(connection => connection.destroy());
    server.once("error", error => {
      // macOS answers a bind through a symlinked directory (`/tmp`) with
      // EEXIST rather than EADDRINUSE; both mean the address is taken.
      const code = codeOf(error);
      resolve(code === "EADDRINUSE" || code === "EEXIST" ? null : code);
    });
    server.listen(address, () => resolve(server));
  });
}

/** How long, and on which clock, taking the lock may wait. */
export interface LockWait {
  /** Wait between attempts. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Wall clock. */
  readonly now: () => number;
  /** Epoch milliseconds after which the lock counts as unavailable. */
  readonly until: number;
}

/** The lock, or why it could not be taken within the bound. */
export type DecisionLock =
  | { readonly release: () => Promise<void> }
  | { readonly unavailable: string };

/**
 * Take the decision lock, replacing a socket file its dead holder left behind,
 * or report it unavailable when it cannot be ours within the bound.
 * @param stateDir - State directory
 * @param wait - Sleep, clock and deadline
 * @returns The lock, or why it is unavailable
 */
export async function acquireDecisionLock(
  stateDir: string,
  wait: LockWait
): Promise<DecisionLock> {
  const address = lockAddress(stateDir);
  const dir = dirname(address);
  mkdirSync(stateDir, { recursive: true });
  if (process.platform !== "win32" && dir !== stateDir) {
    try {
      mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    } catch (error) {
      return { unavailable: `${dir} could not be created (${codeOf(error)})` };
    }
    const problem = privateLockDirProblem(dir);
    if (problem !== null) return { unavailable: problem };
  }
  return takeLock(address, wait);
}

/**
 * Listen on the lock address, retrying until it is ours or the bound passes.
 * @param address - Socket path
 * @param wait - Sleep, clock and deadline
 * @returns The lock, or why it is unavailable
 */
async function takeLock(
  address: string,
  wait: LockWait
): Promise<DecisionLock> {
  const problem = lockPathProblem(address);
  if (problem !== null) return { unavailable: problem };
  const server = await tryListen(address);
  if (typeof server === "string") {
    return { unavailable: `${address} could not be opened (${server})` };
  }
  if (server !== null) {
    return {
      release: () => new Promise(resolve => server.close(() => resolve())),
    };
  }
  const remaining = wait.until - wait.now();
  const before = inodeOf(address);
  const probe = await probeHolder(
    address,
    Math.max(1, Math.min(PROBE_TIMEOUT_MS, remaining))
  );
  if (probe.kind === "denied") {
    return { unavailable: `${address} refused this user (${probe.code})` };
  }
  if (
    probe.kind === "stale" &&
    before !== null &&
    inodeOf(address) === before
  ) {
    try {
      rmSync(address, { force: true });
    } catch (error) {
      return {
        unavailable: `${address} could not be replaced (${codeOf(error)})`,
      };
    }
    return takeLock(address, wait);
  }
  const left = wait.until - wait.now();
  if (left <= 0) {
    return {
      unavailable: `another process held ${address} for the whole wait`,
    };
  }
  // Jitter only spreads retries apart; nothing depends on its quality.
  // eslint-disable-next-line sonarjs/pseudo-random -- retry jitter, not a secret
  await wait.sleep(Math.min(left, 25 + Math.floor(Math.random() * 75)));
  return takeLock(address, wait);
}

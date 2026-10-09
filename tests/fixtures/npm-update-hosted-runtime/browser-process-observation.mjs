/** Read-only Linux browser observations never export identities, arguments or paths. */
import { open, opendir, readlink, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { performance } from "node:perf_hooks";

const STOPPED = "diagnostic collection stopped";
const ROLES = new Set([
  "renderer",
  "zygote",
  "gpu-process",
  "utility",
  "broker",
]);
const WAITS = new Set([
  "0",
  "futex_wait_queue",
  "do_epoll_wait",
  "ep_poll",
  "do_wait",
  "unix_stream_read_generic",
  "hrtimer_nanosleep",
  "wait_woken",
  "poll_schedule_timeout.constprop.0",
]);

/**
 * Only closed kernel facts survive; absence never means a sandbox is enabled.
 * @param {object} root0 Bounded kernel observations.
 * @param {string} root0.state Observed kernel state.
 * @param {string} root0.status Bounded kernel status bytes.
 * @param {string} root0.args Bounded argument bytes discarded after role selection.
 * @param {string} root0.wait Observed wait channel.
 * @returns {object} Closed diagnostic facts.
 */
export function browserKernelFields({ state, status, args, wait }) {
  const flag = (name, maximum) => {
    const found = status.match(new RegExp(`^${name}:\\s*([0-9]+)$`, "m"));
    const value = found ? Number(found[1]) : null;
    return value !== null && value <= maximum ? value : null;
  };
  const types = args.split("\0").filter(value => value.startsWith("--type="));
  const role = types.length === 0 ? "browser" : types[0].slice(7);
  return {
    state: /^[RSDZTXIP]$/.test(state) ? state : "unknown",
    role:
      types.length <= 1 && (role === "browser" || ROLES.has(role))
        ? role
        : "other",
    noNewPrivileges: flag("NoNewPrivs", 1),
    seccomp: flag("Seccomp", 2),
    wait: WAITS.has(wait.trim()) ? wait.trim() : "other",
  };
}

/**
 * Kernel pseudo-files are finite inputs; none of their original bytes are published.
 * @param {string} file Fixed kernel pseudo-file.
 * @param {function():boolean} active Current read-only lease.
 * @returns {Promise<string>} Bounded original bytes.
 */
async function text(file, active) {
  if (!active()) throw new Error(STOPPED);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(65537);
    const cursor = { size: 0 };
    while (cursor.size < bytes.length) {
      if (!active()) throw new Error(STOPPED);
      const { bytesRead } = await fd.read(
        bytes,
        cursor.size,
        bytes.length - cursor.size,
        null
      );
      cursor.size += bytesRead;
      if (cursor.size > 65536)
        throw new Error("kernel diagnostic exceeds bound");
      if (bytesRead === 0) return bytes.subarray(0, cursor.size).toString();
    }
    throw new Error("kernel diagnostic exceeds bound");
  } finally {
    await fd.close();
  }
}

/**
 * Birth plus parent prevents a recycled identifier from establishing ancestry.
 * @param {number} pid Kernel process identifier.
 * @param {function():boolean} active Current read-only lease.
 * @returns {Promise<object>} Birth and parent facts, never exported.
 */
async function identity(pid, active) {
  const value = await text(`/proc/${pid}/stat`, active);
  const split = value.lastIndexOf(") ");
  const fields = value
    .slice(split + 2)
    .trim()
    .split(/\s+/);
  if (
    split < 1 ||
    Number(value.slice(0, value.indexOf(" "))) !== pid ||
    !/^\d+$/.test(fields[19]) ||
    !/^\d+$/.test(fields[1])
  )
    throw new Error("kernel identity differs");
  return {
    pid,
    parent: Number(fields[1]),
    birth: fields[19],
    state: fields[0],
  };
}

/**
 * Every observed lineage must reach this live qualifier, with unchanged births.
 * @param {object} value Selected process birth.
 * @param {object} owner This qualifier birth.
 * @param {function():boolean} active Read-only observation lease.
 * @returns {Promise<boolean>} Observed owned ancestry.
 */
async function descendant(value, owner, active) {
  const chain = [value];
  while (chain.length < 32 && chain.at(-1).parent > 1) {
    const parent = await observedRead(active, () =>
      identity(chain.at(-1).parent, active)
    );
    chain.push(parent);
    if (parent.pid === owner.pid && parent.birth === owner.birth) {
      for (const previous of chain) {
        const current = await observedRead(active, () =>
          identity(previous.pid, active)
        );
        if (
          current.birth !== previous.birth ||
          current.parent !== previous.parent
        )
          return false;
      }
      return true;
    }
    if (chain.slice(0, -1).some(previous => previous.pid === parent.pid))
      return false;
  }
  return false;
}

/**
 * Active collection guards every new read without delaying the native command.
 * @param {function():boolean} active Current observation lease.
 * @template T
 * @param {function():Promise<T>} operation One read-only kernel operation.
 * @returns {Promise<T>} Current result or diagnostic refusal.
 */
async function observedRead(active, operation) {
  if (!active()) throw new Error(STOPPED);
  const value = await operation();
  if (!active()) throw new Error(STOPPED);
  return value;
}

/**
 * At most 32 readable owned rows; identity and executable are checked around reads.
 * @param {string} command Original verified executable.
 * @param {object} owner This live qualifier's birth.
 * @param {object} original Original executable inode.
 * @param {function():boolean} observing Current native-operation lease.
 * @returns {Promise<object>} Partial, closed observations.
 */
async function snapshot(command, owner, original, observing) {
  const start = performance.now();
  const active = () => observing() && performance.now() - start <= 500;
  const read = operation => observedRead(active, operation);
  const rows = [];
  const state = { entries: 0, incomplete: false };
  if (!active()) throw new Error(STOPPED);
  const directory = await opendir("/proc", { bufferSize: 32 });
  try {
    while (active() && state.entries < 10000 && rows.length < 32) {
      const entry = await read(() => directory.read());
      if (!entry) break;
      state.entries += 1;
      if (!active() || state.entries > 10000 || rows.length === 32) {
        state.incomplete = true;
        break;
      }
      if (!/^[1-9]\d*$/.test(entry.name)) continue;
      const base = `/proc/${entry.name}`;
      const selected = { executable: false };
      try {
        const before = await read(() => identity(Number(entry.name), active));
        if ((await read(() => readlink(`${base}/exe`))) !== command) continue;
        selected.executable = true;
        const binary = await read(() => stat(`${base}/exe`));
        if (binary.dev !== original.dev || binary.ino !== original.ino)
          continue;
        if (!(await read(() => descendant(before, owner, active)))) continue;
        const status = await read(() => text(`${base}/status`, active));
        const args = await read(() => text(`${base}/cmdline`, active));
        const wait = await read(() => text(`${base}/wchan`, active));
        const after = await read(() => identity(Number(entry.name), active));
        const finalBinary = await read(() => stat(`${base}/exe`));
        const finalPath = await read(() => readlink(`${base}/exe`));
        if (
          before.birth !== after.birth ||
          before.parent !== after.parent ||
          binary.dev !== finalBinary.dev ||
          binary.ino !== finalBinary.ino ||
          finalPath !== command
        ) {
          state.incomplete = true;
          continue;
        }
        rows.push(
          browserKernelFields({ state: after.state, status, args, wait })
        );
      } catch {
        if (selected.executable || !active()) state.incomplete = true;
      }
    }
  } finally {
    await directory.close();
  }
  return {
    rows,
    incomplete:
      state.incomplete ||
      !active() ||
      state.entries === 10000 ||
      rows.length === 32,
    elapsedMs: Math.round(performance.now() - start),
  };
}

/**
 * Best-effort collection cannot postpone native startup, result or failure.
 * @param {string} command Original verified executable.
 * @returns {{stop:function():object}} Synchronous cancellation and closed snapshot.
 */
export function startBrowserObservation(command) {
  const samples = [];
  const supported = process.platform === "linux";
  const started = performance.now();
  const state = {
    stopped: false,
    pending: supported ? 1 : 0,
    unavailable: false,
  };
  const active = () => !state.stopped && performance.now() - started < 10000;
  const setup = supported
    ? (async () => {
        try {
          const owner = await observedRead(active, () =>
            identity(process.pid, active)
          );
          const executable = await observedRead(active, () =>
            realpath(command)
          );
          const original = await observedRead(active, () => stat(executable));
          return { owner, original, executable };
        } catch {
          if (active()) state.unavailable = true;
          return null;
        } finally {
          state.pending -= 1;
        }
      })()
    : Promise.resolve(null);
  const timers = supported
    ? [2500, 5000, 7500].map(delay =>
        setTimeout(() => {
          if (!active()) return;
          state.pending += 1;
          void (async () => {
            try {
              const ready = await setup;
              if (!ready || !active()) return;
              const atMs = Math.round(performance.now() - started);
              const result = await snapshot(
                ready.executable,
                ready.owner,
                ready.original,
                active
              );
              if (active()) samples.push({ atMs, ...result });
            } catch {
              if (active())
                samples.push({
                  atMs: Math.round(performance.now() - started),
                  unavailable: true,
                });
            } finally {
              state.pending -= 1;
            }
          })();
        }, delay)
      )
    : [];
  return {
    stop() {
      state.stopped = true;
      timers.forEach(clearTimeout);
      return {
        supported,
        diagnosticOnly: true,
        unavailable: state.unavailable,
        pendingReads: state.pending > 0,
        samples: samples.slice().sort((a, b) => a.atMs - b.atMs),
      };
    },
  };
}

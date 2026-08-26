/**
 * Vitest Configuration - Per-process scratch redirection (setup file)
 *
 * Wired as a Vitest `setupFiles` entry, so it executes inside every test worker
 * before any test file runs. It points `os.tmpdir()` at a run root this process
 * owns, which relocates EVERY `mkdtemp(os.tmpdir())` call in the suite without
 * editing a single test — in Lisa's own suite, 481 call sites across 211 files.
 *
 * `os.tmpdir()` re-reads the environment on every call rather than caching it at
 * startup, which is the seam this relies on:
 *
 * ```
 * $ node -e 'const os=require("os"); console.log(os.tmpdir());
 *            process.env.TMPDIR="/tmp/probe"; console.log(os.tmpdir())'
 * /var/folders/<...>/T
 * /tmp/probe
 * ```
 *
 * A signalled exit is covered too, which is not obvious and is the whole of
 * CodySwannGT/lisa#2950: see the signal handlers in `installScratchRoot`.
 *
 * Because the assignment mutates the process environment, subprocesses the
 * tests spawn inherit the redirection too — a fixture's `git`, `npm pack` or
 * `tsc` child writes into the same bounded root, so a child that outlives its
 * test cannot leak into the shared directory either.
 *
 * The work is done once per process, not once per test file, even though Vitest
 * re-executes setup files for each file.
 * @see {@link module:configs/vitest/scratch} for why the root is shaped this way
 * @module configs/vitest/scratch-setup
 */
import * as fs from "node:fs";
import { env } from "node:process";

import {
  SCRATCH_ROOT_ENV,
  adoptOwnedScratchRunRoot,
  reclaimAndCreateOwnedRunRoot,
  removeOwnedScratchRunRoot,
  scratchBaseDir,
  type OwnedScratchRunRoot,
} from "./scratch.js";

/**
 * Signals a worker is reaped with, each of which skips `exit` by default.
 *
 * `SIGTERM` is the one measured in this repository — it is how vitest's
 * `forks` pool ends a worker. `SIGINT` and `SIGHUP` are here because they
 * reach the same process by the same route with the same default action: an
 * operator pressing ctrl-C, and a terminal closing on a run left going. A
 * handler that covered only the case that happened to be measured would leave
 * the other two producing exactly the residue this removes.
 *
 * `SIGKILL` is deliberately absent — it cannot be caught, which is precisely
 * why reclaim-on-start exists and is tested separately.
 */
const REAPING_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGTERM",
  "SIGINT",
  "SIGHUP",
];

/** Key under which the per-process run root is memoised. */
const RUN_ROOT_KEY = "__lisaScratchRunRoot__";

/** Key holding the authority/token handle while preserving the path memo ABI. */
const RUN_ROOT_HANDLE_KEY = "__lisaScratchRunRootHandleV1__";

/** `globalThis` widened with the memo slot this module owns. */
type ScratchGlobal = typeof globalThis & {
  /** Run root allocated by the first execution of this module in the process */
  [RUN_ROOT_KEY]?: string;
  /** Authority handle paired with the source/dist-compatible path memo */
  [RUN_ROOT_HANDLE_KEY]?: OwnedScratchRunRoot;
};

/**
 * Points this process's temp directory at a run root it owns, creating the root
 * on first call and reusing it afterwards.
 *
 * All three of `TMPDIR`, `TMP` and `TEMP` are set: Node reads `TMPDIR` on POSIX
 * and `TEMP`/`TMP` on Windows, and non-Node tools spawned by fixtures read
 * whichever their platform prefers. Setting one would leave the others pointing
 * at the shared directory for exactly the callers hardest to see.
 * @returns Absolute path of this process's run root.
 */
export const installScratchRoot = (): string => {
  const scope = globalThis as ScratchGlobal;
  const existing = scope[RUN_ROOT_KEY];
  if (existing !== undefined && fs.existsSync(existing)) {
    if (scope[RUN_ROOT_HANDLE_KEY] === undefined) {
      const base = scratchBaseDir();
      scope[RUN_ROOT_HANDLE_KEY] = adoptOwnedScratchRunRoot(existing, base);
    }
    return existing;
  }

  // Read before the redirection lands: `scratchNamespaceDir()` derives from
  // `os.tmpdir()`, so once TMPDIR moves, a later call in this process — or in a
  // child that inherits the environment — would otherwise compute a namespace
  // NESTED INSIDE the run root and sweep the wrong directory. Recording the
  // base makes the resolution idempotent under its own side effect.
  const base = scratchBaseDir();
  const owned = reclaimAndCreateOwnedRunRoot(base);
  const root = owned.path;

  scope[RUN_ROOT_KEY] = root;
  scope[RUN_ROOT_HANDLE_KEY] = owned;
  env[SCRATCH_ROOT_ENV] = base;
  env["TMPDIR"] = root;
  env["TMP"] = root;
  env["TEMP"] = root;

  // Covers an ordinary exit, including one where tests failed.
  process.once("exit", () => {
    removeOwnedScratchRunRoot(owned);
  });

  // And covers the exit this suite ACTUALLY takes, which is not an ordinary
  // one. Measured on vitest 4.1.9, `forks` pool, by recording every lifecycle
  // event a worker reaches: the pool ends a worker with SIGTERM, and node's
  // default action for SIGTERM terminates the process WITHOUT running `exit`
  // handlers. So the handler above — the only mechanism that removes a run's
  // own root — never ran for any worker, and a completely green run left its
  // root behind every time (CodySwannGT/lisa#2950).
  //
  // That was invisible for the usual reason: the next run's sweep reclaims a
  // root whose pid is dead, so the residue disappeared before anyone looked
  // for it, and the namespace never grew. The behaviour was reported as
  // present because its effect was eventually produced by something else.
  //
  // The same probe shows a worker DOES reach `exit` once a listener for the
  // signal exists, because installing one displaces node's default action.
  // Removing the listener and re-raising restores it, so the process still
  // dies of the signal it was sent, with the status the pool expects — this
  // buys the cleanup, not a different lifecycle.
  for (const signal of REAPING_SIGNALS) {
    process.once(signal, () => {
      removeOwnedScratchRunRoot(owned);
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }

  return root;
};

installScratchRoot();

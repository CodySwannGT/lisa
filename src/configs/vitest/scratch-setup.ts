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
  reclaimAndCreateRunRoot,
  removeScratchDir,
  scratchBaseDir,
  scratchNamespaceDir,
} from "./scratch.js";

/** Key under which the per-process run root is memoised. */
const RUN_ROOT_KEY = "__lisaScratchRunRoot__";

/** `globalThis` widened with the memo slot this module owns. */
type ScratchGlobal = typeof globalThis & {
  /** Run root allocated by the first execution of this module in the process */
  [RUN_ROOT_KEY]?: string;
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
    return existing;
  }

  // Read before the redirection lands: `scratchNamespaceDir()` derives from
  // `os.tmpdir()`, so once TMPDIR moves, a later call in this process — or in a
  // child that inherits the environment — would otherwise compute a namespace
  // NESTED INSIDE the run root and sweep the wrong directory. Recording the
  // base makes the resolution idempotent under its own side effect.
  const base = scratchBaseDir();
  const root = reclaimAndCreateRunRoot(scratchNamespaceDir());

  scope[RUN_ROOT_KEY] = root;
  env[SCRATCH_ROOT_ENV] = base;
  env["TMPDIR"] = root;
  env["TMP"] = root;
  env["TEMP"] = root;

  // Covers an ordinary exit, including one where tests failed. A signalled exit
  // does not run this — nothing can — and is handled by the next run's sweep.
  process.once("exit", () => {
    removeScratchDir(root);
  });

  return root;
};

installScratchRoot();

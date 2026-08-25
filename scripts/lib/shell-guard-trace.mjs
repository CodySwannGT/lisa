/**
 * shell-guard-trace — record which shipped `.sh` guards a test run actually
 * EXECUTES, and with what exit status (CodySwannGT/lisa#3190).
 *
 * @remarks
 * ## Why a runtime trace rather than a scan of the tests
 *
 * The question this module answers is "which guard did the suite run", and
 * every static spelling of that question has been tried here and is wrong in
 * the direction that produces silence:
 *
 *  - **By filename.** `foo.test.ts` next to `foo.sh` proves nothing. A test
 *    named after a guard that never runs it is the deceptive case
 *    CodySwannGT/lisa#3190 was filed about, and a scan keyed on names reports
 *    it as covered.
 *  - **By the path appearing in the test source.** Measured on this tree:
 *    258 of 259 tracked `.sh` files are named somewhere inside a test file that
 *    also spawns something — inventories, manifests, and parity tables mention
 *    every shipped artifact. The signal is noise.
 *  - **By resolving the spawn argument statically.** Precise where it works
 *    (26 guards found) and blind exactly where this repository's suites are
 *    most interesting: the dominant idiom READS a guard's bytes, writes them
 *    into a fixture project under a different name, and executes THAT. The
 *    shipped path never reaches a spawn argument at all.
 *
 * The trace has none of those failure modes because it observes the process
 * table instead of arguing about it, and it handles the write-a-copy idiom by
 * matching on **content hash**: the copy is byte-identical to the guard, so it
 * is the guard.
 *
 * ## What it does not see, stated rather than hidden
 *
 *  - A helper reached by `source` rather than by `bash` is not a child process
 *    and never appears here. `lisa-edit-gate.sh` is the live example — every
 *    on-edit hook sources it. Such a helper enters the population only when a
 *    suite executes it directly, which is how CodySwannGT/lisa#3190's roster
 *    covers it.
 *  - Asynchronous child starts are not patched. Every child start in this
 *    test tree is synchronous by rule — see `tests/helpers/unbounded-spawn-scan`
 *    — so patching the three synchronous entry points covers the population,
 *    and a suite that started a guard asynchronously would be a rule violation
 *    caught by that scan first.
 *  - A suite that mocks `node:child_process` wholesale never reaches this
 *    module, and nothing real ran, so there is nothing to record.
 *
 * ## Loaded with `--import`, not as a vitest setup file
 *
 * `--import` runs before any user module links, so the patch lands on the CJS
 * `child_process` exports that node's ESM facade for the builtin is later
 * generated from. Measured: a vitest case using `import { spawnSync } from
 * "node:child_process"` is intercepted. A vitest `setupFiles` entry runs after
 * linking and would miss every already-bound import, and it would also collide
 * with the suites that `vi.mock` the module.
 *
 * It NEVER throws and never changes a return value: a tracer that can break the
 * suite it observes would be turned off, and then this whole control is prose.
 *
 * @module scripts/lib/shell-guard-trace
 */
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/** Largest file the tracer will hash, in bytes. */
const MAX_HASHED_BYTES = 2_000_000;

/** Longest argv element the tracer will treat as a possible path. */
const MAX_PATH_LENGTH = 4096;

const traceFile = process.env["LISA_SHELL_GUARD_TRACE"];
const indexFile = process.env["LISA_SHELL_GUARD_INDEX"];

if (traceFile && indexFile) install(traceFile, indexFile);

/**
 * Patch the synchronous child starts so every guard execution is recorded.
 * @param {string} trace - Path of the JSONL trace to append to.
 * @param {string} index - Path of the guard index JSON to read.
 * @returns {void}
 */
function install(trace, index) {
  /** @type {{ byHash: Record<string, string[]>, sizes: number[] }} */
  let inventory;
  try {
    inventory = JSON.parse(readFileSync(index, "utf8"));
  } catch {
    return;
  }
  const sizes = new Set(inventory.sizes);
  const seen = new Set();

  /**
   * Append one observation, at most once per guard/status pair per process.
   * @param {string} script - Repository-relative guard path.
   * @param {number | null} status - The guard's exit status.
   * @param {string} origin - Test frame that started it.
   * @returns {void}
   */
  const record = (script, status, origin) => {
    const key = `${script}:${String(status)}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      appendFileSync(trace, `${JSON.stringify({ script, status, origin })}\n`);
    } catch {
      /* A trace that cannot be written must not fail the suite. */
    }
  };

  /**
   * Whether one child start RUNS its shell operand rather than inspecting it.
   *
   * This distinction is load-bearing and was found by measurement, not by
   * reasoning. Without it, `bash -n script.sh` — a syntax check that never
   * executes a line — reported fourteen `scripts/*.sh` as "driven, only ever
   * exit 0", which is a false accusation of exactly the defect this control
   * looks for. `shellcheck`, `cat` and `cp` name a guard in argv for the same
   * reason and run none of it.
   *
   * So the operand counts only under an interpreter that will execute it, with
   * POSIX `-n` (noexec) absent.
   * @param {string} command - The command the child start was given.
   * @param {string[]} argv - Its argument vector.
   * @returns {boolean} Whether the operand is being executed.
   */
  const executes = (command, argv) => {
    const runner = path.basename(command.split(/\s+/u)[0] ?? "");
    if (!["bash", "sh", "dash", "ksh", "zsh", "env"].includes(runner)) {
      return false;
    }
    return !argv.includes("-n");
  };

  /**
   * Every tracked guard whose bytes appear in one child start's argv.
   * @param {unknown} command - First argument of the child start.
   * @param {unknown} args - Second argument: an argv array, or the options.
   * @param {unknown} third - Third argument, when the second was an argv array.
   * @returns {string[]} Repository-relative guard paths.
   */
  const matched = (command, args, third) => {
    if (typeof command !== "string") return [];
    const argv = Array.isArray(args)
      ? args.filter(entry => typeof entry === "string")
      : [];
    // A guard invoked as the command itself is executing itself; anything else
    // is executing only when the interpreter says so.
    const tokens = executes(command, argv)
      ? [...command.split(/\s+/u), ...argv]
      : [command];
    const options = Array.isArray(args) ? third : args;
    const cwd =
      options !== null &&
      typeof options === "object" &&
      typeof (/** @type {{cwd?: unknown}} */ (options).cwd) === "string"
        ? /** @type {{cwd: string}} */ (options).cwd
        : process.cwd();
    const hits = new Set();
    for (const token of tokens) {
      if (!token || token.length > MAX_PATH_LENGTH) continue;
      const absolute = path.isAbsolute(token)
        ? token
        : path.resolve(cwd, token);
      let size = -1;
      try {
        const stats = statSync(absolute);
        if (!stats.isFile()) continue;
        size = stats.size;
      } catch {
        continue;
      }
      // Hash only what could be a guard. Every tracked guard's size is known,
      // so a `git`, a `node`, or a fixture source is rejected by an integer
      // comparison rather than by reading it.
      if (!sizes.has(size) || size > MAX_HASHED_BYTES) continue;
      try {
        const digest = createHash("sha256")
          .update(readFileSync(absolute))
          .digest("hex");
        for (const guard of inventory.byHash[digest] ?? []) hits.add(guard);
      } catch {
        continue;
      }
    }
    return [...hits];
  };

  /**
   * The first stack frame inside the test tree, for the failure report.
   * @returns {string} A `file:line` frame, or an empty string.
   */
  const origin = () => {
    const frames = (new Error("trace").stack ?? "")
      .split("\n")
      .filter(line => line.includes("/tests/"));
    // The suite, not the helper it reached through. Every bounded spawn in this
    // tree goes through `tests/helpers/io-latency-budget`, so naming the first
    // `tests/` frame would name that helper for nearly every observation and
    // the report would say nothing about where to look.
    const frame = frames.find(line => line.includes(".test.ts")) ?? frames[0];
    return (frame ?? "").trim().replace(/^at\s+/u, "");
  };

  const require = createRequire(import.meta.url);
  const childProcess = require("node:child_process");

  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function tracedSpawnSync(command, args, options) {
    const result = originalSpawnSync.call(this, command, args, options);
    try {
      const guards = matched(command, args, options);
      if (guards.length > 0) {
        const where = origin();
        for (const guard of guards) record(guard, result.status, where);
      }
    } catch {
      /* Never let observation change the observed. */
    }
    return result;
  };

  for (const name of ["execFileSync", "execSync"]) {
    const original = childProcess[name];
    childProcess[name] = function tracedExec(command, args, options) {
      /**
       * Record one outcome of the wrapped call.
       * @param {number | null} status - Its exit status.
       * @returns {void}
       */
      const observe = status => {
        try {
          const guards = matched(command, args, options);
          if (guards.length === 0) return;
          const where = origin();
          for (const guard of guards) record(guard, status, where);
        } catch {
          /* Never let observation change the observed. */
        }
      };
      try {
        const result = original.call(this, command, args, options);
        observe(0);
        return result;
      } catch (error) {
        observe(
          typeof (/** @type {{status?: unknown}} */ (error).status) === "number"
            ? /** @type {{status: number}} */ (error).status
            : null
        );
        throw error;
      }
    };
  }
}

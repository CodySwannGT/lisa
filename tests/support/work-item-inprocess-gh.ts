/**
 * Answer the controlled `gh` provider in-process for an in-process guard run.
 *
 * A proof case drives `scripts/lisa-work-item.mjs` through `complete`,
 * `finish`, `sweep` or `evidence-release`, and the guard calls the fixture's
 * `gh` dozens of times: one `complete` makes 53 calls. Each call used to start
 * a Node process to run the controlled provider, which was nearly all of a
 * proof case's time; running the guard itself in-process saved almost nothing
 * (measured for CodySwannGT/lisa#4616: 1.76s in-process against 1.80s spawned
 * per `complete`, against 33ms per provider start).
 *
 * So a proof suite mocks `node:child_process` with {@link routeFakeGh}. A
 * `spawnSync` whose program resolves, the way the OS would resolve it, to a
 * fixture's controlled provider (a `gh` beside `work-item-stateful-gh-core.mjs`)
 * is answered by calling that provider's core directly; every other spawn,
 * real `git` included, goes to the real `spawnSync`. The answer has the real
 * result's shape, honouring `encoding`, `input` and `maxBuffer`.
 *
 * What this does NOT exercise is the guard's process boundary to `gh`: argv
 * and environment crossing into a child, and the child's exit status and
 * streams coming back. Every proof suite therefore keeps at least one case on
 * `proofCliSpawned`, where the guard and the provider are both real
 * processes.
 * @module tests/support/work-item-inprocess-gh
 */
import type * as ChildProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { statefulGh } from "./work-item-stateful-gh-core.mjs";

/** The core module installed beside every controlled `gh`. */
const CORE = "work-item-stateful-gh-core.mjs";

/** The controlled provider's executable, as installStatefulProvider copies it. */
const EXECUTABLE = readFileSync(
  path.join(process.cwd(), "tests/support/work-item-stateful-gh.mjs")
);

/** Node's own default `maxBuffer` for `spawnSync`. */
const DEFAULT_MAX_BUFFER = 1024 * 1024;

/** The environment a child would receive. */
type Env = Record<string, string | undefined>;
/** The options `spawnSync` takes. */
type SpawnOptions = ChildProcess.SpawnSyncOptions;

/**
 * Whether a program resolves to a fixture's controlled provider.
 * @param command - Program as the guard named it.
 * @param env - Environment the child would have received.
 * @returns True when the first matching executable is a controlled provider.
 */
function isControlledGh(command: string, env: Env): boolean {
  if (path.basename(command) !== "gh") return false;
  const candidates = command.includes("/")
    ? [command]
    : (env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map(directory => path.join(directory, "gh"));
  const resolved = candidates.find(candidate => existsSync(candidate));
  // The bytes are compared, not just the neighbour: a case that swaps in its
  // own `gh` (a version probe, a failing transport) leaves the core beside
  // it, and must still reach the program it installed.
  return (
    resolved !== undefined &&
    existsSync(path.join(path.dirname(resolved), CORE)) &&
    readFileSync(resolved).equals(EXECUTABLE)
  );
}

/**
 * Run the provider core and shape its answer like `spawnSync`'s.
 * @param command - Program as the guard named it.
 * @param args - Argument vector.
 * @param options - The guard's spawn options.
 * @param env - Environment the child would have received.
 * @returns A `spawnSync`-shaped result.
 */
function answer(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  env: Env
): ChildProcess.SpawnSyncReturns<string | Buffer> {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const exit = { status: 0 };
  const early = (() => {
    try {
      return statefulGh([...args], env, {
        out: bytes => out.push(Buffer.from(bytes)),
        err: text => err.push(Buffer.from(text)),
        fail: code => {
          exit.status = code;
        },
        stdin: () =>
          options.input === undefined
            ? Buffer.alloc(0)
            : Buffer.from(options.input as string | Buffer),
      });
    } catch (error) {
      // An uncaught throw in the executable printed its stack and exited 1.
      err.push(Buffer.from(`${(error as Error).stack ?? String(error)}\n`));
      return 1;
    }
  })();
  const status = early ?? exit.status;
  const encoding = options.encoding;
  const encode = (bytes: Buffer): string | Buffer =>
    encoding && encoding !== "buffer" ? bytes.toString(encoding) : bytes;
  const stdoutBytes = Buffer.concat(out);
  const stderr = encode(Buffer.concat(err));
  const limit = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  if (stdoutBytes.length > limit) {
    // What a real child overrunning maxBuffer produces: killed, no status,
    // an ENOBUFS error, and the output cut at the limit.
    const stdout = encode(stdoutBytes.subarray(0, limit));
    const error = Object.assign(new Error(`spawnSync ${command} ENOBUFS`), {
      code: "ENOBUFS",
      syscall: `spawnSync ${command}`,
      path: command,
      spawnargs: [...args],
    });
    return {
      pid: 0,
      output: [null, stdout, stderr],
      stdout,
      stderr,
      status: null,
      signal: "SIGTERM",
      error,
    };
  }
  const stdout = encode(stdoutBytes);
  return {
    pid: 0,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status,
    signal: null,
  };
}

/**
 * The deadline for a passed-through child whose caller stated none: half the
 * flat 120 s case budget, so the child is killed, and named, first.
 *
 * Fixed rather than `ioLatencyBudgetMs(...)`: that helper measures spawn
 * latency when it loads, through `node:child_process`, and this module IS the
 * `node:child_process` mock, so importing it here deadlocks the mock's own
 * resolution (every suite using it hung until killed).
 */
const PASSTHROUGH_DEADLINE_MS = 60_000;

/**
 * The `node:child_process` module with `spawnSync` routed as described above.
 *
 * Use from a suite as
 * `vi.mock("node:child_process", async original => (await import(...)).routeFakeGh(await original()))`.
 * @param actual - The real module.
 * @returns The module with a routing `spawnSync`.
 */
export function routeFakeGh(actual: typeof ChildProcess): typeof ChildProcess {
  const spawnSync = ((
    command: string,
    argsOrOptions?: readonly string[] | SpawnOptions,
    maybeOptions?: SpawnOptions
  ) => {
    const listed = Array.isArray(argsOrOptions);
    const args: readonly string[] = listed
      ? (argsOrOptions as readonly string[])
      : [];
    const options: SpawnOptions =
      (listed ? maybeOptions : (argsOrOptions as SpawnOptions | undefined)) ??
      {};
    const env = (options.env ?? process.env) as Env;
    // Any other child passes through with the caller's own deadline, or
    // PASSTHROUGH_DEADLINE_MS when the caller stated none (CodySwannGT/lisa#2940).
    if (!isControlledGh(command, env))
      return actual.spawnSync(command, args, {
        ...options,
        timeout: options.timeout ?? PASSTHROUGH_DEADLINE_MS,
      });
    return answer(command, args, options, env);
  }) as typeof actual.spawnSync;
  return { ...actual, spawnSync };
}

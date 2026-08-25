/**
 * Live-process probe used to decide whether a worktree is still in use.
 *
 * This is the module that makes ownership provable rather than guessed. A
 * worktree's path says nothing about who is using it — every agent on this
 * machine parks its checkout under the same handful of roots — so a prefix
 * match would reap a sibling's live work. What DOES distinguish them is whether
 * a running process is sitting inside the directory right now.
 *
 * The probe is deliberately all-or-nothing. When it cannot run — no `lsof`, a
 * timeout, an empty read — it reports `undefined` rather than an empty list,
 * and the caller refuses every candidate. An empty list would mean "nothing is
 * live", which is the false all-clear that turns a cleaner into a shredder.
 * @module cli/worktree-liveness
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Probe wall-clock budget. A machine-wide `lsof` is not instant. */
const PROBE_TIMEOUT_MS = 30_000;

/** Output ceiling for the probe. */
const PROBE_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Fixed absolute `lsof` locations, tried in order.
 *
 * Fixed paths rather than a bare command name so a writeable directory early on
 * `PATH` cannot decide which binary answers a question whose answer authorizes
 * a deletion.
 */
export const LSOF_CANDIDATES: readonly string[] = Object.freeze([
  "/usr/sbin/lsof",
  "/usr/bin/lsof",
  "/bin/lsof",
  "/opt/homebrew/bin/lsof",
]);

/**
 * Machine-wide live working directories, or `undefined` when unknowable.
 *
 * `undefined` is not "none" — it is "not assessed", and every caller treats it
 * as a refusal to proceed.
 */
export type LivenessProbe = () => Promise<readonly string[] | undefined>;

/**
 * Report whether one path is the same as, or inside, another.
 * @param parent - Containing directory
 * @param child - Path being tested
 * @returns True when `child` is `parent` or lives beneath it
 */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * Count live processes whose working directory sits inside a worktree.
 * @param worktree - Absolute worktree path
 * @param workingDirectories - Live working directories from the probe
 * @returns Number of processes holding the worktree open
 */
export function countLiveHolders(
  worktree: string,
  workingDirectories: readonly string[]
): number {
  return workingDirectories.filter(directory => isInside(worktree, directory))
    .length;
}

/**
 * Parse `lsof -F n` output into the working directories it reports.
 * @param stdout - Raw `lsof` field output
 * @returns Absolute directory paths, deduplicated
 */
export function parseLsofWorkingDirectories(stdout: string): readonly string[] {
  return [
    ...new Set(
      stdout
        .split("\n")
        .filter(line => line.startsWith("n/"))
        .map(line => line.slice(1))
    ),
  ];
}

/**
 * Probe the machine for every process working directory.
 *
 * `lsof` exits non-zero whenever any process could not be inspected, which is
 * routine on a multi-user box, so the exit status is deliberately not the
 * signal — the presence of parsed output is. That is the one place where
 * reading a status would produce the wrong answer, and reading the content
 * produces the right one.
 *
 * Candidates are tried one at a time rather than in parallel: a machine-wide
 * `lsof` is a real cost, and four of them to answer one question is three too
 * many on a box already under fleet load.
 * @param index - Candidate to try, for the sequential fallback
 * @returns Live working directories, or undefined when the probe could not run
 */
export async function probeLiveWorkingDirectories(
  index = 0
): Promise<readonly string[] | undefined> {
  const candidate = LSOF_CANDIDATES[index];
  if (candidate === undefined) return undefined;
  const found = await runLsof(candidate);
  return found ?? (await probeLiveWorkingDirectories(index + 1));
}

/**
 * Run one `lsof` candidate and parse its output.
 * @param executable - Absolute `lsof` path to try
 * @returns Parsed working directories, or undefined when this candidate failed
 */
async function runLsof(
  executable: string
): Promise<readonly string[] | undefined> {
  const stdout = await run(executable, ["-a", "-d", "cwd", "-F", "n", "-w"], {
    maxBuffer: PROBE_MAX_BUFFER_BYTES,
    timeout: PROBE_TIMEOUT_MS,
  }).then(
    result => result.stdout,
    (error: unknown) => readPartialStdout(error)
  );
  const directories = parseLsofWorkingDirectories(stdout);
  return directories.length === 0 ? undefined : directories;
}

/**
 * Recover stdout from a failed `execFile` rejection.
 *
 * A timed-out child returns EMPTY streams, so this yields `""` and the caller
 * treats the probe as unavailable rather than as a clean machine.
 * @param error - Rejection from `execFile`
 * @returns Whatever stdout the child produced before failing
 */
function readPartialStdout(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    typeof (error as { stdout?: unknown }).stdout === "string"
    ? (error as { stdout: string }).stdout
    : "";
}

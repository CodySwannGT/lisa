/**
 * A two-channel world for exercising the guard dedupe library.
 *
 * Lisa reaches an agent through two independent channels — the repository
 * dispatcher and the plugin manifest — and this builds a disposable copy of
 * that shape: one state directory, one transcript, one evaluation log, and a
 * probe guard installed per channel beside its own copy of the library
 * (CodySwannGT/lisa#3814).
 *
 * Extracted from the suite rather than invented for it, so that the cases
 * about dedupe behaviour and the cases about `stat` portability drive exactly
 * the same harness instead of two that can drift apart.
 * @module tests/unit/hooks/support/guard-dedupe-world
 */
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The library under test, in the tree the ports are generated from. */
const LIBRARY = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "guard-dedupe.bash"
);

/** The library, as every channel names it beside its own guard. */
const LIBRARY_NAME = "guard-dedupe.bash";

/** Label the bounded spawn reports the probe under. */
const PROBE_LABEL = "guard-dedupe probe";

/** Claude's refusal code. */
export const BLOCKED = 2;

/** Channel names, which double as the identity each copy logs. */
export const DISPATCHER = "dispatcher";
export const PLUGIN = "plugin";

/** A command no guard has an opinion about. */
export const HARMLESS = "ls -la";

/** The bypass a guard exists to refuse. */
export const BYPASS = "git commit --no-verify";

/** One channel's copy of a guard, and the identity it logs when it evaluates. */
export interface Channel {
  readonly name: string;
  readonly script: string;
}

/** A whole two-channel world: state, transcript, log, and the guard copies. */
export interface World {
  readonly root: string;
  readonly memoDir: string;
  readonly transcript: string;
  readonly log: string;
  /**
   * Prepended to `PATH` for every guard this world runs.
   *
   * Empty unless a case installs something into it, which is what lets one
   * case choose the `stat` the library resolves without changing how any other
   * case is invoked.
   */
  readonly binDir: string;
}

const temporaries: string[] = [];

/** Remove every world built since the last call. Install this in `afterEach`. */
export function cleanupWorlds(): void {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A guard that logs every evaluation and then returns a fixed verdict.
 *
 * Deliberately a stand-in rather than one of the eight real guards: what is
 * under test is the dedupe contract, and a probe makes "did the body run" an
 * observation instead of an inference from timing. The preamble is copied
 * verbatim from what the real guards carry.
 * @param verdict - Status the guard body exits with
 * @param marker - Text that makes one channel's bytes differ from another's
 * @returns The script source
 */
function probeSource(verdict: number, marker: string): string {
  return `#!/usr/bin/env bash
# ${marker}
set -euo pipefail

input="$(cat)"

lisa_guard_hook_dir="\${BASH_SOURCE[0]%/*}"
lisa_guard_dedupe_lib="$lisa_guard_hook_dir/guard-dedupe.bash"
if [ -r "$lisa_guard_dedupe_lib" ]; then
  . "$lisa_guard_dedupe_lib"
  trap 'lisa_guard_dedupe_record $?' EXIT
  lisa_guard_dedupe probe "$input"
fi

printf '%s\\n' "$LISA_PROBE_CHANNEL" >>"$LISA_PROBE_LOG"
exit ${verdict}
`;
}

/**
 * Build a world with the state directory, transcript, and evaluation log.
 * @returns The world
 */
export function makeWorld(): World {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-dedupe-"));
  const memoDir = path.join(root, "memo");
  const transcript = path.join(root, "transcript.jsonl");
  const log = path.join(root, "evaluations.log");
  const binDir = path.join(root, "bin");

  temporaries.push(root);
  mkdirSync(memoDir, { mode: 0o700 });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(transcript, "turn\n");
  writeFileSync(log, "");
  return { root, memoDir, transcript, log, binDir };
}

/**
 * Install one channel's copy of the probe guard beside its own library copy.
 *
 * A separate directory per channel because that is what makes two
 * registrations two channels: the dispatcher serves a repository or applied
 * tree, the plugin manifest serves a cache under the agent's config.
 * @param world - The world to install into
 * @param name - Channel name, also the directory name
 * @param verdict - Status the probe exits with
 * @param marker - Text that makes this copy's bytes differ, or the shared one
 * @returns The installed channel
 */
export function installChannel(
  world: World,
  name: string,
  verdict = 0,
  marker = "shared"
): Channel {
  const dir = path.join(world.root, name);
  const script = path.join(dir, "probe.sh");

  mkdirSync(dir, { recursive: true });
  copyFileSync(LIBRARY, path.join(dir, LIBRARY_NAME));
  writeFileSync(script, probeSource(verdict, marker));
  chmodSync(script, 0o755);
  return { name, script };
}

/**
 * The environment one channel's guard runs under.
 * @param world - The world the run happens in
 * @param channel - The channel serving the guard
 * @returns Environment for the probe, with this world's `bin` first on PATH
 */
export function probeEnv(
  world: World,
  channel: Channel
): Record<string, string | undefined> {
  return {
    ...process.env,
    LISA_GUARD_MEMO_DIR: world.memoDir,
    LISA_PROBE_CHANNEL: channel.name,
    LISA_PROBE_LOG: world.log,
    PATH: `${world.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

/**
 * Run one channel's guard against a payload built for it.
 * @param world - The world the run happens in
 * @param channel - The channel serving the guard
 * @param payload - The raw hook payload to hand the guard on stdin
 * @param env - Environment override, for cases that add or drop a variable
 * @returns The guard's exit status
 */
export function runPayload(
  world: World,
  channel: Channel,
  payload: string,
  env: Record<string, string | undefined> = probeEnv(world, channel)
): number | null {
  return boundedSpawnSync({
    label: PROBE_LABEL,
    command: BASH,
    args: [channel.script],
    input: payload,
    cwd: world.root,
    env,
  }).status;
}

/**
 * Run one channel's guard against a Bash command in a session.
 * @param world - The world the run happens in
 * @param channel - The channel serving the guard
 * @param command - The Bash command the payload proposes
 * @param sessionId - Session the payload belongs to
 * @returns The guard's exit status
 */
export function run(
  world: World,
  channel: Channel,
  command: string,
  sessionId = "session-a"
): number | null {
  return runPayload(
    world,
    channel,
    JSON.stringify({
      session_id: sessionId,
      transcript_path: world.transcript,
      tool_name: "Bash",
      tool_input: { command },
    })
  );
}

/**
 * Every evaluation logged so far, and clear the log.
 * @param world - The world to read
 * @returns Channel names, in the order they evaluated
 */
export function drainEvaluations(world: World): string[] {
  const lines = readFileSync(world.log, "utf-8").split("\n").filter(Boolean);

  writeFileSync(world.log, "");
  return lines;
}

/**
 * Advance the transcript, which is what makes the next call a different one.
 * @param world - The world to advance
 */
export function nextToolCall(world: World): void {
  appendFileSync(world.transcript, "another turn\n");
}

/**
 * A guard registered on both channels is evaluated once per tool call.
 *
 * Lisa reaches an agent through two independent channels — the repository
 * dispatcher and the plugin manifest — and where both are live every matched
 * tool call ran each guard twice. The verdicts agreed, because the guards are
 * idempotent, so what doubled was the cost (CodySwannGT/lisa#3814).
 *
 * The claim carried here is a COUNT, not a latency. Timings on a contended
 * machine are an upper bound on something else; "evaluated twice" versus
 * "evaluated once" is exact, reproducible, and it is what the fix changes.
 *
 * The three cases that must NOT dedupe are the point of this file, and each is
 * a rejection control for the obvious wrong fix (delete one registration):
 *
 *   - one channel only, which is the host the dispatcher exists for. It must go
 *     on evaluating on every call, forever.
 *   - two channels at DIFFERENT vintages, where the agent is meant to see the
 *     union of both verdicts and the older copy must not answer for the newer.
 *   - a REFUSAL, which is never memoised and never replayed.
 * @module tests/unit/hooks/guard-dedupe
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

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The library under test, in the tree the ports are generated from. */
const LIBRARY = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "guard-dedupe.bash"
);

/** Claude's refusal code. */
const BLOCKED = 2;

/** The library, as every channel names it beside its own guard. */
const LIBRARY_NAME = "guard-dedupe.bash";

/** Label the bounded spawn reports the probe under. */
const PROBE_LABEL = "guard-dedupe probe";

/** Channel names, which double as the identity each copy logs. */
const DISPATCHER = "dispatcher";
const PLUGIN = "plugin";

/** A command no guard has an opinion about. */
const HARMLESS = "ls -la";

/** The bypass a guard exists to refuse. */
const BYPASS = "git commit --no-verify";

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** One channel's copy of a guard, and the identity it logs when it evaluates. */
interface Channel {
  readonly name: string;
  readonly script: string;
}

/** A whole two-channel world: state, transcript, log, and the guard copies. */
interface World {
  readonly root: string;
  readonly memoDir: string;
  readonly transcript: string;
  readonly log: string;
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
function makeWorld(): World {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-dedupe-"));
  const memoDir = path.join(root, "memo");
  const transcript = path.join(root, "transcript.jsonl");
  const log = path.join(root, "evaluations.log");

  temporaries.push(root);
  mkdirSync(memoDir, { mode: 0o700 });
  writeFileSync(transcript, "turn\n");
  writeFileSync(log, "");
  return { root, memoDir, transcript, log };
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
function installChannel(
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
 * Run one channel's guard against a payload.
 * @param world - The world the run happens in
 * @param channel - The channel serving the guard
 * @param command - The Bash command the payload proposes
 * @param sessionId - Session the payload belongs to
 * @returns The guard's exit status
 */
function run(
  world: World,
  channel: Channel,
  command: string,
  sessionId = "session-a"
): number | null {
  const result = boundedSpawnSync({
    label: PROBE_LABEL,
    command: BASH,
    args: [channel.script],
    input: JSON.stringify({
      session_id: sessionId,
      transcript_path: world.transcript,
      tool_name: "Bash",
      tool_input: { command },
    }),
    cwd: world.root,
    env: {
      ...process.env,
      LISA_GUARD_MEMO_DIR: world.memoDir,
      LISA_PROBE_CHANNEL: channel.name,
      LISA_PROBE_LOG: world.log,
    },
  });

  return result.status;
}

/**
 * Every evaluation logged so far, and clear the log.
 * @param world - The world to read
 * @returns Channel names, in the order they evaluated
 */
function drainEvaluations(world: World): string[] {
  const lines = readFileSync(world.log, "utf-8").split("\n").filter(Boolean);

  writeFileSync(world.log, "");
  return lines;
}

/**
 * Advance the transcript, which is what makes the next call a different one.
 * @param world - The world to advance
 */
function nextToolCall(world: World): void {
  appendFileSync(world.transcript, "another turn\n");
}

describe("a guard registered on both channels", () => {
  it("evaluates once per tool call once both channels are known", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    // The first call is where each copy learns the other exists, so both
    // evaluate. That warm-up is not a defect to hide: a memo may only ever be
    // trusted on evidence that a second channel actually ran, and on the first
    // call there is none.
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);

    nextToolCall(world);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);

    // The count that carries the fix: two registrations, one evaluation.
    expect(drainEvaluations(world)).toEqual([DISPATCHER]);
  });

  it("returns the same verdict the second evaluation would have", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    expect(run(world, dispatcher, HARMLESS)).toBe(0);
    // Skipped, and still an allow — the replayed verdict is the one the
    // evaluation it replaced had just produced.
    expect(run(world, plugin, HARMLESS)).toBe(0);
    expect(drainEvaluations(world)).toEqual([DISPATCHER]);
  });

  it("evaluates again when the payload changes", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, "git status");
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });

  it("evaluates again on the next tool call with the same command", () => {
    // The memo is scoped to one call, not to one command. A guard classifies
    // against a working tree that changes underneath it, so replaying an
    // earlier allow for a command reissued later would answer with a verdict
    // the repository has already invalidated.
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    drainEvaluations(world);

    nextToolCall(world);
    run(world, dispatcher, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER]);
  });

  it("evaluates in both sessions, because state is session-scoped", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS, "session-a");
    run(world, plugin, HARMLESS, "session-a");
    nextToolCall(world);
    drainEvaluations(world);

    run(world, dispatcher, HARMLESS, "session-b");
    run(world, plugin, HARMLESS, "session-b");
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });
});

describe("what the memo refuses to deduplicate", () => {
  it("keeps evaluating on a host that has only one channel", () => {
    // THE REJECTION CONTROL. Deduplicating by deleting the fallback passes
    // every case above and silently unprotects exactly this host — the one the
    // dispatcher was built for, where the plugin never installed.
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);

    for (let call = 0; call < 4; call += 1) {
      run(world, dispatcher, HARMLESS);
      nextToolCall(world);
    }

    expect(drainEvaluations(world)).toEqual([
      DISPATCHER,
      DISPATCHER,
      DISPATCHER,
      DISPATCHER,
    ]);
  });

  it("evaluates both copies when the two channels are different vintages", () => {
    // The agent is meant to see the UNION of two vintages' verdicts, so a
    // tightening on either channel takes effect at once. Letting the older copy
    // answer for the newer one would make a shipped guard fix inert.
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER, 0, "lisa 4.40.0");
    const plugin = installChannel(world, PLUGIN, 0, "lisa 4.49.0");

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });

  it("never memoises a refusal", () => {
    // Refusals are the rare path, so deduplicating them buys nothing
    // measurable, and it would buy the one hazard worth avoiding: a replayed
    // block whose message never reached the agent.
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER, BLOCKED);
    const plugin = installChannel(world, PLUGIN, BLOCKED);

    run(world, dispatcher, BYPASS);
    run(world, plugin, BYPASS);
    nextToolCall(world);
    drainEvaluations(world);

    expect(run(world, dispatcher, BYPASS)).toBe(BLOCKED);
    expect(run(world, plugin, BYPASS)).toBe(BLOCKED);
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });

  it("evaluates when the payload carries no session to scope state to", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);
    const payload = JSON.stringify({
      transcript_path: world.transcript,
      tool_name: "Bash",
      tool_input: { command: HARMLESS },
    });

    for (const channel of [dispatcher, plugin, dispatcher, plugin]) {
      boundedSpawnSync({
        label: PROBE_LABEL,
        command: BASH,
        args: [channel.script],
        input: payload,
        cwd: world.root,
        env: {
          ...process.env,
          LISA_GUARD_MEMO_DIR: world.memoDir,
          LISA_PROBE_CHANNEL: channel.name,
          LISA_PROBE_LOG: world.log,
        },
      });
    }

    expect(drainEvaluations(world)).toHaveLength(4);
  });

  it("evaluates when the operator switches the memo off", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    for (const channel of [dispatcher, plugin]) {
      boundedSpawnSync({
        label: PROBE_LABEL,
        command: BASH,
        args: [channel.script],
        input: JSON.stringify({
          session_id: "session-a",
          transcript_path: world.transcript,
          tool_name: "Bash",
          tool_input: { command: HARMLESS },
        }),
        cwd: world.root,
        env: {
          ...process.env,
          LISA_GUARD_MEMO_DIR: world.memoDir,
          LISA_GUARD_DEDUPE_DISABLE: "1",
          LISA_PROBE_CHANNEL: channel.name,
          LISA_PROBE_LOG: world.log,
        },
      });
    }

    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });
});

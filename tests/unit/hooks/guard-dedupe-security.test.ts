/**
 * Memo replay must prove private state and every byte of verdict code.
 * @module tests/unit/hooks/guard-dedupe-security
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  DISPATCHER,
  PLUGIN,
  HARMLESS,
  cleanupWorlds,
  drainEvaluations,
  installChannel,
  makeWorld,
  nextToolCall,
  probeEnv,
  run,
  runPayload,
  type Channel,
  type World,
} from "./support/guard-dedupe-world.js";

afterEach(cleanupWorlds);

/**
 * Exercise the exported path or direct plugin fallback beneath this temp root.
 * @param world - Private disposable test state
 * @param channel - Guard copy to execute
 * @param exported - Whether the dispatcher exports the memo directory
 */
function runWithTemp(world: World, channel: Channel, exported: boolean): void {
  expect(
    runPayload(
      world,
      channel,
      JSON.stringify({
        session_id: "session-a",
        transcript_path: world.transcript,
        tool_input: { command: HARMLESS },
      }),
      {
        ...probeEnv(world, channel),
        TMPDIR: world.memoDir,
        LISA_GUARD_MEMO_DIR: exported ? world.memoDir : undefined,
      }
    )
  ).toBe(0);
}

/**
 * Keep wrapper bytes equal while giving its delegated verdict its own source.
 * @param world - Private disposable test state
 * @param name - Channel name
 * @param verdict - Delegate exit code
 * @returns Guard copy with its own delegated verdict
 */
function installDelegate(world: World, name: string, verdict: number): Channel {
  const channel = installChannel(world, name);
  const script = readFileSync(channel.script, "utf-8")
    .replace(
      'lisa_guard_dedupe probe "$input"',
      'lisa_guard_dedupe probe "$input" "$lisa_guard_hook_dir/verdict.sh"'
    )
    .replace("exit 0", 'bash "$lisa_guard_hook_dir/verdict.sh"');
  writeFileSync(channel.script, script);
  writeFileSync(
    path.join(path.dirname(channel.script), "verdict.sh"),
    `exit ${verdict}\n`
  );
  return channel;
}

describe("memo directory trust", () => {
  it.each([0o770, 0o777, 0o1777])("rejects writable memo leaves (%o)", mode => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);
    chmodSync(world.memoDir, mode);
    // The fallback must be insecure too; otherwise rejecting the supplied
    // directory can legitimately select a different, trusted memo store.
    const fallback = path.join(
      world.memoDir,
      `lisa-guard-memo-${userInfo().uid}`
    );
    mkdirSync(fallback);
    chmodSync(fallback, mode);
    for (const exported of [true, false]) {
      runWithTemp(world, dispatcher, exported);
      runWithTemp(world, plugin, exported);
      nextToolCall(world);
      drainEvaluations(world);
      runWithTemp(world, dispatcher, exported);
      runWithTemp(world, plugin, exported);
      expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
    }
  });

  it("rejects a private memo below a non-sticky writable ancestor", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);
    chmodSync(world.root, 0o777);
    for (let call = 0; call < 2; call += 1) {
      runWithTemp(world, dispatcher, true);
      runWithTemp(world, plugin, true);
      expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
      nextToolCall(world);
    }
  });

  it("rejects an insecure existing session inside a private memo base", () => {
    const world = makeWorld();
    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);
    const session = path.join(world.memoDir, "session-a");
    mkdirSync(session);
    chmodSync(session, 0o777);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });
});

describe("complete verdict source identity", () => {
  it.each([0, 2])(
    "the real worktree wrapper hashes its classifier (verdict %i)",
    verdict => {
      const world = makeWorld();
      const dispatcher = installChannel(world, DISPATCHER);
      const plugin = installChannel(world, PLUGIN);
      const wrapper = readFileSync(
        path.resolve("plugins/src/base/hooks/worktree-binding-guard.sh"),
        "utf-8"
      );
      for (const channel of [dispatcher, plugin]) {
        writeFileSync(channel.script, wrapper);
        writeFileSync(
          path.join(path.dirname(channel.script), "worktree-binding-guard.mjs"),
          `import { appendFileSync } from "node:fs";
appendFileSync(process.env.LISA_PROBE_LOG, process.env.LISA_PROBE_CHANNEL + "\\n");
process.exit(${channel === dispatcher ? 0 : verdict});
`
        );
      }
      run(world, dispatcher, HARMLESS);
      run(world, plugin, HARMLESS);
      nextToolCall(world);
      drainEvaluations(world);
      expect(run(world, dispatcher, HARMLESS)).toBe(0);
      expect(run(world, plugin, HARMLESS)).toBe(verdict);
      expect(drainEvaluations(world)).toEqual(
        verdict === 0 ? [DISPATCHER] : [DISPATCHER, PLUGIN]
      );
    }
  );

  it("does not let an allowing delegate suppress a different refusing delegate", () => {
    const world = makeWorld();
    const dispatcher = installDelegate(world, DISPATCHER, 0);
    const plugin = installDelegate(world, PLUGIN, 2);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);
    expect(run(world, dispatcher, HARMLESS)).toBe(0);
    expect(run(world, plugin, HARMLESS)).toBe(2);
    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });

  it("still deduplicates byte-identical delegated code", () => {
    const world = makeWorld();
    const dispatcher = installDelegate(world, DISPATCHER, 0);
    const plugin = installDelegate(world, PLUGIN, 0);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);
    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER]);
  });

  it.each(["probe.sh", "guard-dedupe.bash", "verdict.sh"])(
    "evaluates both channels when reading %s fails",
    unreadable => {
      const world = makeWorld();
      const dispatcher = installDelegate(world, DISPATCHER, 0);
      const plugin = installDelegate(world, PLUGIN, 0);
      // Fault only the digest reread, after the interpreter has loaded code.
      // cat's stdin path still works, as do the shell's delegate reads.
      const cat = path.join(world.binDir, "cat");
      writeFileSync(
        cat,
        `#!/usr/bin/env bash
for source_file in "$@"; do
  case "$source_file" in */${unreadable}) exit 1 ;; esac
done
exec /bin/cat "$@"
`
      );
      chmodSync(cat, 0o755);
      run(world, dispatcher, HARMLESS);
      run(world, plugin, HARMLESS);
      nextToolCall(world);
      drainEvaluations(world);
      expect(run(world, dispatcher, HARMLESS)).toBe(0);
      expect(run(world, plugin, HARMLESS)).toBe(0);
      expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
    }
  );
});

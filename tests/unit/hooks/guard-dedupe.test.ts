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
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BLOCKED,
  BYPASS,
  DISPATCHER,
  HARMLESS,
  PLUGIN,
  cleanupWorlds,
  drainEvaluations,
  installChannel,
  makeWorld,
  nextToolCall,
  probeEnv,
  run,
  runPayload,
} from "./support/guard-dedupe-world.js";
import {
  installAbsentStatShim,
  installGnuStatShim,
} from "./support/gnu-stat-shim.js";

afterEach(cleanupWorlds);

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

  it("deduplicates where `stat` spells the transcript size the other way", () => {
    // The platform arm the macOS spelling was written for. Read through a
    // command that FAILS, the discriminator carried the machine's free-space
    // figure instead of the transcript's size, so no two channels ever agreed
    // and the memo never hit on any Linux host — with every rejection control
    // below still green, because each of those asserts a miss.
    const world = makeWorld();

    installGnuStatShim(world.binDir, path.join(world.root, "stat-calls"));

    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    expect(drainEvaluations(world)).toEqual([DISPATCHER]);
  });

  it("refuses to memoise when no `stat` can size the transcript", () => {
    // Condition 2 — NO DISCRIMINATOR MEANS NO MEMO — on a host carrying
    // neither spelling. Green before this repair as well as after, and kept
    // for what it now holds down rather than for what it caught: the old
    // spelling got this right only as a side effect of `pipefail`, because the
    // last command in the digest pipeline happened to be the failing `stat`.
    // The repaired code reads the size BEFORE the pipeline, so nothing fails
    // inside it and that accident is gone. Drop the digit check that replaced
    // it and the key silently becomes payload-only, which is a memo a command
    // reissued later in the session can replay against a tree that has since
    // changed.
    const world = makeWorld();

    installAbsentStatShim(world.binDir);

    const dispatcher = installChannel(world, DISPATCHER);
    const plugin = installChannel(world, PLUGIN);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
    nextToolCall(world);
    drainEvaluations(world);

    run(world, dispatcher, HARMLESS);
    run(world, plugin, HARMLESS);
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
      runPayload(world, channel, payload);
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
      runPayload(
        world,
        channel,
        JSON.stringify({
          session_id: "session-a",
          transcript_path: world.transcript,
          tool_name: "Bash",
          tool_input: { command: HARMLESS },
        }),
        { ...probeEnv(world, channel), LISA_GUARD_DEDUPE_DISABLE: "1" }
      );
    }

    expect(drainEvaluations(world)).toEqual([DISPATCHER, PLUGIN]);
  });
});

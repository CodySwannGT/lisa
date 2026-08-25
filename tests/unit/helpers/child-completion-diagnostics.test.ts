/**
 * Tests for the diagnostic that says WHY a child did not run to completion.
 *
 * Split out of `io-latency-budget.test.ts` on size, and the seam is a real one:
 * everything here is about the shape of a failed child, none of it about the
 * budget's arithmetic.
 *
 * The distinctions under test are the whole product. `EPIPE` from a child that
 * exited on its own, `EPIPE` from a command that never existed, and a timeout
 * kill all arrive at the same function, and each has a different cause, a
 * different remedy, and — for the first — a caller who may legitimately want it
 * tolerated so a deliberately-broken control can still report its verdict
 * (CodySwannGT/lisa#2949, CodySwannGT/lisa#3020, CodySwannGT/lisa#3122).
 * @module tests/unit/helpers/child-completion-diagnostics
 */
import { describe, expect, it } from "vitest";
import type { ChildOutcome } from "../../helpers/io-latency-budget.js";
import {
  assertChildCompleted,
  boundedSpawnSync,
  workerSpawnSlowdown,
} from "../../helpers/io-latency-budget.js";

/** The declaration a caller makes about a child that exits before reading. */
const MAY_EXIT_EARLY = "child-may-exit-before-reading";

/**
 * The outcome `spawnSync` returns when the child closed stdin mid-write.
 *
 * Recorded verbatim from a real invocation of a hook that exits before reading
 * its stdin, with a payload larger than the pipe buffer:
 * `{ message: "spawnSync /bin/bash EPIPE", code: "EPIPE", errno: -32,
 *    syscall: "spawnSync /bin/bash", status: 0, signal: null }`.
 *
 * `status: 0` is not a transcription error. The child exited cleanly and
 * reported nothing wrong; the only casualty is the parent's write. That
 * asymmetry is precisely why the failure was read as a hang.
 * @returns A ChildOutcome shaped as the runtime really reports EPIPE.
 */
function epipeOutcome(): ChildOutcome {
  return {
    error: Object.assign(new Error("spawnSync /bin/bash EPIPE"), {
      code: "EPIPE",
      errno: -32,
    }),
    signal: null,
    status: 0,
  };
}

/**
 * The outcome `spawnSync` returns when the command handed to the shell is gone.
 *
 * Same errno, opposite cause: `/bin/bash /path/that/is/not/there` prints
 * "No such file or directory" and exits 127 without reading a byte, so a
 * parent still writing its payload can lose the race and see EPIPE. The status
 * is the only field that separates this from {@link epipeOutcome}.
 * @returns A ChildOutcome for an EPIPE against a command that never existed.
 */
function commandNotFoundEpipeOutcome(): ChildOutcome {
  return {
    error: Object.assign(new Error("spawnSync /bin/bash EPIPE"), {
      code: "EPIPE",
      errno: -32,
    }),
    signal: null,
    status: 127,
  };
}

describe("assertChildCompleted", () => {
  it("accepts a child that exited on its own", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: null }, "packer")
    ).not.toThrow();
  });

  it("names the command and the kill signal instead of an empty stdout", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: "SIGTERM" }, "packer")
    ).toThrow(/packer did not complete: killed by signal SIGTERM/u);
  });

  it("surfaces the runtime error when one is reported", () => {
    expect(() =>
      assertChildCompleted(
        { error: new Error("spawnSync ETIMEDOUT"), signal: null },
        "compiler"
      )
    ).toThrow(/compiler did not complete: spawnSync ETIMEDOUT/u);
  });

  it("reports the measured slowdown so the reader can rule out variance", () => {
    expect(() =>
      assertChildCompleted({ error: undefined, signal: "SIGKILL" }, "packer")
    ).toThrow(new RegExp(`${workerSpawnSlowdown().toFixed(2)}x`, "u"));
  });

  it("names an I/O error on the pipe when the write to stdin failed", () => {
    // EPIPE is not a time event, and reporting it as one sent two readers of
    // CodySwannGT/lisa#2949 hunting a timeout that was never there. One
    // instance printed the hang sentence while reporting a measured 1.16x
    // slowdown — self-contradictory on its face.
    expect(() => assertChildCompleted(epipeOutcome(), "hook")).toThrow(
      /hook did not complete: I\/O error on the pipe/u
    );
  });

  it("does not blame a hang or a slow machine for an I/O error", () => {
    expect(() => assertChildCompleted(epipeOutcome(), "hook")).not.toThrow(
      /hang|slow(er)? (machine|box)|ordinary variance/u
    );
  });

  it("reports the exit status, which is what proves the child was fine", () => {
    // The child exits 0. The failure is entirely on the writing side, and that
    // asymmetry is the fastest way for a reader to rule out the child.
    expect(() => assertChildCompleted(epipeOutcome(), "hook")).toThrow(
      /exited with status 0/u
    );
  });

  it("names an absent command when the pipe error came with exit 127", () => {
    // `bash <missing file>` exits 127 having read nothing, so the parent's
    // write can EPIPE against a child that never existed. Reporting that with
    // the status-0 text asserts the child "was fine" about a child that was
    // never there (CodySwannGT/lisa#3020).
    expect(() =>
      assertChildCompleted(commandNotFoundEpipeOutcome(), "hook")
    ).toThrow(/DOES NOT EXIST/u);
  });

  it("does not claim load is irrelevant when the command was absent", () => {
    // The #2949 sentence — "The budget, the load on the machine and a re-run
    // have nothing to do with it" — is false here: whether the write wins the
    // race against an immediate exit is exactly a function of machine load.
    expect(() =>
      assertChildCompleted(commandNotFoundEpipeOutcome(), "hook")
    ).not.toThrow(/NOT a time event|have nothing to do with it/u);
  });

  it("keeps the exited-first diagnosis for a child that really did exit", () => {
    // The two EPIPE causes must stay apart in both directions.
    expect(() => assertChildCompleted(epipeOutcome(), "hook")).not.toThrow(
      /DOES NOT EXIST/u
    );
  });

  it("still reports a killed child as a kill, not as an I/O error", () => {
    // The two branches must stay apart in both directions: a timeout kill that
    // started reporting itself as a pipe error would be the same defect with
    // the arguments swapped.
    expect(() =>
      assertChildCompleted(
        { error: undefined, signal: "SIGKILL", status: null },
        "packer"
      )
    ).not.toThrow(/I\/O error on the pipe/u);
  });
});

/**
 * The outcome a deliberately-broken control returns when it loses the race.
 *
 * Recorded from the shipped `parity-safety-net.sh` run under `/bin/sh` on
 * Linux, where `sh` is `dash`: it dies on `set -o pipefail` at line 84, nine
 * lines before its own `input="$(cat)"`, so it exits 2 having read nothing and
 * the parent's write lands on a closed read end. Status 2 IS the verdict the
 * discrimination control came for, which is why erasing it with a hard error
 * left that control measuring nothing (CodySwannGT/lisa#3122).
 * @returns A ChildOutcome for an EPIPE against a child that refused, then left.
 */
function refusedThenExitedEpipeOutcome(): ChildOutcome {
  return {
    error: Object.assign(new Error("spawnSync /bin/sh EPIPE"), {
      code: "EPIPE",
      errno: -32,
    }),
    signal: null,
    status: 2,
  };
}

describe("a declared early exit still reports its verdict", () => {
  it("returns instead of throwing when the caller declared the early exit", () => {
    // The acceptance criterion in the plainest form available: a control whose
    // child is SUPPOSED to exit before reading must come back with a verdict,
    // not with an error about the parent's write.
    expect(() =>
      assertChildCompleted(
        refusedThenExitedEpipeOutcome(),
        "parity-safety-net.sh under /bin/sh",
        MAY_EXIT_EARLY
      )
    ).not.toThrow();
  });

  it("hands the child's exit status back through boundedSpawnSync", () => {
    // End to end through the spec field, because the helper's tolerance is
    // worth nothing if `boundedSpawnSync` does not carry the declaration down
    // to it — the seam where the two halves of CodySwannGT/lisa#2822 were
    // previously left for the caller to pair by hand.
    const outcome = boundedSpawnSync({
      label: "a control that exits before reading",
      command: process.execPath,
      args: ["-e", "process.exit(2)"],
      input: "x".repeat(2_000_000),
      childMayExitBeforeReading: true,
    });

    expect(outcome.status).toBe(2);
  });

  it("still fails an undeclared EPIPE, naming the child", () => {
    // The negative control. Tolerance is a claim about one child, never a
    // blanket: a caller that did not declare an early exit must still be told,
    // and must be told WHICH child, or the fix would be a worse defect than
    // the one it replaced.
    expect(() =>
      assertChildCompleted(refusedThenExitedEpipeOutcome(), "hook")
    ).toThrow(/^hook did not complete: I\/O error on the pipe/u);
  });

  it("still names an absent command even when an early exit was declared", () => {
    // 127 is a shell reporting that there was never a child at all. A
    // declaration cannot make that acceptable, because the case would then be
    // measuring a script that does not exist (CodySwannGT/lisa#3020).
    expect(() =>
      assertChildCompleted(
        commandNotFoundEpipeOutcome(),
        "hook",
        MAY_EXIT_EARLY
      )
    ).toThrow(/DOES NOT EXIST/u);
  });

  it("still reports a kill as a kill even when an early exit was declared", () => {
    // A child that was killed did not exit early of its own accord, so the
    // declaration does not describe it. Tolerating this would hide the very
    // hang the budget exists to surface.
    expect(() =>
      assertChildCompleted(
        { error: undefined, signal: "SIGKILL", status: null },
        "packer",
        MAY_EXIT_EARLY
      )
    ).toThrow(/killed by signal SIGKILL/u);
  });
});

describe("the pipe diagnostic describes the failure in front of it", () => {
  it("does not claim load and a re-run are irrelevant to an early exit", () => {
    // The text was written for CodySwannGT/lisa#2949 and inherited here, where
    // it is false: measured on one core with a 72-byte payload, the same spawn
    // gave 0 EPIPE in 300 at rest and 31 in 300 under 16 CPU hogs. Telling the
    // next reader that load has nothing to do with it rules out the one
    // explanation the evidence supports (CodySwannGT/lisa#3122).
    expect(() =>
      assertChildCompleted(refusedThenExitedEpipeOutcome(), "hook")
    ).not.toThrow(/NOT a time event|have nothing to do with it/u);
  });

  it("does not prescribe draining stdin, which a control cannot do", () => {
    // "Fix the child so every exit path consumes stdin first" is inapplicable
    // when the child is a deliberately-broken control: draining stdin destroys
    // exactly what the case measures.
    expect(() =>
      assertChildCompleted(refusedThenExitedEpipeOutcome(), "hook")
    ).not.toThrow(/every exit path consumes stdin/u);
  });

  it("names the declaration a deliberate early exit needs", () => {
    // A diagnostic that removes the wrong remedy has to supply the right one,
    // or the next reader is left with a failure and no move.
    expect(() =>
      assertChildCompleted(refusedThenExitedEpipeOutcome(), "hook")
    ).toThrow(/childMayExitBeforeReading/u);
  });

  it("keeps naming the exit status, which is the verdict on that path", () => {
    expect(() =>
      assertChildCompleted(refusedThenExitedEpipeOutcome(), "hook")
    ).toThrow(/exited with status 2/u);
  });
});

/**
 * Bite test: a failing gate must say WHICH failure it was.
 *
 * The defect under test is not the flake — it is that the gate reported
 * `coverage-adequacy — bun run test:cov (exit 1)` for two facts that are
 * opposites. Six sightings across three agents and three surfaces were all
 * subprocess-heavy tests hitting their wall-clock budget under load, and not
 * one was a coverage number below threshold; every one of them rendered as the
 * sentence a real coverage regression would also render as. So the regression
 * was already invisible, and re-running was the rational response to both.
 *
 * These cases run the REAL runner as a real process against a real failing
 * command, because the trap being avoided is a shell one: the exit code has to
 * come from the gate command and never from the `tee` that records its output.
 * A stubbed executor cannot fail that way, so it cannot prove it was avoided.
 * @module tests/integration/gate-failure-vocabulary-bite
 */

import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { type GateRun, sink } from "../unit/scripts/lisa-run-gates-fixtures.js";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/** The gate this issue was filed against, and the one it misreported. */
const COVERAGE_GATE = "coverage-adequacy";

/** The runner's own headline for a required gate it measured and found wanting. */
const GATE_FAILED = "required gate FAILED";

/**
 * The runner's headline for a required gate whose command never answered.
 *
 * A separate string from `GATE_FAILED` because they are separate facts
 * (CodySwannGT/lisa#3032). #2813 gave a kill its own prose and left it under
 * the FAILED token, so the sentence and the vocabulary disagreed; #3032 is the
 * issue that moved the token, and these cases move with it.
 */
const GATE_KILLED = "required gate NOT PROVED — KILLED";

/**
 * A push moment where exactly one gate runs `gate.sh` and the rest are off.
 *
 * The other floor properties are declared `off` rather than omitted: silence
 * makes the runner hand the moment back to the built-in hook steps, which
 * would run nothing here and prove nothing about the report.
 */
const CONFIG = JSON.stringify({
  gates: {
    runner: "sh",
    [COVERAGE_GATE]: { push: { level: "required", run: "gate.sh" } },
    "dependency-vulnerability": { push: "off" },
    "test-correctness": { push: "off" },
    "test-integration": { push: "off" },
    traceability: { push: "off" },
    "type-correctness": { push: "off" },
  },
});

/**
 * Run the real gate runner over a gate command that prints `output` and fails.
 * @param output What the gate command writes to stdout before it ends.
 * @param ending How the gate command ends. Defaults to an ordinary `exit 1`;
 *   a case staging a termination passes a `kill` instead.
 * @returns The finished child process.
 */
function runFailingGate(
  output: string,
  ending = "exit 1"
): SpawnSyncReturns<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-vocab-"));
  try {
    writeFileSync(path.join(root, ".lisa.config.json"), CONFIG);
    writeFileSync(
      path.join(root, "gate.sh"),
      `cat <<'GATE_OUTPUT_EOF'\n${output}\nGATE_OUTPUT_EOF\n${ending}\n`
    );
    return boundedSpawnSync({
      label: "lisa-run-gates.mjs --moment=push",
      command: process.execPath,
      args: [SCRIPT, "--moment=push"],
      cwd: root,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/**
 * The runner's summary line for the failed required gate.
 * @param stdout Everything the runner printed.
 * @returns The failure line, or the empty string when none was printed.
 */
function failureLine(stdout: string): string {
  return stdout.split("\n").find(line => line.includes(GATE_FAILED)) ?? "";
}

/**
 * The runner's summary line for the required gate that was terminated.
 *
 * Deliberately NOT a widening of {@link failureLine} to accept either headline.
 * Every case below that reads a kill must fail if the kill is reported as a
 * failure, and a helper matching both would make each of them pass on the
 * sentence this issue exists to abolish.
 * @param stdout Everything the runner printed.
 * @returns The kill line, or the empty string when none was printed.
 */
function killedLine(stdout: string): string {
  return stdout.split("\n").find(line => line.includes(GATE_KILLED)) ?? "";
}

/**
 * The real shape a contended run prints: tests killed at the budget, and — the
 * part that did the damage — coverage errors underneath them, because the code
 * the dead tests would have exercised went unexercised. Reading the coverage
 * line off this run reports the EFFECT of the timeout as though it were a
 * regression in the code under test.
 */
const TIMEOUT_OUTPUT = [
  " FAIL  tests/unit/scripts/enforce-config-extensions.test.ts > refuses .js",
  "Error: Test timed out in 60000ms.",
  " FAIL  tests/unit/scripts/sonar-secrets.test.ts > resolves every secret",
  "Error: Test timed out in 60000ms.",
  "ERROR: Coverage for statements (61.2%) does not meet global threshold (86%)",
  "Tests  2 failed | 14274 passed (14276)",
].join("\n");

/** A run where every test finished and the coverage floor really was missed. */
const THRESHOLD_OUTPUT = [
  "Tests  14276 passed (14276)",
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)",
  "ERROR: Coverage for lines (85.9%) does not meet global threshold (86%)",
].join("\n");

describe("bite: a timeout and a coverage regression get different verdicts", () => {
  it("reports a starved run as a timeout, and denies it is a coverage shortfall", () => {
    const verdict = failureLine(runFailingGate(TIMEOUT_OUTPUT).stdout);

    expect(verdict).toContain("60000ms");
    expect(verdict).toContain("NOT a coverage shortfall");
    expect(verdict).not.toContain("below the declared floor");
  });

  it("reports a real threshold miss as one, naming the metric and both numbers", () => {
    const child = runFailingGate(THRESHOLD_OUTPUT);

    expect(failureLine(child.stdout)).toContain("below the declared floor");
    expect(child.stdout).toContain("statements 85.12% < 86%");
  });

  it("does not render the two failures as the same sentence", () => {
    const timedOut = failureLine(runFailingGate(TIMEOUT_OUTPUT).stdout);
    const belowFloor = failureLine(runFailingGate(THRESHOLD_OUTPUT).stdout);

    expect(timedOut).not.toEqual(belowFloor);
  });

  it("takes the exit code from the gate command, never from the recorder", () => {
    // `cmd | tee log` reports tee's status, which is almost always zero. If the
    // capture were wired that way every failing gate would report as proved —
    // strictly worse than the mute failure this change set out to fix.
    const child = runFailingGate(THRESHOLD_OUTPUT);

    expect(child.status).toBe(1);
    expect(child.stdout).toContain(GATE_FAILED);
  });

  it("still streams the gate command's own output to the operator", () => {
    // Capture is worthless if it costs the operator the transcript, so the
    // recorded copy is a tee and not a swallow.
    expect(runFailingGate(THRESHOLD_OUTPUT).stdout).toContain(
      "Tests  14276 passed (14276)"
    );
  });
});

describe("bite: a killed gate is not reported as a failed test", () => {
  // CodySwannGT/lisa#2897. A SIGTERM is `exit 143` — `128 + 15` — and on a
  // saturated box it arrives carrying whatever the command had printed before
  // it died. That transcript reads exactly like a real gate failure, so one
  // `exit 1` on this gate had at least three distinct causes and re-running was
  // the rational response to all of them. The real one never got looked at.
  //
  // The kill is staged by the gate command signalling ITSELF, so the shell
  // reports a genuine 143 and the whole path is exercised — the wrapper, the
  // status file, `normaliseExec`, and the classifier. A stubbed executor cannot
  // produce a real 128+N, so it cannot prove this.

  /** SIGTERM to the gate script's own shell: a real 143, from a real signal. */
  const SELF_TERMINATE = 'kill -TERM "$$"';

  it("says the command was KILLED, naming the signal", () => {
    const stdout = runFailingGate(TIMEOUT_OUTPUT, SELF_TERMINATE).stdout;

    expect(killedLine(stdout)).toContain("SIGTERM");
    // The other half of the same fact, and the half #2813 could not state: the
    // word FAILED appears nowhere, because nothing was measured to fail.
    expect(
      failureLine(stdout),
      "a terminated gate reported as a failed one is the ambiguity this whole " +
        "vocabulary exists to remove"
    ).toBe("");
  });

  it("shows the arithmetic, so 143 stops reading as an ordinary exit code", () => {
    expect(
      killedLine(runFailingGate(TIMEOUT_OUTPUT, SELF_TERMINATE).stdout)
    ).toContain("128 + 15");
  });

  it("does not report the truncated transcript's failures as the verdict", () => {
    // The same output, ended two different ways. With `exit 1` the runner
    // correctly reads the timeouts in it; with a kill it must refuse to,
    // because the transcript is only whatever was printed before the signal.
    const killed = killedLine(
      runFailingGate(TIMEOUT_OUTPUT, SELF_TERMINATE).stdout
    );
    const failed = failureLine(runFailingGate(TIMEOUT_OUTPUT).stdout);

    // Read through `killedLine`, not `failureLine`: under the old helper a
    // missing headline returned "", and every "not" assertion below passed
    // vacuously on a line that was never printed.
    expect(killed).not.toBe("");
    expect(failed).toContain("60000ms");
    expect(killed).not.toContain("60000ms");
    expect(killed).not.toContain("NOT a coverage shortfall");
    expect(killed).not.toEqual(failed);
  });

  it("still blocks the push, because a terminated gate proved nothing", () => {
    // "Killed, not failed" is a statement about the diagnosis. It is never a
    // reason to let the push through.
    const child = runFailingGate(TIMEOUT_OUTPUT, SELF_TERMINATE);

    expect(child.status).toBe(1);
    expect(child.stdout).toContain(GATE_KILLED);
    // Blocking and blaming are separate. The push stops either way; only one
    // of the two says a property was measured and found wanting.
    expect(child.stdout).not.toContain(GATE_FAILED);
  });
});

describe("bite: unknown and not-applicable are different states", () => {
  const gates = {
    "code-style-slow": { push: { level: "required", run: "lint:slow" } },
    "code-review": { push: { await: "CodeRabbit", level: "required" } },
    // Costly: a whole second suite. It stops, and says nothing is known.
    "test-integration": { push: "required" },
    // Cheap: seconds, and unrelated to whatever the lint failure was about.
    "type-correctness": { push: "required" },
  };

  /**
   * Run the push moment with slow lint failing, collecting every printed line.
   * @returns The run result and the operator-facing transcript.
   */
  function blockedRun(): { transcript: string; result: GateRun } {
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates,
      moment: "push",
      runner: "bun run",
      exec: (command: string) => (command === "bun run lint:slow" ? 1 : 0),
      out,
    });
    return { transcript: lines.join("\n"), result };
  }

  it("says a costly gate queued behind the blocker has NO verdict, and names it", () => {
    const { transcript, result } = blockedRun();
    const queued = result.results.find(
      entry => entry.id === "test-integration"
    );

    expect(queued?.state).toBe(STATE.NOT_RUN);
    expect(queued?.detail).toContain("verdict UNKNOWN");
    expect(queued?.detail).toContain("code-style-slow");
    expect(transcript).toContain("UNKNOWN");
  });

  it("says a gate with nothing to run HAS a verdict, in different words", () => {
    const { transcript } = blockedRun();

    expect(transcript).toContain("NOT APPLICABLE");
    // The whole point: a reader must be able to tell the two apart. If both
    // buckets used one word, an early failure would leave later gates silently
    // unknown with nothing saying so.
    expect(transcript).toMatch(/UNKNOWN[\s\S]*NOT APPLICABLE/);
  });

  it("still runs the cheap gates behind the blocker rather than unrunning them", () => {
    // Five gates went unrun behind an intermittent coverage failure, two of
    // them the work-item check and the type check. Both finish in seconds and
    // answer questions a test suite says nothing about, so throwing their
    // answers away bought a minute and cost the operator a whole push cycle.
    const { result } = blockedRun();

    expect(result.passed.map(entry => entry.id)).toContain("type-correctness");
    expect(result.blocked).toBe(true);
  });
});

describe("bite: two gates on one prover do not both claim the failure", () => {
  /** Exactly the shared-prover shape this issue was filed against. */
  const gates = {
    "coverage-adequacy": { push: { level: "required", run: "test:cov" } },
    "test-correctness": { push: { level: "required", run: "test:cov" } },
  };

  /**
   * Run both shared-prover gates against one recorded transcript.
   * @param output What the prover printed before exiting 1.
   * @returns Each gate's state, keyed by gate id.
   */
  function statesFor(output: string): Record<string, string | undefined> {
    const result: GateRun = runGates({
      gates,
      moment: "push",
      runner: "bun run",
      exec: () => ({ code: 1, output }),
      out: () => {},
    });
    return Object.fromEntries(
      result.results.map(entry => [entry.id, entry.state])
    );
  }

  it("inverts which gate is FAILED between a starved run and a real regression", () => {
    const starved = statesFor(TIMEOUT_OUTPUT);
    const regressed = statesFor(THRESHOLD_OUTPUT);

    // Same command, same exit code, same two gates — and the gate that is
    // FAILED in one run is the gate that was never measured in the other.
    expect(starved["test-correctness"]).toBe(STATE.FAILED);
    expect(starved["coverage-adequacy"]).toBe(STATE.UNPROVABLE);
    expect(regressed["coverage-adequacy"]).toBe(STATE.FAILED);
    expect(regressed["test-correctness"]).toBe(STATE.UNPROVABLE);
  });

  it("blocks either way, because unmeasured is not proved", () => {
    for (const output of [TIMEOUT_OUTPUT, THRESHOLD_OUTPUT]) {
      const result: GateRun = runGates({
        gates,
        moment: "push",
        runner: "bun run",
        exec: () => ({ code: 1, output }),
        out: () => {},
      });
      expect(result.blocked).toBe(true);
    }
  });

  it("never moves a verdict onto a gate that is not part of the run", () => {
    // With `test-correctness` undeclared, the timeout has nowhere to move the
    // blame to. A diagnosis may explain a failure; it may not invent an
    // attribution to a property nobody asked about.
    const result: GateRun = runGates({
      gates: {
        "coverage-adequacy": { push: { level: "required", run: "test:cov" } },
      },
      moment: "push",
      runner: "bun run",
      exec: () => ({ code: 1, output: TIMEOUT_OUTPUT }),
      out: () => {},
    });

    expect(result.results[0]?.state).toBe(STATE.FAILED);
    expect(result.results[0]?.detail).toContain("60000ms");
  });
});

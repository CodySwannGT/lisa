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

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { type GateRun, sink } from "../unit/scripts/lisa-run-gates-fixtures.js";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/** The gate this issue was filed against, and the one it misreported. */
const COVERAGE_GATE = "coverage-adequacy";

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
 * @param output What the gate command writes to stdout before exiting 1.
 * @returns The finished child process.
 */
function runFailingGate(output: string): SpawnSyncReturns<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-vocab-"));
  try {
    writeFileSync(path.join(root, ".lisa.config.json"), CONFIG);
    writeFileSync(
      path.join(root, "gate.sh"),
      `cat <<'GATE_OUTPUT_EOF'\n${output}\nGATE_OUTPUT_EOF\nexit 1\n`
    );
    return spawnSync(process.execPath, [SCRIPT, "--moment=push"], {
      cwd: root,
      encoding: "utf8",
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
  return (
    stdout.split("\n").find(line => line.includes("required gate FAILED")) ?? ""
  );
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
    expect(child.stdout).toContain("required gate FAILED");
  });

  it("still streams the gate command's own output to the operator", () => {
    // Capture is worthless if it costs the operator the transcript, so the
    // recorded copy is a tee and not a swallow.
    expect(runFailingGate(THRESHOLD_OUTPUT).stdout).toContain(
      "Tests  14276 passed (14276)"
    );
  });
});

describe("bite: unknown and not-applicable are different states", () => {
  const gates = {
    "code-style": { commit: { level: "required", run: "lint" } },
    "code-review": { commit: { await: "CodeRabbit", level: "required" } },
    typecheck: { commit: { level: "required", run: "typecheck" } },
  };

  /**
   * Run the commit moment with `lint` failing, collecting every printed line.
   * @returns The run result and the operator-facing transcript.
   */
  function blockedRun(): { transcript: string; result: GateRun } {
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates,
      moment: "commit",
      runner: "bun run",
      exec: (command: string) => (command === "bun run lint" ? 1 : 0),
      out,
    });
    return { transcript: lines.join("\n"), result };
  }

  it("says a gate queued behind the blocker has NO verdict, and names the blocker", () => {
    const { transcript, result } = blockedRun();
    const queued = result.results.find(entry => entry.id === "typecheck");

    expect(queued?.state).toBe(STATE.NOT_RUN);
    expect(queued?.detail).toContain("verdict UNKNOWN");
    expect(queued?.detail).toContain("code-style");
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
});

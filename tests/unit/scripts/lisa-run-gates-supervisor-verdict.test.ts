/**
 * Gate-route coverage for the process-tree supervisor verdict boundary.
 *
 * A real supervisor result is fed through `runGates` and its evidence envelope.
 * This catches a transport repair that looks correct at `supervise()` but still
 * reaches operators or schema consumers as an ordinary numeric gate failure.
 * @module tests/unit/scripts/lisa-run-gates-supervisor-verdict
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DIAGNOSIS } from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  evidenceDocument,
  runGates,
  spawnExec,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  childNumericExitCommand,
  numericExitCommand,
  processGroupSignalCommand,
  selfSignalCommand,
} from "../../helpers/process-tree-runner-verdict.js";
import {
  COMMIT,
  type GateOutcome,
  type GateRun,
  REQUIRED_AT_COMMIT,
  RUNNER,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

/** The gate declaration used by the real-boundary classification cases. */
const GATES = { [STYLE]: REQUIRED_AT_COMMIT };

/** Stable observation time required by the evidence schema. */
const OBSERVED_AT = "2026-08-28T00:00:00.000Z";

/** Marker written only after the capture wrapper published both owned paths. */
const CAPTURE_MARKER = "lisa-3384-default-capture";

/** One real executor answer plus the gate run it produces. */
interface BoundaryRun {
  /** Parent-visible answer from `spawnExec`. */
  readonly boundary: {
    readonly code: number | null;
    readonly output: string | null;
  };
  /** Gate vocabulary, buckets, and outcomes derived from that answer. */
  readonly result: GateRun;
  /** Operator-facing gate and summary lines. */
  readonly lines: readonly string[];
}

/** Evidence fields asserted at the supervisor/classifier boundary. */
interface BoundaryEvidence {
  /** Gate observations recorded by the evidence producer. */
  readonly gates: readonly [
    {
      readonly status: string;
      readonly measures: {
        readonly diagnosis: string | null;
        readonly exit_code: number | null;
        readonly state: string;
      };
    },
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Drive the production supervisor and classifier through one capture mode.
 * @param command - Shell source that becomes the supervised gate command.
 * @param capture - Whether to retain the default shell, tee, and status path.
 * @returns The raw boundary result and classified gate run.
 */
function throughGateBoundary(command: string, capture = false): BoundaryRun {
  if (!capture) vi.stubEnv("LISA_GATES_CAPTURE", "0");
  const boundary = spawnExec(command) as BoundaryRun["boundary"];
  const lines: string[] = [];
  const result = runGates({
    exec: () => boundary,
    gates: GATES,
    moment: COMMIT,
    out: line => lines.push(line),
    runner: RUNNER,
  }) as GateRun;
  return { boundary, lines, result };
}

/**
 * Refuse to run unless the default capture wrapper supplied both path facts.
 * @param command - Command that runs only after capture is established.
 * @returns Shell source with a visible tee/log marker before the command.
 */
function requireCapture(command: string): string {
  return (
    'test -n "$LISA_GATE_LOG_PATH" && ' +
    'test -n "$LISA_GATE_STATUS_PATH" || exit 7\n' +
    `printf '${CAPTURE_MARKER}\\n'\n` +
    "capture_attempts=0\n" +
    `until grep -Fq '${CAPTURE_MARKER}' "$LISA_GATE_LOG_PATH" 2>/dev/null; do\n` +
    "  capture_attempts=$((capture_attempts + 1))\n" +
    "  test $capture_attempts -lt 10000 || exit 8\n" +
    `done\n${command}`
  );
}

/** Build the exact evidence row a completed gate route would persist. */
function evidenceFor(result: GateRun): BoundaryEvidence {
  return evidenceDocument({
    gates: GATES,
    moment: COMMIT,
    observedAt: OBSERVED_AT,
    result,
    runner: RUNNER,
    verdict: "blocked",
  }) as BoundaryEvidence;
}

describe.skipIf(process.platform === "win32")(
  "a real killed gate crosses every boundary as no-verdict evidence",
  () => {
    it("reports KILLED with null status, not ordinary exit 128", () => {
      const { boundary, result } = throughGateBoundary(
        selfSignalCommand("SIGTERM")
      );
      const outcome = result.results[0] as GateOutcome;

      // The released pre-fix boundary returned numeric 128 here.
      expect(boundary).toEqual({ code: null, output: null });
      expect(outcome.state).toBe(STATE.KILLED);
      expect(outcome.code).toBeNull();
      expect(outcome.diagnosis).toBe(DIAGNOSIS.KILLED);
      expect(result.killed.map(row => row.id)).toEqual([STYLE]);
      expect(result.failed.map(row => row.id)).toEqual([STYLE]);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(true);
    });

    it("persists unknown status and null exit for the killed run", () => {
      const { result } = throughGateBoundary(selfSignalCommand("SIGINT"));
      const row = evidenceFor(result).gates[0];

      expect(row.status).toBe("unknown");
      expect(row.measures.exit_code).toBeNull();
      expect(row.measures.state).toBe(STATE.KILLED);
      expect(row.measures.diagnosis).toBe(DIAGNOSIS.KILLED);
    });
  }
);

describe("an ordinary exit 128 keeps an ordinary verdict shape", () => {
  it("is numeric and is never labelled killed", () => {
    const { boundary, result } = throughGateBoundary(numericExitCommand(128));
    const outcome = result.results[0] as GateOutcome;

    expect(boundary).toEqual({ code: 128, output: null });
    expect(outcome.code).toBe(128);
    expect(outcome.state).toBe(STATE.FAILED);
    expect(outcome.diagnosis).toBe(DIAGNOSIS.UNCAPTURED);
    expect(result.killed).toEqual([]);
    expect(evidenceFor(result).gates[0].measures.exit_code).toBe(128);
  });
});

describe.skipIf(process.platform === "win32")(
  "the default capture route preserves killed versus failed identity",
  () => {
    it("keeps a real SIGTERM null and never prints a stale FAILED token", () => {
      const { boundary, lines, result } = throughGateBoundary(
        requireCapture(processGroupSignalCommand("SIGTERM")),
        true
      );
      const outcome = result.results[0] as GateOutcome;

      expect(boundary.code).toBeNull();
      expect(boundary.output).toContain(CAPTURE_MARKER);
      expect(outcome.state).toBe(STATE.KILLED);
      expect(result.killed.map(row => row.id)).toEqual([STYLE]);
      expect(lines.some(line => line.includes("KILLED"))).toBe(true);
      expect(lines.some(line => line.includes("FAILED"))).toBe(false);
    });

    it("keeps a deliberate child exit 128 numeric and never killed", () => {
      const { boundary, lines, result } = throughGateBoundary(
        requireCapture(childNumericExitCommand(128)),
        true
      );
      const outcome = result.results[0] as GateOutcome;

      expect(boundary.code).toBe(128);
      expect(boundary.output).toContain(CAPTURE_MARKER);
      expect(outcome.code).toBe(128);
      expect(outcome.state).toBe(STATE.UNPROVABLE);
      expect(result.killed).toEqual([]);
      expect(result.unprovable.map(row => row.id)).toEqual([STYLE]);
      expect(lines.some(line => line.includes("NOT PROVED"))).toBe(true);
      expect(lines.some(line => line.includes("KILLED"))).toBe(false);
      expect(lines.some(line => line.includes("FAILED"))).toBe(false);
    });
  }
);

describe("malformed executor transport fails closed", () => {
  it("cannot turn a string status into a passing gate", () => {
    const result = runGates({
      exec: () => ({ code: "0", output: "" }) as never,
      gates: GATES,
      moment: COMMIT,
      out: () => {},
      runner: RUNNER,
    }) as GateRun;

    expect(result.passed).toEqual([]);
    expect(result.blocked).toBe(true);
    expect(result.results[0]?.code).toBeNull();
    expect(evidenceFor(result).gates[0].status).toBe("unknown");
  });
});

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

/** Marker emitted by an ordinary captured command. */
const CAPTURE_MARKER = "lisa-3384-default-capture";

/** One real executor answer plus the gate run it produces. */
interface BoundaryRun {
  /** Parent-visible answer from `spawnExec`. */
  readonly boundary: {
    readonly code: number | null;
    readonly output: string | null;
    readonly signal?: string;
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
 * @param capture - Whether to retain the default diagnostic output capture.
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

/** Emit a marker before an ordinary command reaches the actual capture route. */
function requireCapture(command: string): string {
  return `printf '${CAPTURE_MARKER}\\n'\n${command}`;
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
      expect(boundary).toEqual({
        code: null,
        output: null,
        signal: "SIGTERM",
      });
      expect(outcome.state).toBe(STATE.KILLED);
      expect(outcome.code).toBeNull();
      expect(outcome.diagnosis).toBe(DIAGNOSIS.KILLED);
      expect(result.killed.map(row => row.id)).toEqual([STYLE]);
      expect(result.failed.map(row => row.id)).toEqual([STYLE]);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(true);
    });

    it("persists unknown status and null exit for the killed run", () => {
      const { boundary, result, lines } = throughGateBoundary(
        selfSignalCommand("SIGINT")
      );
      const row = evidenceFor(result).gates[0];

      expect(boundary.signal).toBe("SIGINT");
      expect(lines.some(line => line.includes("KILLED by SIGINT"))).toBe(true);
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
      expect(boundary.signal).toBe("SIGTERM");
      expect(boundary.output).toContain(CAPTURE_MARKER);
      expect(outcome.state).toBe(STATE.KILLED);
      expect(result.killed.map(row => row.id)).toEqual([STYLE]);
      expect(lines.some(line => line.includes("KILLED"))).toBe(true);
      expect(lines.some(line => line.includes("KILLED by SIGTERM"))).toBe(true);
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
  it("does not print an unrecognized signal as native evidence", () => {
    const lines: string[] = [];
    const result = runGates({
      exec: () => ({
        code: null,
        output: "",
        signal: "SIGTERM\nuntrusted-metadata",
      }),
      gates: GATES,
      moment: COMMIT,
      out: line => lines.push(line),
      runner: RUNNER,
    }) as GateRun;

    expect(result.blocked).toBe(true);
    expect(result.results[0]?.code).toBeNull();
    expect(result.results[0]?.state).toBe(STATE.KILLED);
    expect(lines.join("\n")).not.toContain("untrusted-metadata");
    expect(lines.join("\n")).not.toContain("KILLED by SIGTERM");
    expect(evidenceFor(result).gates[0].measures.exit_code).toBeNull();
  });

  it("never lets optional signal metadata replace a numeric OS exit", () => {
    const result = runGates({
      exec: () => ({ code: 128, output: "", signal: "SIGTERM" }),
      gates: GATES,
      moment: COMMIT,
      out: () => {},
      runner: RUNNER,
    }) as GateRun;

    expect(result.blocked).toBe(true);
    expect(result.killed).toEqual([]);
    expect(result.results[0]?.code).toBe(128);
    expect(evidenceFor(result).gates[0].measures.exit_code).toBe(128);
  });

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

describe.skipIf(process.platform === "win32")(
  "OS-derived captured verdict",
  () => {
    it("retains a direct shell exit 17 with its output", () => {
      const result = spawnExec(requireCapture(numericExitCommand(17)));
      expect(result.code).toBe(17);
      expect(result.output).toContain(CAPTURE_MARKER);
    });

    it("does not publish writable capture paths to an ordinary command", () => {
      const result = spawnExec(
        'test -z "$LISA_GATE_STATUS_PATH" && test -z "$LISA_GATE_LOG_PATH"; exit $?'
      );
      expect(result.code).toBe(0);
    });
  }
);

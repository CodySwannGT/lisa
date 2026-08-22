/**
 * The bite test for {@link captureGateRun} itself.
 *
 * `captureGateRun` exists because the mutation-gate bite test was capable of
 * passing on an I/O failure, and the hazard is **one-sided**: an overflow on
 * the intact run contradicts `expect(status).toBe(0)` and fails loudly, while
 * an overflow on the WEAKENED run supplies exactly the `1` that
 * `expect(status).toBe(1)` is looking for. So the case that matters here is the
 * weakened one, and a test built on the intact side would have passed with or
 * without the fix.
 *
 * Every case below is exercised through a real child process rather than a
 * stub. The defect was in what a runtime attaches to a thrown
 * `execFileSync` error, and a stub would have asserted this file's beliefs
 * about that instead of the behaviour.
 * @module tests/unit/helpers/gate-capture.test
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { GATE_MAX_BUFFER, captureGateRun } from "../../helpers/gate-capture.js";

/** Node's default `maxBuffer`, the bound the gate was silently inheriting. */
const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;

/** Small enough to overflow cheaply, large enough to be a real capture. */
const TINY_MAX_BUFFER = 4096;

/** A verdict line shaped like the one the gate parses out of a real run. */
const UNDER_FLOOR = "Mutation score 28.72 under breaking threshold 32";

/**
 * A child that writes a chosen number of bytes and exits with a chosen status.
 *
 * `process.exitCode` rather than `process.exit()`: the latter can cut a large
 * pipe write short, which would make an oversized case overflow for the wrong
 * reason — or fail to overflow at all.
 * @param bytes - How much to write to stdout
 * @param code - Exit status to leave behind
 * @returns A `node -e` program source
 */
const writing = (bytes: number, code: number): string =>
  `process.exitCode = ${code}; process.stdout.write("x".repeat(${bytes}));`;

/**
 * Capture a `node -e` program under a chosen buffer.
 * @param source - Program source
 * @param maxBuffer - Buffer to run it under; omitted means the module default
 * @param label - Which run this stands in for
 * @returns The captured run
 */
const capture = (
  source: string,
  maxBuffer?: number,
  label = "weakened run"
): { readonly status: number; readonly output: string } =>
  captureGateRun({
    label,
    command: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
  });

describe("captureGateRun: a truncated capture is not a verdict", () => {
  it("fails naming the truncation when the WEAKENED run overflows, instead of accepting the status 1 it asks for", () => {
    // Exactly the shape the weakened run is asserted to have — a non-zero exit
    // — with output past the buffer. Before the fix this returned
    // `{ status: 1 }`, which `expect(weakened.status).toBe(1)` accepted.
    expect(() =>
      capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER)
    ).toThrow(/TRUNCATED/);
    expect(() =>
      capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER)
    ).toThrow(/ENOBUFS/);
  });

  it("names the buffer it exceeded, so the message says what to change", () => {
    expect(() =>
      capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER)
    ).toThrow(new RegExp(`${TINY_MAX_BUFFER}-byte maxBuffer`));
  });

  it("was armed: the pre-fix reading of that same event produced a plausible status 1", () => {
    // The positive control. It runs the OLD expression against a real overflow
    // and shows it yields 1 — so the weakened assertion really was satisfiable
    // by an I/O failure, on this runtime, today. If a runtime ever stops
    // attaching a coercible status here, this case says so.
    const failure = ((): { readonly status?: number | null } => {
      try {
        execFileSync(
          process.execPath,
          ["-e", writing(TINY_MAX_BUFFER * 4, 1)],
          {
            encoding: "utf8",
            maxBuffer: TINY_MAX_BUFFER,
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
        throw new Error("the overflow did not throw");
      } catch (error) {
        return error as { readonly status?: number | null };
      }
    })();
    expect(failure.status ?? 1).toBe(1);
  });

  it("fails the INTACT side too, rather than relying on the status contradiction", () => {
    // Self-catching before the fix, but only by accident. It is asserted so
    // the detection is known to be keyed on the capture, not on the assertion
    // that happens to disagree with it.
    expect(() =>
      capture(writing(TINY_MAX_BUFFER * 4, 0), TINY_MAX_BUFFER, "intact run")
    ).toThrow(/TRUNCATED/);
  });
});

describe("captureGateRun: a real verdict still reads as one", () => {
  it("returns status 1 with the score line for a genuine run under the floor", () => {
    const run = capture(
      `process.exitCode = 1; process.stdout.write(${JSON.stringify(UNDER_FLOOR)});`,
      TINY_MAX_BUFFER
    );
    expect(run.status).toBe(1);
    expect(run.output).toContain(UNDER_FLOOR);
  });

  it("returns status 0 and the whole output for a passing run", () => {
    const run = capture(
      `process.stdout.write("score of 53.62 is greater than or equal to break threshold 32");`,
      TINY_MAX_BUFFER,
      "intact run"
    );
    expect(run.status).toBe(0);
    expect(run.output).toContain("53.62");
  });

  it("captures a report larger than Node's 1 MiB default whole", () => {
    // The buffer half of the fix, proved directly: this exact run threw
    // ENOBUFS before, because no `maxBuffer` was passed at all.
    const bytes = NODE_DEFAULT_MAX_BUFFER * 2;
    const run = capture(writing(bytes, 1));
    expect(run.status).toBe(1);
    expect(run.output).toHaveLength(bytes);
  });
});

describe("captureGateRun: the three ways a weakened run can be non-1, told apart", () => {
  // The weakened run is asserted to exit 1, and three different things can
  // produce a status there. Only the middle one is dishonest, and fixing it
  // must not cost the other two their honesty.
  it("passes a real 143 through untouched, neither laundered to 1 nor called truncation", () => {
    // 143 is 128+15, SIGTERM — observed on a real CI run and tracked as
    // CodySwannGT/lisa#2943. It is the HONEST failure of the three: it
    // contradicts the weakened assertion out loud. It must survive this module.
    const run = capture(writing(64, 143), TINY_MAX_BUFFER);
    expect(run.status).toBe(143);
  });

  it("returns a genuine 1 as 1, so the honest verdict is unchanged", () => {
    expect(capture(writing(64, 1), TINY_MAX_BUFFER).status).toBe(1);
  });

  it("still names truncation when the overflow arrives with a status attached", () => {
    // The precedence, stated: a capture that was cut off has no verdict in it
    // whatever number came back with it, and under Node a real number does.
    // Reporting the number would hand the caller a verdict read out of output
    // that stops mid-line — which is the entire defect, one field over.
    expect(() =>
      capture(writing(TINY_MAX_BUFFER * 4, 143), TINY_MAX_BUFFER)
    ).toThrow(/TRUNCATED/);
  });
});

describe("captureGateRun: a killed run is not a failed one", () => {
  it("throws naming the signal rather than coercing a signalled death to status 1", () => {
    expect(() =>
      capture(`process.kill(process.pid, "SIGKILL");`, TINY_MAX_BUFFER)
    ).toThrow(/NO exit status/);
    expect(() =>
      capture(`process.kill(process.pid, "SIGKILL");`, TINY_MAX_BUFFER)
    ).toThrow(/SIGKILL/);
  });
});

describe("GATE_MAX_BUFFER", () => {
  it("is a finite bound well clear of the default it replaces", () => {
    expect(Number.isFinite(GATE_MAX_BUFFER)).toBe(true);
    // The measured capture that overflowed was 1,077,240 bytes. A ceiling is
    // only worth having if it is many multiples of the largest thing observed,
    // and the 1 MiB default is the counter-example: adequate until it was not,
    // with no warning on the way past 99.9%.
    expect(GATE_MAX_BUFFER).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(GATE_MAX_BUFFER / NODE_DEFAULT_MAX_BUFFER).toBeGreaterThanOrEqual(
      16
    );
  });
});

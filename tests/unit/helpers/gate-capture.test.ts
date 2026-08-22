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
 * Almost every case drives a real child process rather than a stub, because the
 * defect was in what a runtime attaches to a thrown `execFileSync` error and a
 * stub would assert this file's beliefs about that instead of the behaviour.
 *
 * Two cases are the exception, and they are the decisive ones. Whether an
 * overflow carries an exit status is a **race** — measured on both runtimes,
 * see {@link gateRunFrom} — so a spawned child cannot be made to produce a
 * chosen draw. Those two feed the classifier the two shapes transcribed from
 * that measurement, and a spawned case beside them asserts the same outcome on
 * whichever draw actually arrives.
 * @module tests/unit/helpers/gate-capture.test
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import type { GateRun } from "../../helpers/gate-capture.js";
import {
  MAX_GATE_OUTPUT_BYTES,
  captureGateRun,
  gateRunFrom,
} from "../../helpers/gate-capture.js";

/** Node's default `maxBuffer`, the bound the gate was silently inheriting. */
const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;

/** Small enough to overflow cheaply, large enough to be a real capture. */
const TINY_MAX_BUFFER = 4096;

/** A verdict line shaped like the one the gate parses out of a real run. */
const UNDER_FLOOR = "Mutation score 28.72 under breaking threshold 32";

/** The arm whose assertion a truncated capture used to satisfy. */
const WEAKENED = "weakened run";

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
  label = WEAKENED
): GateRun =>
  captureGateRun({
    label,
    command: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
  });

describe("captureGateRun: a truncated capture is not a verdict", () => {
  it("refuses the WEAKENED run's overflow instead of handing back the status 1 it asks for", () => {
    // Exactly the shape the weakened run is asserted to have — a non-zero exit
    // — with output past the buffer. Under the original capture this came back
    // as `{ status: 1 }`, which `expect(weakened.status).toBe(1)` accepted.
    const run = capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER);
    expect(run.killedBy).toMatch(/TRUNCATED/);
    expect(run.status).toBeNull();
    // The guarantee, not just the sentence: `null` cannot satisfy `toBe(1)`,
    // so a caller that forgets to read `killedBy` still fails.
    expect(run.status).not.toBe(1);
  });

  it("names the truncation, the buffer, and the status that must not be believed", () => {
    const run = capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER);
    expect(run.killedBy).toContain("ENOBUFS");
    expect(run.killedBy).toContain(`${TINY_MAX_BUFFER}-byte maxBuffer`);
    expect(run.killedBy).toContain(WEAKENED);
  });

  it("catches the overflow shape a null-status check misses, on the measured Node draw", () => {
    // THE decisive case, and the reason `gateRunFrom` is exported. Whether an
    // ENOBUFS carries an exit status is a RACE — measured 2026-08-22, five runs
    // per form at maxBuffer 4096 against a 16,384-byte child, BOTH runtimes
    // produced `ENOBUFS` with a real numeric status on some draws. A test that
    // spawns a child gets whichever draw it gets; this feeds the transcribed
    // shape directly, so the property is asserted rather than hoped for.
    //
    // A classifier keyed on a MISSING status returns `{ status: 1 }` here with
    // no `killedBy` — which is exactly the status the weakened run is asserted
    // to have, read out of output that stops mid-line.
    const run = gateRunFrom(
      { code: "ENOBUFS", status: 1, signal: null, stdout: "x".repeat(16384) },
      TINY_MAX_BUFFER,
      WEAKENED
    );
    expect(run.status).toBeNull();
    expect(run.status).not.toBe(1);
    expect(run.killedBy).toMatch(/TRUNCATED/);
  });

  it("catches the other measured draw too, where the status really is absent", () => {
    const run = gateRunFrom(
      {
        code: "ENOBUFS",
        status: null,
        signal: "SIGTERM",
        stdout: "x".repeat(16384),
      },
      TINY_MAX_BUFFER,
      WEAKENED
    );
    expect(run.status).toBeNull();
    expect(run.killedBy).toMatch(/TRUNCATED/);
  });

  it("classifies a spawned overflow as truncation whichever draw it lands on", () => {
    // The end-to-end companion to the two transcribed cases above: a real
    // child, a real overflow, either draw, always classified as truncation.
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
    // The positive control: on this runtime the old expression really did
    // produce a plausible 1 from a truncated capture. If a future runtime stops
    // attaching a coercible status here, this case says so.
    expect(failure.status ?? 1).toBe(1);
    const run = capture(writing(TINY_MAX_BUFFER * 4, 1), TINY_MAX_BUFFER);
    expect(run.status).toBeNull();
    expect(run.killedBy).toMatch(/TRUNCATED/);
  });

  it("refuses the INTACT side too, rather than relying on the status contradiction", () => {
    // Self-catching before the fix, but only by accident. Asserted so the
    // detection is known to be keyed on the capture, not on the assertion that
    // happens to disagree with it.
    const run = capture(
      writing(TINY_MAX_BUFFER * 4, 0),
      TINY_MAX_BUFFER,
      "intact run"
    );
    expect(run.killedBy).toMatch(/TRUNCATED/);
    expect(run.status).toBeNull();
  });
});

describe("captureGateRun: a real verdict still reads as one", () => {
  it("returns status 1 with the score line for a genuine run under the floor", () => {
    const run = capture(
      `process.exitCode = 1; process.stdout.write(${JSON.stringify(UNDER_FLOOR)});`,
      TINY_MAX_BUFFER
    );
    expect(run.status).toBe(1);
    expect(run.killedBy).toBeUndefined();
    expect(run.output).toContain(UNDER_FLOOR);
  });

  it("returns status 0 and the whole output for a passing run", () => {
    const run = capture(
      `process.stdout.write("score of 53.62 is greater than or equal to break threshold 32");`,
      TINY_MAX_BUFFER,
      "intact run"
    );
    expect(run.status).toBe(0);
    expect(run.killedBy).toBeUndefined();
    expect(run.output).toContain("53.62");
  });

  it("captures a report larger than Node's 1 MiB default whole", () => {
    // The buffer half of the fix, proved directly: this exact run overflowed
    // before, because no `maxBuffer` was passed at all.
    const bytes = NODE_DEFAULT_MAX_BUFFER * 2;
    const run = capture(writing(bytes, 1));
    expect(run.status).toBe(1);
    expect(run.killedBy).toBeUndefined();
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
    expect(run.killedBy).toBeUndefined();
  });

  it("returns a genuine 1 as 1, so the honest verdict is unchanged", () => {
    expect(capture(writing(64, 1), TINY_MAX_BUFFER).status).toBe(1);
  });

  it("still names truncation when the overflow arrives with a status attached", () => {
    // The precedence, stated: a capture that was cut off has no verdict in it
    // whatever number came back with it, and under Node a real number does.
    // Reporting the number would hand the caller a verdict read out of output
    // that stops mid-line — which is the entire defect, one field over.
    expect(
      capture(writing(TINY_MAX_BUFFER * 4, 143), TINY_MAX_BUFFER).killedBy
    ).toMatch(/TRUNCATED/);
  });
});

describe("captureGateRun: a killed run is not a failed one", () => {
  it("names the signal rather than coercing a signalled death to status 1", () => {
    const run = capture(
      `process.kill(process.pid, "SIGKILL");`,
      TINY_MAX_BUFFER
    );
    expect(run.status).toBeNull();
    expect(run.status).not.toBe(1);
    expect(run.killedBy).toContain("SIGKILL");
  });
});

describe("MAX_GATE_OUTPUT_BYTES", () => {
  it("is a finite bound well clear of the default it replaces", () => {
    expect(Number.isFinite(MAX_GATE_OUTPUT_BYTES)).toBe(true);
    // The measured capture that overflowed was ~1.03 MiB, and the peak is a
    // NoCoverage burst that scales with the mutate list. A ceiling is only
    // worth having if it is many multiples of the largest thing observed — the
    // 1 MiB default is the counter-example: adequate until it was not, with no
    // warning on the way past 99.9%.
    expect(MAX_GATE_OUTPUT_BYTES).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(
      MAX_GATE_OUTPUT_BYTES / NODE_DEFAULT_MAX_BUFFER
    ).toBeGreaterThanOrEqual(16);
  });
});

/**
 * Capturing a subprocess gate run without laundering an I/O failure into a
 * verdict.
 *
 * The mutation-gate bite tests run the real gate as a child process and judge
 * it by its exit status. Both of them captured it with `execFileSync` and no
 * `maxBuffer` — inheriting Node's 1 MiB default — and read `failure.status ?? 1`
 * out of the catch, which invented an exit status the run never returned.
 * CodySwannGT/lisa#2944 fixed the whole-list one in place; this module is the
 * same fix made shared, tested, and closed on the case that survived it.
 *
 * ## Why the coercion is worse than the small buffer
 *
 * The overflow hazard is **one-sided**.
 *
 * The bite test requires an intact run to exit 0 and a weakened run to exit 1.
 * On the intact side a fabricated `1` contradicts `expect(status).toBe(0)`, so
 * an overflow there is self-catching. On the weakened side a fabricated `1` is
 * **exactly what the assertion is looking for**: `expect(status).toBe(1)`
 * passes, and the only thing left to notice is that the score line it goes on
 * to parse was cut off — which surfaces as `no verdict in gate output`, a
 * content-shaped failure that never says "truncated". So the assertion that
 * proves the gate bites was being satisfied by an I/O failure.
 *
 * That is also why a bigger buffer is not the whole fix. It moves the size at
 * which the trap re-arms and leaves the trap.
 *
 * ## The hole a null-status check leaves open, measured
 *
 * The in-place fix keyed the detection on a **missing** status: `status ?? null`
 * with `killedBy` set when the status came back `null` or `undefined`. On the
 * observed failure that was right — Node killed Stryker mid-stream and reported
 * no status. It is not right in general:
 *
 * `execFileSync` with `maxBuffer` exceeded, one child (`exit(1)` after writing
 * past the cap), measured 2026-08-22 on this repository:
 *
 * | runtime | `code` | `status` | `signal` |
 * |---|---|---|---|
 * | node v22.22.0 | `ENOBUFS` | **`1`** | `null` |
 * | bun 1.3.11 | `ENOBUFS` | `null` | `SIGTERM` |
 *
 * Under Node a truncated capture can come back with a **real numeric
 * `status: 1`** — whenever the child finishes and exits on its own before the
 * overflow is noticed. A null-status check does not fire on that, so the run is
 * reported as an ordinary status 1, `killedBy` is unset, and the weakened
 * assertion passes on truncated output exactly as before. Which of the two
 * shapes arrives is a race, so the defect does not present consistently.
 *
 * `code === "ENOBUFS"` is the field that is true on both runtimes, so that is
 * what {@link captureGateRun} branches on, and it branches on it **before**
 * looking at the status.
 * @module tests/helpers/gate-capture
 */
import { execFileSync } from "node:child_process";
import * as os from "node:os";

/**
 * How much output one gate run may produce before Node kills it, in bytes.
 *
 * Node's default `maxBuffer` for `execFileSync` is 1 MiB. The weakened run
 * exceeds that: withholding a guard's suites turns every one of its mutants
 * into a `[NoCoverage]` entry, and the clear-text reporter prints each with its
 * source diff, so the arm required to FAIL is precisely the arm whose output is
 * largest. Measured at 1,076,523 bytes when `lisa-gates.mjs` grew by ~800
 * lines — just over the cap, and the cap is what it hit.
 *
 * `maxSurvived: 0` in the bite test's config does NOT cap this, and cannot be
 * made to: the clear-text reporter writes every `Survived` and `NoCoverage`
 * mutant in full unconditionally, and `maxSurvived` is not read anywhere in the
 * installed Stryker. Raising the buffer is the fix, not a way around a knob
 * that works.
 *
 * ## The peak is a burst, which is what the number is sized against
 *
 * The capture does not fill steadily. Those NoCoverage entries are emitted
 * **all at once**, immediately after the dry run — both observed deaths landed
 * 5–6 minutes in, at exactly that point. So the quantity to bound is not how
 * big the report is at the end, it is how many mutants can be reported in one
 * burst, and the worst case of that is the whole population. It therefore
 * scales with the `mutate` list, not with anything that settles.
 *
 * At the measured ~169 bytes per mutant (1,077,240 bytes over ~6,391 mutants in
 * a second CI sample) 256 MiB is room for roughly **1.6 million mutants in a
 * single burst**, against the ~6,400 today's ten guard files produce. The list
 * grows one hand-added guard at a time under a threshold ratchet; it does not
 * arrive there by drift.
 *
 * It stays **finite** deliberately. `Infinity` is available and is the wrong
 * answer: an unbounded capture cannot tell a large report from a runaway one,
 * and the failure it picks instead is the worker exhausting memory — a death
 * with no name on it, which is the shape this module exists to eliminate.
 */
export const MAX_GATE_OUTPUT_BYTES = 256 * 1024 * 1024;

/** One gate run that ran to completion, or the reason it did not. */
export interface GateRun {
  /** The exit code the child actually returned, or `null` if it never did. */
  readonly status: number | null;
  readonly output: string;
  /** Set when the run was killed or truncated rather than reaching a verdict. */
  readonly killedBy?: string;
}

/** What to run, and where. */
export interface GateCaptureOptions {
  /** Names the run in any failure message — "weakened run", "intact run". */
  readonly label: string;
  /** Absolute path to the executable; never resolved through `PATH`. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Defaults to {@link MAX_GATE_OUTPUT_BYTES}; narrowed only to prove the failure. */
  readonly maxBuffer?: number;
}

/** The subset of a `spawnSync` failure this module reads. */
export interface CaptureFailure {
  readonly code?: string;
  readonly status?: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

/**
 * Signal numbers to their names, for reading `128 + N` exit codes.
 *
 * Built from `os.constants.signals` rather than a hand-written table so it
 * cannot drift from the platform. Aliases share a number (`SIGABRT`/`SIGIOT`,
 * `SIGCHLD`/`SIGCLD`); the first spelling wins, which is the conventional one
 * on both platforms this runs on.
 */
const SIGNAL_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(os.constants.signals)
    .reverse()
    .map(([name, number]) => [number, name] as const)
);

/** Lowest exit code that can mean "killed by signal N": 128 + SIGHUP. */
const SIGNALLED_EXIT_FLOOR = 129;

/** Highest such code worth reading that way: 128 + 37, past every real signal. */
const SIGNALLED_EXIT_CEILING = 165;

/**
 * Read an exit code as a death by signal, if that is what it is.
 *
 * `128 + N` is the ordinary way a corpse arrives **wearing a number**. A child
 * that catches SIGTERM and exits on its own — which Stryker does — reports a
 * real numeric `143`, not a null status and not a `signal` field, so every
 * check that asks "is the status missing?" waves it straight through to be
 * compared against `1` as though it were a verdict. A CI run measured exactly
 * that: `expected 1, got 143`.
 *
 * Nothing legitimate collides. Stryker's gate exits `0` or `1`; a score is
 * never reported as 129–165.
 *
 * The arithmetic is spelled out in the message on purpose. `143` is a number a
 * reader has to decode; `143 = 128 + 15 (SIGTERM)` is a sentence.
 * @param status - The child's numeric exit code
 * @returns A description of the kill, or `undefined` if this is a real verdict
 */
const signalledExit = (status: number): string | undefined => {
  if (status < SIGNALLED_EXIT_FLOOR || status > SIGNALLED_EXIT_CEILING)
    return undefined;
  const signal = status - 128;
  const name = SIGNAL_NAMES.get(signal) ?? `signal ${signal}`;
  return `exit ${status} = 128 + ${signal} (${name}) — the child was KILLED and translated the signal into an exit code itself, so this is a corpse wearing a number, not a gate verdict`;
};

/**
 * Join whatever of the child's streams survived.
 * @param failure - The thrown `execFileSync` error
 * @returns stdout followed by stderr
 */
const captured = (failure: CaptureFailure): string =>
  `${failure.stdout ?? ""}${failure.stderr ?? ""}`;

/**
 * Describe a capture that never reached a verdict, or `undefined` if it did.
 *
 * Truncation is decided first and independently of the status, because whether
 * an overflow carries a status is a RACE — see {@link gateRunFrom}.
 * @param failure - The thrown `execFileSync` error
 * @param maxBuffer - The bound the capture was run under
 * @returns Why the run produced no verdict, or `undefined` if it produced one
 */
const killedBy = (
  failure: CaptureFailure,
  maxBuffer: number
): string | undefined => {
  if (failure.code === "ENOBUFS")
    return `ENOBUFS — output TRUNCATED at the ${maxBuffer}-byte maxBuffer after ${captured(failure).length} bytes, so there is no score line in it and the exit status attached to it (${String(failure.status)}) is not a verdict`;
  if (typeof failure.status !== "number")
    return failure.code ?? failure.signal ?? "unknown signal";
  return signalledExit(failure.status);
};

/**
 * Classify a caught `execFileSync` failure into a {@link GateRun}.
 *
 * Separated from {@link captureGateRun} because the property that matters most
 * cannot be produced on demand from a child process: **whether an overflow
 * carries an exit status is a race**, so a test that spawns one gets whichever
 * draw it gets. Measured 2026-08-22, `maxBuffer: 4096` against a child writing
 * 16,384 bytes, five runs per form:
 *
 * | child form | node v22.22.0 | bun 1.3.11 |
 * |---|---|---|
 * | `exitCode = 1`, natural exit | `ENOBUFS`, `status: null`, `SIGTERM` | **both shapes seen** |
 * | `writeSync(1, ...)`, `exit(1)` | `ENOBUFS`, `status: null`, `SIGTERM` | `ENOBUFS`, **`status: 1`** |
 * | `stdout.write(...)`, `exit(1)` | **both shapes seen** | `ENOBUFS`, **`status: 1`** |
 *
 * Both runtimes produce `ENOBUFS` with a **real numeric status** on some draws.
 * That is what makes "detect the truncation by a missing status" unsound: on
 * the numeric draw it does not fire, `killedBy` stays unset, and the weakened
 * run's truncated capture is handed back as the status 1 the bite test is
 * looking for — the original defect, arriving intermittently instead of always.
 * `code === "ENOBUFS"` is true on every draw, so it is what decides.
 *
 * Exported so that both measured shapes can be asserted deterministically. The
 * shapes fed to it in tests are transcribed from the table above, not invented.
 * @param failure - The thrown `execFileSync` error
 * @param maxBuffer - The bound the capture was run under
 * @param label - Names the run in the failure text
 * @returns The run, with `status` forced to `null` when there is no verdict
 */
export const gateRunFrom = (
  failure: CaptureFailure,
  maxBuffer: number,
  label: string
): GateRun => {
  const killed = killedBy(failure, maxBuffer);
  return {
    status: killed === undefined ? (failure.status ?? null) : null,
    output: captured(failure),
    ...(killed === undefined ? {} : { killedBy: `${label}: ${killed}` }),
  };
};

/**
 * Run a gate as a child process and report the status it actually returned.
 *
 * ## Four outcomes, kept apart on purpose
 *
 * | what happened | here | how it presents to the bite test |
 * |---|---|---|
 * | exited 0, or 1 | that number | a real verdict |
 * | capture overflowed `maxBuffer` | `status: null`, `killedBy` names the truncation | no verdict claimed |
 * | died with no status at all | `status: null`, `killedBy` names the signal | no verdict claimed |
 * | exited **128 + N** | `status: null`, `killedBy` names the signal and the arithmetic | no verdict claimed |
 *
 * The last row is the one every earlier attempt let through, this module's
 * first draft included. Node enforces `maxBuffer` by killing the child with
 * SIGTERM, so an overflow and a `143` are the same trigger taking two exit
 * paths: `status: null` when the child dies outright, and a numeric `143` when
 * the child catches the signal and translates it itself — which Stryker does.
 * A check that asks "is the status missing?" answers *no* on that path and
 * hands `143` on to be compared against `1`. A CI run measured exactly that:
 * `expected 1, got 143`.
 *
 * It fails loudly either way, which is why it looked acceptable to pass
 * through. But `got 143` is a number the reader has to decode, and it is
 * reported in the slot reserved for verdicts. Naming it as a kill costs
 * nothing — Stryker's gate exits 0 or 1, so nothing legitimate lives in
 * 129–165 — and it stops a corpse being filed as a measurement. Why the
 * SIGTERM arrives at all is CodySwannGT/lisa#2943 and is not this module's.
 *
 * `status` is forced to `null` whenever `killedBy` is set, rather than carrying
 * whatever the runtime attached. That is what makes the fix hold even at a call
 * site that forgets to check `killedBy`: `null` cannot equal 1, so a truncated
 * weakened run fails the assertion instead of satisfying it. The explicit check
 * gives the reader a sentence; this gives them a guarantee.
 * @param options - What to run, and the buffer to run it under
 * @returns The exit status and combined output, or why there is no status
 */
export const captureGateRun = (options: GateCaptureOptions): GateRun => {
  const maxBuffer = options.maxBuffer ?? MAX_GATE_OUTPUT_BYTES;
  try {
    return {
      status: 0,
      output: execFileSync(options.command, [...options.args], {
        cwd: options.cwd,
        encoding: "utf8",
        env: options.env,
        maxBuffer,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return gateRunFrom(error as CaptureFailure, maxBuffer, options.label);
  }
};

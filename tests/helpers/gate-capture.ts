/**
 * Capturing a subprocess gate run without laundering an I/O failure into a
 * verdict.
 *
 * The mutation-gate bite tests run the real gate as a child process and judge
 * it by its exit status. Both of them used to capture it like this:
 *
 * ```ts
 * try {
 *   return { status: 0, output: execFileSync(GATE, args, { encoding: "utf8" }) };
 * } catch (error) {
 *   return { status: failure.status ?? 1, output: `${stdout}${stderr}` };
 * }
 * ```
 *
 * with no `maxBuffer`, so the capture inherited Node's 1 MiB default — and
 * `?? 1` invented an exit status the run never returned. This module replaces
 * both halves. See {@link GATE_MAX_BUFFER} for the buffer and
 * {@link captureGateRun} for why a truncated capture now throws instead of
 * answering.
 *
 * ## Why the coercion is worse than the small buffer
 *
 * The overflow hazard is **one-sided**, and that is the whole reason this is a
 * module rather than one extra option on a call.
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
 * That is why widening the buffer alone is not a fix. It moves the size at
 * which the trap re-arms and leaves the trap. The coercion is the defect; the
 * buffer only sets how often it fires.
 *
 * ## Measured, so the detection is keyed on the right field
 *
 * `execFileSync` with `maxBuffer` exceeded, same child (`exit(1)` after writing
 * past the cap), 2026-08-22 on this repository:
 *
 * | runtime | `code` | `status` | `signal` |
 * |---|---|---|---|
 * | node v22.22.0 | `ENOBUFS` | **`1`** | `null` |
 * | bun 1.3.11 | `ENOBUFS` | `null` | `SIGTERM` |
 *
 * Under Node the truncated run reports a **real numeric `status: 1`**. So
 * "detect the truncation by a missing status" would not have detected it at
 * all under the runtime CI uses, and `failure.status ?? 1` was not even
 * reached: the laundering happened one level up, by treating a status attached
 * to a truncated capture as a verdict. `code === "ENOBUFS"` is the only field
 * that is true on both runtimes, so that is what {@link captureGateRun}
 * branches on, and it branches on it **before** looking at the status.
 * @module tests/helpers/gate-capture
 */
import { execFileSync } from "node:child_process";

/**
 * Ceiling on a captured gate run, in bytes.
 *
 * 64 MiB, and the size of the report today is deliberately not the reason.
 *
 * ## The peak is a burst, so the number is sized against the burst
 *
 * The capture does not fill steadily. Withholding a guard's suites is what the
 * weakened run does, and it turns a large fraction of the mutant population
 * into NoCoverage — which Stryker emits **all at once**, immediately after the
 * dry run. Both observed deaths landed 5–6 minutes in, at exactly that point.
 * So the quantity to bound is not "how big is the report at the end", it is
 * "how many mutants can be reported in one burst", and the worst case of that
 * is the whole population.
 *
 * Measured: a CI capture of the weakened run reached **1,077,240 bytes at
 * ~6,391 mutants** (2026-08-22), cut off mid-mutant-report against the
 * 1,048,576-byte default. That is ~169 bytes per mutant across the mix, and a
 * NoCoverage line — path, position, mutator name — sits at the short end of
 * that mix, so 169 is a conservative per-mutant figure to plan a NoCoverage
 * burst with. Three branches showed the identical signature at 6,391, 6,284 and
 * 6,161 mutants, including one carrying MORE mutants than another, so this is a
 * size the fleet already sits on, not a threshold some single diff crossed.
 *
 * The bound is therefore expressed in mutants: 64 MiB at ~169 bytes each is
 * room for roughly **397,000 mutants reported in a single burst**, against the
 * ~6,400 the current `mutate` list produces from ten guard files (~640 each).
 * Reaching it needs on the order of 620 guards in that list, added one at a
 * time under a threshold ratchet — not a number that arrives by drift.
 *
 * A bound chosen to clear today's *captured size* would be the same mistake at
 * a larger number. The 1 MiB default was adequate for years and then was not,
 * and nothing warned on the way: the gate had already been over 99.9% of it
 * (1,048,331 of 1,048,576) when CodySwannGT/lisa#2944 was written.
 *
 * ## Why bounded at all
 *
 * `Infinity` is available and is the wrong answer. An unbounded capture cannot
 * distinguish a large report from a runaway one, and the failure mode it
 * chooses is the worker exhausting memory — which reports as a kill, with no
 * name on it, exactly the anonymous-death shape this file exists to eliminate.
 * A bound that is reachable only by something qualitatively broken still fails
 * with a sentence.
 *
 * 64 MiB is cheap against the container: two captures held at once is 128 MiB
 * worst case, on runners provisioned in gigabytes.
 *
 * The value is asserted in `tests/unit/helpers/gate-capture.test.ts` so it
 * cannot drift back toward the default without a test naming it.
 */
export const GATE_MAX_BUFFER = 64 * 1024 * 1024;

/** One completed gate run: an exit status the child actually returned. */
export interface GateRun {
  readonly status: number;
  readonly output: string;
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
  /** Defaults to {@link GATE_MAX_BUFFER}; narrowed only to prove the failure. */
  readonly maxBuffer?: number;
}

/** The subset of a `spawnSync` failure this module reads. */
interface CaptureFailure {
  readonly code?: string;
  readonly status?: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

/**
 * Join whatever of the child's streams survived.
 * @param failure - The thrown `execFileSync` error
 * @returns stdout followed by stderr
 */
const captured = (failure: CaptureFailure): string =>
  `${failure.stdout ?? ""}${failure.stderr ?? ""}`;

/**
 * Run a gate as a child process and report the status it actually returned.
 *
 * ## Four outcomes, kept apart on purpose
 *
 * | what happened | here | how it presents to the bite test |
 * |---|---|---|
 * | exited 0 | returned, status 0 | the intact run passing |
 * | exited with any other number | returned, **that number** | a real verdict, or a real 143 |
 * | capture overflowed `maxBuffer` | **throws**, naming the truncation | no verdict claimed |
 * | died with no status at all | **throws**, naming the signal | no verdict claimed |
 *
 * Row two carries the constraint that is easy to lose. A killed run that really
 * does exit **143** (128+15, SIGTERM) is an HONEST failure: it contradicts
 * `expect(weakened.status).toBe(1)` loudly and says so with a number a reader
 * can look up. It has been observed, it is CodySwannGT/lisa#2943, and it is not
 * this module's to fix. So 143 is passed through exactly as received — not
 * rewritten to 1, and not reclassified as truncation. Making the dishonest case
 * honest is worth nothing if it costs the honest case its honesty.
 *
 * Overflow is checked before the status because a truncated capture has no
 * verdict in it regardless of what number the runtime attached — and under Node
 * the number it attaches is a real one, see the table in the module preamble.
 *
 * Throwing rather than returning a fifth "truncated" state is deliberate: every
 * caller reads `.status`, so a returned flag is a field a caller can forget to
 * check, and forgetting it reproduces the defect. A throw fails the case by
 * name at the call site with no cooperation required.
 * @param options - What to run, and the buffer to run it under
 * @throws {Error} When the capture is truncated, or the child returns no exit status
 * @returns The exit status and combined output
 */
export const captureGateRun = (options: GateCaptureOptions): GateRun => {
  const maxBuffer = options.maxBuffer ?? GATE_MAX_BUFFER;
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
    const failure = error as CaptureFailure;
    if (failure.code === "ENOBUFS") {
      throw new Error(
        `${options.label}: gate output TRUNCATED — the capture exceeded its ` +
          `${maxBuffer}-byte maxBuffer (ENOBUFS) after ${captured(failure).length} ` +
          `bytes. A truncated capture is an I/O failure, not a gate verdict: ` +
          `there is no score line in it, and any exit status attached to it ` +
          `(this runtime reported ${String(failure.status)}) must not be read ` +
          `as one. Raise GATE_MAX_BUFFER in tests/helpers/gate-capture.ts.`
      );
    }
    if (typeof failure.status !== "number") {
      throw new Error(
        `${options.label}: the gate returned NO exit status — killed by ` +
          `${String(failure.signal)}, not failed. Reporting this as status 1 ` +
          `would invent a verdict the run never produced. Captured ` +
          `${captured(failure).length} bytes:\n${captured(failure)}`
      );
    }
    return { status: failure.status, output: captured(failure) };
  }
};

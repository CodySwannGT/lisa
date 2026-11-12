/**
 * A stderr write that is safe from inside an `exit` listener.
 *
 * Node runs `exit` listeners synchronously and abandons any work they queue,
 * and where a piped stderr is asynchronous (measured on macOS; Node documents
 * pipe writes as platform-dependent) the write can still be queued. Under CI
 * log capture or the `lisa-test-run` supervisor stderr is a pipe, so a
 * diagnostic written there with `process.stderr.write` can be lost at exit
 * (CodySwannGT/lisa#4621). This writes to the descriptor with `writeSync`,
 * retries a pipe that is momentarily full (`EAGAIN`) a bounded number of
 * times, and never throws: an exception thrown from an exit listener crashes
 * the process and skips every later listener.
 * @module tests/helpers/stderr-sync
 */
import { writeSync } from "node:fs";

/** How many `writeSync` calls one message may take, retries included. */
const STDERR_WRITE_ATTEMPTS = 100;

/**
 * Write the rest of a message, one attempt per call.
 * @param bytes - The whole message
 * @param offset - How much of it is already written
 * @param attemptsLeft - Calls still allowed
 */
function writeRest(bytes: Buffer, offset: number, attemptsLeft: number): void {
  if (offset >= bytes.length || attemptsLeft <= 0) return;
  try {
    const written = writeSync(process.stderr.fd, bytes, offset);
    writeRest(bytes, offset + written, attemptsLeft - 1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EAGAIN") return;
    if (attemptsLeft > 1) pauseBriefly();
    writeRest(bytes, offset, attemptsLeft - 1);
  }
}

/**
 * Block for about a millisecond so a full pipe can drain.
 *
 * Synchronous on purpose: this runs inside `exit` listeners, where nothing
 * queued would ever run. With {@link STDERR_WRITE_ATTEMPTS} attempts the
 * total wait stays near 100ms rather than spinning the CPU.
 */
function pauseBriefly(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
}

/**
 * Write a message to stderr synchronously. Never throws.
 * @param message - The text to write
 */
export function writeStderrSync(message: string): void {
  try {
    writeRest(Buffer.from(message, "utf8"), 0, STDERR_WRITE_ATTEMPTS);
  } catch {
    // Nowhere is left to report a failure to report; the caller must go on.
  }
}

/**
 * A thrown value's message.
 * @param error - Whatever was thrown
 * @returns Its message, or its string form
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

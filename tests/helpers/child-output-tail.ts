/**
 * Render what a killed child printed, bounded, for its timeout diagnostic.
 *
 * CodySwannGT/lisa#4896. `check-learnings-budget.test.ts` failed four times in
 * CI with `spawnSync .../bun ETIMEDOUT` on a child that normally finishes in
 * 30-60ms, and every time the diagnostic threw the child's streams away. A
 * child that printed its verdict and then failed to exit, and a child that
 * never started its work, produced the same message — so the one fact that
 * would have located the hang was the one fact not reported. The streams are
 * now kept, bounded to a tail so a chatty child cannot bury the message.
 * @module tests/helpers/child-output-tail
 */

/**
 * Bytes of each stream kept in a diagnostic.
 *
 * The tail rather than the head, because the last thing a child printed is
 * closest to where it stopped.
 */
export const CHILD_OUTPUT_TAIL_BYTES = 4_096;

/** One captured stream, as `spawnSync` returns it under either encoding. */
export type CapturedStream = string | Buffer | null | undefined;

/** How long a killed child ran, and the timeout it was held to. */
export interface ChildTiming {
  /** The `timeout` passed to `spawnSync`, in milliseconds. */
  readonly timeoutMs: number;
  /** Wall time the `spawnSync` call took, in milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Render a duration grouped in thousands, so it reads like the budgets do.
 * @param value - A duration in milliseconds
 * @returns e.g. `12,248ms`
 */
function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")}ms`;
}

/**
 * Describe the timing of a killed child, or nothing when it was not measured.
 * @param timing - Elapsed time and timeout, when the caller measured them
 * @returns A clause to append to the cause, starting with a space, or ""
 */
export function describeChildTiming(timing: ChildTiming | undefined): string {
  if (timing === undefined) return "";
  return (
    ` after ${formatMs(timing.elapsedMs)} against a ` +
    `${formatMs(timing.timeoutMs)} timeout`
  );
}

/**
 * Render one stream's tail under a labelled heading.
 * @param name - Stream name, `stdout` or `stderr`
 * @param stream - What the child wrote to it
 * @returns The labelled tail, or a line saying the stream was empty
 */
function renderStream(name: string, stream: CapturedStream): string {
  const bytes =
    stream === null || stream === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(stream)
        ? stream
        : Buffer.from(stream, "utf8");
  if (bytes.length === 0) return `${name}: (empty)`;
  if (bytes.length <= CHILD_OUTPUT_TAIL_BYTES) {
    return `${name} (${bytes.length} bytes):\n${bytes.toString("utf8")}`;
  }
  const tail = bytes.subarray(bytes.length - CHILD_OUTPUT_TAIL_BYTES);
  return `${name} (last ${CHILD_OUTPUT_TAIL_BYTES} of ${bytes.length} bytes):\n${tail.toString("utf8")}`;
}

/**
 * Render both captured streams of a child that did not complete.
 * @param stdout - What the child wrote to stdout before it was stopped
 * @param stderr - What the child wrote to stderr before it was stopped
 * @returns A block to append to the diagnostic, starting with a newline
 */
export function describeChildOutput(
  stdout: CapturedStream,
  stderr: CapturedStream
): string {
  return (
    `\nWhat the child printed before it was stopped:\n` +
    `${renderStream("stdout", stdout)}\n${renderStream("stderr", stderr)}`
  );
}

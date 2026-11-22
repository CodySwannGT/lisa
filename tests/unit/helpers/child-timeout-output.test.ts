/**
 * Tests that a timed-out child's diagnostic carries what the child printed.
 *
 * CodySwannGT/lisa#4896. `check-learnings-budget.test.ts` failed four times in
 * CI with `spawnSync .../bun ETIMEDOUT`, each time on a child that normally
 * finishes in 30-60ms. The diagnostic discarded the child's streams, so nothing
 * could say whether the child hung before doing its work or after printing its
 * verdict — the one fact that separates a hung child from a stalled parent.
 * These cases pin that the kill diagnostic now keeps a bounded tail of both
 * streams, plus the elapsed time and the timeout it was held to.
 * @module tests/unit/helpers/child-timeout-output
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  assertChildCompleted,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { CHILD_OUTPUT_TAIL_BYTES } from "../../helpers/child-output-tail.js";

/** A child that prints to both streams, then never exits on its own. */
const PRINT_THEN_HANG = [
  "process.stdout.write('stdout-before-hang');",
  "process.stderr.write('stderr-before-hang');",
  "setInterval(() => {}, 1000);",
].join(" ");

/** Short raw timeout for the direct `spawnSync` cases, in milliseconds. */
const RAW_TIMEOUT_MS = 1_500;

/**
 * Run the printing, hanging child under a raw `spawnSync` timeout.
 * @returns The outcome and how long the call took
 */
function runHangingChild(): {
  readonly outcome: ReturnType<typeof spawnSync>;
  readonly elapsedMs: number;
} {
  const started = Date.now();
  const outcome = spawnSync(process.execPath, ["-e", PRINT_THEN_HANG], {
    encoding: "utf8",
    timeout: RAW_TIMEOUT_MS,
  });
  return { outcome, elapsedMs: Date.now() - started };
}

/**
 * Capture the message `assertChildCompleted` throws, or fail the case.
 * @param run - Call expected to throw
 * @returns The thrown message
 */
function thrownMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the call to throw, and it returned");
}

describe("timed-out child diagnostics", () => {
  it("includes what the child printed before it was killed", () => {
    const { outcome, elapsedMs } = runHangingChild();

    const message = thrownMessage(() =>
      assertChildCompleted(outcome, "hanging child", undefined, {
        timeoutMs: RAW_TIMEOUT_MS,
        elapsedMs,
      })
    );

    expect(message).toMatch(/^hanging child did not complete: .*ETIMEDOUT/u);
    expect(message).toContain("stdout-before-hang");
    expect(message).toContain("stderr-before-hang");
  });

  it("states the elapsed time and the timeout the child was held to", () => {
    const { outcome } = runHangingChild();

    const message = thrownMessage(() =>
      assertChildCompleted(outcome, "hanging child", undefined, {
        timeoutMs: RAW_TIMEOUT_MS,
        elapsedMs: 1_612,
      })
    );

    expect(message).toContain("after 1,612ms against a 1,500ms timeout");
  });

  it("does the same through boundedSpawnSync, which measures its own timing", () => {
    const message = thrownMessage(() =>
      boundedSpawnSync({
        label: "bounded hanging child",
        command: process.execPath,
        args: ["-e", PRINT_THEN_HANG],
        baseMs: 1_000,
      })
    );

    expect(message).toContain("stdout-before-hang");
    expect(message).toContain("stderr-before-hang");
    expect(message).toMatch(/after [\d,]+ms against a [\d,]+ms timeout/u);
  });

  it("keeps only the last few KB of each stream", () => {
    const early = "EARLY-".repeat(2_000);
    const late = "LATE-MARKER";
    const message = thrownMessage(() =>
      assertChildCompleted(
        {
          error: Object.assign(new Error("spawnSync node ETIMEDOUT"), {
            code: "ETIMEDOUT",
          }),
          signal: "SIGTERM",
          status: null,
          stdout: `${early}${late}`,
          stderr: Buffer.from("stderr as a buffer"),
        },
        "noisy child"
      )
    );

    expect(message).toContain(late);
    expect(message).toContain("stderr as a buffer");
    expect(message).not.toContain(early);
    expect(message).toContain(
      `last ${CHILD_OUTPUT_TAIL_BYTES} of ${early.length + late.length} bytes`
    );
  });

  it("says a stream was empty rather than omitting it", () => {
    const message = thrownMessage(() =>
      assertChildCompleted(
        { error: undefined, signal: "SIGKILL", stdout: "", stderr: null },
        "silent child"
      )
    );

    expect(message).toContain("stdout: (empty)");
    expect(message).toContain("stderr: (empty)");
  });

  it("leaves a completed child alone, whatever it printed", () => {
    expect(() =>
      assertChildCompleted(
        { error: undefined, signal: null, status: 0, stdout: "ok" },
        "fine child"
      )
    ).not.toThrow();
  });
});

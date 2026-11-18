/**
 * Killing a detached child's process group never waits on a close it missed,
 * and never waits on a close without a bound (CodySwannGT/lisa#5034).
 *
 * The Sonar hook's mid-resolve kill case attached its `close` listener only
 * after an earlier await, and then waited on it with no bound. A child that
 * closed inside that window was never seen, so the case hung until vitest
 * killed it with an anonymous timeout. These cases stage both halves.
 * @module tests/unit/hooks/process-group
 */
import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { killGroupAndAwaitClose, watchChild } from "./support/process-group.js";

useIoLatencyBudget();

/** Quiet-box bound for the never-closing case, kept short on purpose. */
const SHORT_CLOSE_BASE_MS = 250;

describe("killGroupAndAwaitClose", () => {
  it("resolves for a child that closed before the wait began", async () => {
    const child = spawn("/bin/sh", ["-c", "exit 3"], {
      detached: true,
      stdio: "pipe",
    });
    const watched = watchChild(child);
    // The staged race: the child is fully closed before anything waits on it.
    await once(child, "close");

    await expect(
      killGroupAndAwaitClose(watched, SHORT_CLOSE_BASE_MS)
    ).resolves.toEqual({ code: 3, signal: null });
    expect(watched.isClosed()).toBe(true);
  });

  it("returns the kill signal for a child it killed", async () => {
    const child = spawn("/bin/sh", ["-c", "sleep 30"], {
      detached: true,
      stdio: "pipe",
    });
    const watched = watchChild(child);
    await once(child, "spawn");

    await expect(
      killGroupAndAwaitClose(watched, SHORT_CLOSE_BASE_MS)
    ).resolves.toEqual({ code: null, signal: "SIGKILL" });
    expect(watched.isClosed()).toBe(true);
  });

  it("names the child when its close never arrives, instead of hanging", async () => {
    // A grandchild that leaves the group keeps the child's stdout open, so
    // killing the group cannot close the child's streams.
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `perl -e 'setpgrp(0, 0); print STDERR "$$\\n"; sleep 30' & read _ < /dev/null; sleep 30`,
      ],
      { detached: true, stdio: "pipe" }
    );
    const watched = watchChild(child);
    const [pidLine] = (await once(child.stderr, "data")) as [Buffer];
    const escaped = Number.parseInt(pidLine.toString("utf8"), 10);
    try {
      await expect(
        killGroupAndAwaitClose(watched, SHORT_CLOSE_BASE_MS)
      ).rejects.toThrow(
        new RegExp(
          `pid ${String(child.pid)} did not close within [0-9,]+ms after SIGKILL to its group \\(exit code null, signal SIGKILL\\)`,
          "u"
        )
      );
    } finally {
      process.kill(escaped, "SIGKILL");
    }
  });
});

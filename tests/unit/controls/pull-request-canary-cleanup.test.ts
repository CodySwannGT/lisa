/**
 * Canaries are removed on every way a run can end (CodySwannGT/lisa#4997).
 *
 * A canary left behind is a stray pull request in somebody's repository. So
 * each way a run can end is exercised here against the in-memory platform:
 * an exception in the middle of a proof, a termination signal, and being
 * killed outright, after which only the next run's sweep can clean up. The
 * sweep must also leave alone whatever another run may still be using.
 * @module tests/unit/controls/pull-request-canary-cleanup
 */
import { afterEach, describe, expect, it } from "vitest";

import { CANARY_LIFETIME_SECONDS } from "../../../src/controls/canary-names.js";
import { STOP_SIGNALS } from "../../../src/controls/canary-lifecycle.js";
import {
  RUN_ID,
  canaryPlatform,
  expectNoMerge,
  expectNothingLeft,
  fakeSignals,
  settleWithCanaries,
} from "./support/canary-run.js";
import type { FakeCanaryPlatform } from "./support/fake-canary-platform.js";
import { removeCopies, steppingClock } from "./support/proof-run.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
  entryOf,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

/** The identifier of the run that comes second in a case. */
const LATER_RUN = "run0000b";

/** When the first run of a case starts. */
const FIRST_START = "2026-02-01T00:00:00.000Z";

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * A moment some seconds after the first run started.
 * @param seconds - How many
 * @returns The moment, as text
 */
function after(seconds: number): string {
  return new Date(Date.parse(FIRST_START) + seconds * 1000).toISOString();
}

/**
 * Start a run and abandon it while its first canary is open, the way a
 * process that is killed outright does: nothing of it runs again.
 * @param platform - The in-memory platform
 * @returns The canary branch the run left behind
 */
async function killedMidProof(platform: FakeCanaryPlatform): Promise<string> {
  platform.pendingLooks = Number.POSITIVE_INFINITY;
  const reached = new Promise<void>(resolve => {
    void settleWithCanaries(PULL_ONLY_GATES, platform, {
      dependencies: {
        // The pause never ends: the run is never heard from again.
        sleep: () => {
          resolve();
          return new Promise(() => undefined);
        },
      },
    });
  });
  await reached;
  platform.pendingLooks = 0;
  const [left] = platform.branches().filter(branch => branch !== "main");
  if (left === undefined) throw new Error("the killed run left no canary");
  return left;
}

describe("a run that ends normally", () => {
  it("stops listening for termination signals", async () => {
    const platform = canaryPlatform();
    const signals = fakeSignals();

    await settleWithCanaries(PULL_ONLY_GATES, platform, { signals });

    expect(signals.listening()).toEqual([]);
    expect(signals.terminated).toEqual([]);
    expectNothingLeft(platform);
  });
});

describe("a run that throws in the middle of a proof", () => {
  it("removes its canary before the exception leaves", async () => {
    const signals = fakeSignals();
    const platform = canaryPlatform({
      onRequest: request => {
        if (request.path.includes("/check-runs")) {
          throw new Error("the connection dropped");
        }
      },
    });

    await expect(
      settleWithCanaries(PULL_ONLY_GATES, platform, { signals })
    ).rejects.toThrow("the connection dropped");

    expect(platform.pulls()).toHaveLength(1);
    expectNothingLeft(platform);
    expect(signals.listening()).toEqual([]);
    expectNoMerge(platform.log);
  });
});

describe("a run that is told to stop", () => {
  it.each(STOP_SIGNALS)(
    "removes its canary on %s and only then lets the signal end the process",
    async signal => {
      const platform = canaryPlatform();
      platform.pendingLooks = Number.POSITIVE_INFINITY;
      const signals = fakeSignals();
      const seen: { open: number; terminated: number }[] = [];

      await expect(
        settleWithCanaries(PULL_ONLY_GATES, platform, {
          signals,
          dependencies: {
            terminate: stopped => {
              // What the platform holds at the moment the process would end.
              seen.push({
                open: platform.pulls().filter(pull => pull.state === "open")
                  .length,
                terminated: signals.terminated.length,
              });
              signals.terminate(stopped);
              throw new Error(`ended by ${stopped}`);
            },
            sleep: () => {
              expect(platform.branches()).toHaveLength(2);
              signals.emit(signal);
              return Promise.resolve();
            },
          },
        })
      ).rejects.toThrow(`ended by ${signal}`);

      expect(seen).toEqual([{ open: 0, terminated: 0 }]);
      expect(signals.terminated).toEqual([signal]);
      expect(signals.listening()).toEqual([]);
      expectNothingLeft(platform);
      expectNoMerge(platform.log);
    }
  );
});

describe("a run that is killed outright", () => {
  it("leaves a canary that the next run removes once it is older than the lifetime", async () => {
    const platform = canaryPlatform();
    const left = await killedMidProof(platform);
    expect(platform.pulls().map(pull => pull.state)).toEqual(["open"]);
    const sent = platform.log.length;

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform, {
      inputs: { clock: steppingClock(after(CANARY_LIFETIME_SECONDS + 60)) },
      dependencies: { runId: () => LATER_RUN },
    });

    expect(settled.pullRequest?.sweep).toEqual({
      removed: [left],
      kept: [],
      problems: [],
    });
    // The stale pull request is closed, then its branch is deleted.
    expect(
      platform.log
        .slice(sent)
        .filter(request => request.method !== "GET")
        .slice(0, 2)
        .map(request => `${request.method} ${request.path}`)
    ).toEqual([
      "PATCH repos/example-owner/example-repo/pulls/1",
      `DELETE repos/example-owner/example-repo/git/refs/heads/${left}`,
    ]);
    expect(entryOf(settled, PULL_ONLY_ENTRY).outcome).toBe("passed");
    // Zero canaries older than the lifetime remain, and none at all.
    expectNothingLeft(platform);
    expectNoMerge(platform.log);
  });

  it("is not touched by a run that starts while it may still be going", async () => {
    const platform = canaryPlatform();
    const left = await killedMidProof(platform);
    const sent = platform.log.length;

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform, {
      inputs: { clock: steppingClock(after(CANARY_LIFETIME_SECONDS - 60)) },
      dependencies: { runId: () => LATER_RUN },
    });

    expect(settled.pullRequest?.sweep).toEqual({
      removed: [],
      kept: [{ branch: left, why: "live" }],
      problems: [],
    });
    // The other run's canary is exactly as it was: branch and pull request.
    expect(platform.branches()).toEqual(["main", left]);
    expect(
      platform.pulls().map(pull => [pull.head, pull.state, pull.merged])
    ).toEqual([
      [left, "open", false],
      [expect.stringContaining(LATER_RUN), "closed", false],
      [expect.stringContaining(LATER_RUN), "closed", false],
    ]);
    // Nothing the second run sent names the other run's canary.
    expect(
      platform.log
        .slice(sent)
        .filter(
          request =>
            request.path.includes(RUN_ID) ||
            JSON.stringify(request.body ?? {}).includes(RUN_ID)
        )
    ).toEqual([]);
    expect(entryOf(settled, PULL_ONLY_ENTRY).outcome).toBe("passed");
  });
});

describe("a branch under the reserved prefix that is not a canary's", () => {
  it("is left alone however old the run is", async () => {
    const platform = canaryPlatform();
    const main = platform.head("main") ?? "";
    platform.gh(
      [
        "api",
        "-X",
        "POST",
        "repos/example-owner/example-repo/git/refs",
        "--input",
        "-",
      ],
      {
        input: JSON.stringify({
          ref: "refs/heads/lisa-attest/notes",
          sha: main,
        }),
      }
    );

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform, {
      inputs: { clock: steppingClock(after(CANARY_LIFETIME_SECONDS * 100)) },
    });

    expect(settled.pullRequest?.sweep).toEqual({
      removed: [],
      kept: [{ branch: "lisa-attest/notes", why: "unrecognised" }],
      problems: [],
    });
    expect(platform.branches()).toEqual(["main", "lisa-attest/notes"]);
  });
});

describe("a canary the platform will not let go of", () => {
  it("is tried again, and what was left behind is on the record", async () => {
    const platform = canaryPlatform({
      refuse: request =>
        request.method === "DELETE" ? "Server Error" : undefined,
    });

    const settled = await settleWithCanaries(PULL_ONLY_GATES, platform);

    const [violation] = settled.pullRequest?.canaries ?? [];
    expect(violation).toMatchObject({
      closed: true,
      branch_removed: false,
    });
    expect(violation?.cleanup_problem).toContain("Server Error");
    // Once when the half ended, once more when the run ended.
    expect(
      platform.log.filter(
        request =>
          request.method === "DELETE" &&
          request.path.endsWith(violation?.branch ?? "-")
      )
    ).toHaveLength(2);
    // Even then the pull request is closed, so nothing waits to be merged.
    expect(platform.pulls().filter(pull => pull.state === "open")).toEqual([]);
    expectNoMerge(platform.log);
  });
});

/**
 * Removing canaries when the platform misbehaves
 * (CodySwannGT/lisa#4997).
 *
 * The ordinary ways a run ends are covered in
 * `./pull-request-canary-cleanup.test.ts`. This file covers what must hold
 * even when an answer is wrong, a request throws, or an interrupt arrives
 * twice: nobody's own pull request is ever closed, a failed step never skips
 * the next, and a canary is only called removed when the platform said so.
 * @module tests/unit/controls/canary-removal
 */
import { describe, expect, it } from "vitest";

import {
  canaryDoor,
  type Answered,
  type CanaryDoor,
} from "../../../src/controls/canary-door.js";
import {
  canaryKeeper,
  removeOnStop,
  sweepCanaries,
} from "../../../src/controls/canary-lifecycle.js";
import {
  CANARY_LIFETIME_SECONDS,
  canaryBranch,
} from "../../../src/controls/canary-names.js";
import { recordRequests } from "../../../src/controls/protect-requests.js";
import { canaryPlatform, fakeSignals } from "./support/canary-run.js";
import type { FakeCanaryPlatform } from "./support/fake-canary-platform.js";
import { REPO } from "./support/protect-fixture.js";

const BASE = `repos/${REPO}`;
const MADE = new Date("2026-02-01T00:00:00.000Z");

/** Long after {@link MADE}: every canary made then is stale. */
const MUCH_LATER = new Date(
  MADE.getTime() + CANARY_LIFETIME_SECONDS * 10 * 1000
);

/** A canary another run made at {@link MADE}. */
const STALE = canaryBranch({
  runId: "run0000b",
  createdAt: MADE,
  sequence: 1,
  half: "violation",
});

/** This run, sweeping long after. */
const SWEEPER = {
  runId: "run0000a",
  now: MUCH_LATER,
  lifetimeSeconds: CANARY_LIFETIME_SECONDS,
};

/**
 * Send one write straight to the in-memory platform, as a person would.
 * @param platform - The platform
 * @param method - The method
 * @param path - The path under the repository
 * @param body - The request body
 */
function byHand(
  platform: FakeCanaryPlatform,
  method: string,
  path: string,
  body: unknown
): void {
  platform.gh(["api", "-X", method, `${BASE}/${path}`, "--input", "-"], {
    input: JSON.stringify(body),
  });
}

/**
 * Create a branch and open a pull request from it, as a person would.
 * @param platform - The platform
 * @param branch - The branch name
 */
function openFrom(platform: FakeCanaryPlatform, branch: string): void {
  byHand(platform, "POST", "git/refs", {
    ref: `refs/heads/${branch}`,
    sha: platform.head("main"),
  });
  byHand(platform, "POST", "pulls", {
    head: branch,
    base: "main",
    title: branch,
    body: "",
  });
}

/**
 * The door a canary run writes through, over the in-memory platform.
 * @param platform - The platform
 * @returns The door
 */
function doorOver(platform: FakeCanaryPlatform): CanaryDoor {
  return canaryDoor(recordRequests(platform.gh), REPO, true);
}

/**
 * The state of every pull request, by the branch it was opened from.
 * @param platform - The platform
 * @returns For example `{ feature: "open" }`
 */
function states(platform: FakeCanaryPlatform): Record<string, string> {
  return Object.fromEntries(
    platform.pulls().map(pull => [pull.head, pull.state])
  );
}

describe("the sweep, when the platform answers with pull requests it was not asked for", () => {
  it("closes the stale canary's pull request and nobody else's", () => {
    const platform = canaryPlatform({ ignoresHeadFilter: true });
    openFrom(platform, "feature/somebody-elses-work");
    openFrom(platform, STALE);

    const sweep = sweepCanaries(doorOver(platform), SWEEPER);

    expect(sweep).toEqual({ removed: [STALE], kept: [], problems: [] });
    expect(states(platform)).toEqual({
      "feature/somebody-elses-work": "open",
      [STALE]: "closed",
    });
    expect(platform.branches()).toEqual([
      "main",
      "feature/somebody-elses-work",
    ]);
  });
});

describe("the sweep, when the list of branches never ends", () => {
  it("stops asking after ten pages and removes each branch once", () => {
    const asked: string[] = [];
    const deleted: string[] = [];
    const page = Array.from({ length: 100 }, () => ({
      ref: `refs/heads/${STALE}`,
    }));
    const door: CanaryDoor = {
      repository: REPO,
      get: path => {
        asked.push(path);
        return { ok: true, value: path.startsWith("git/") ? page : [] };
      },
      send: (method, path) => {
        if (method === "DELETE") deleted.push(path);
        return { ok: true, value: null };
      },
    };

    const sweep = sweepCanaries(door, SWEEPER);

    expect(asked.filter(path => path.startsWith("git/"))).toHaveLength(10);
    expect(deleted).toEqual([`git/refs/heads/${STALE}`]);
    expect(sweep.removed).toEqual([STALE]);
  });
});

describe("removing one canary", () => {
  /**
   * A door whose answers are scripted, recording what it was sent.
   * @param answer - Answers one write, or throws
   * @returns The door and what it was sent
   */
  function scripted(answer: (method: string) => Answered): {
    readonly door: CanaryDoor;
    readonly sent: string[];
  } {
    const sent: string[] = [];
    return {
      sent,
      door: {
        repository: REPO,
        get: () => ({ ok: true, value: null }),
        send: (method, path) => {
          sent.push(`${method} ${path}`);
          return answer(method);
        },
      },
    };
  }

  it("still deletes the branch when closing the pull request throws", () => {
    const { door, sent } = scripted(method => {
      if (method === "PATCH") throw new Error("the connection dropped");
      return { ok: true, value: null };
    });
    const keeper = canaryKeeper(door);
    keeper.track(STALE);
    keeper.opened(STALE, 7);

    const removal = keeper.remove(STALE);

    expect(sent).toEqual(["PATCH pulls/7", `DELETE git/refs/heads/${STALE}`]);
    expect(removal).toMatchObject({ branchRemoved: true, problem: null });
    expect(keeper.open()).toEqual([]);
  });

  it("counts a branch as gone when the platform says the reference does not exist", () => {
    const { door } = scripted(() => ({
      ok: false,
      reason: "gh: Reference does not exist (HTTP 422)",
    }));
    const keeper = canaryKeeper(door);
    keeper.track(STALE);

    expect(keeper.remove(STALE)).toMatchObject({ branchRemoved: true });
    expect(keeper.open()).toEqual([]);
  });

  it.each(["gh: Not Found (HTTP 404)", "gh: Server Error (HTTP 500)"])(
    "keeps a canary tracked when the delete was answered %s",
    reason => {
      const { door } = scripted(() => ({ ok: false, reason }));
      const keeper = canaryKeeper(door);
      keeper.track(STALE);

      const removal = keeper.remove(STALE);

      expect(removal.branchRemoved).toBe(false);
      expect(removal.problem).toContain(reason);
      expect(keeper.open()).toEqual([STALE]);
    }
  );
});

describe("a second interrupt while a canary is being removed", () => {
  it("is answered by trying the removal once more before the process ends", () => {
    const attempts = { deletes: 0 };
    const door: CanaryDoor = {
      repository: REPO,
      get: () => ({ ok: true, value: null }),
      send: method => {
        if (method !== "DELETE") return { ok: true, value: null };
        attempts.deletes += 1;
        // The first delete is killed by the second interrupt.
        return attempts.deletes === 1
          ? { ok: false, reason: "gh was killed" }
          : { ok: true, value: null };
      },
    };
    const keeper = canaryKeeper(door);
    const signals = fakeSignals();
    keeper.track(STALE);
    removeOnStop(keeper, signals.source, signals.terminate);

    signals.emit("SIGINT");

    expect(attempts.deletes).toBe(2);
    expect(keeper.open()).toEqual([]);
    expect(signals.terminated).toEqual(["SIGINT"]);
  });
});

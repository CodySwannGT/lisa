/**
 * Which result counts as an entry's required check on a canary
 * (CodySwannGT/lisa#4997).
 *
 * A required check is a name and, where the platform's settings say so, the
 * one app allowed to report it. A result under the right name from any other
 * source does not satisfy the requirement on the platform, so it must not
 * decide a proof either: an entry may only pass on what the required check
 * itself reported.
 * @module tests/unit/controls/canary-eligibility-apps
 */
import { afterEach, describe, expect, it } from "vitest";

import type { CanaryDoor } from "../../../src/controls/canary-door.js";
import { readEligibility } from "../../../src/controls/canary-eligibility.js";
import { provedGates } from "../../helpers/control-proofs.js";
import {
  canaryPlatform,
  expectNothingLeft,
  settleWithCanaries,
} from "./support/canary-run.js";
import { ACTIONS_APP_ID } from "./support/fake-github.js";
import { removeCopies } from "./support/proof-run.js";
import {
  PULL_ONLY_CHECK,
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATE,
  WORKING,
  entryOf,
  pointOf,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const LINT = "Lint";
const SHA = "a".repeat(40);

/** The app the check is pinned to, and two that it is not. */
const PINNED = 101;
const ALSO_PINNED = 102;
const SOMEONE_ELSE = 999;

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * One finished check run.
 * @param id - Its id; a higher one is newer
 * @param app - The app that reported it
 * @param conclusion - What it concluded
 * @returns The run as the platform returns it
 */
function run(
  id: number,
  app: number,
  conclusion: string
): Record<string, unknown> {
  return { id, name: LINT, app: { id: app }, status: "completed", conclusion };
}

/**
 * What a look at a canary shows for the lint check.
 * @param apps - The apps the check is pinned to
 * @param runs - The commit's check runs
 * @param statuses - The commit's statuses
 * @returns The check's conclusion, and the paths that were asked for
 */
function concluded(
  apps: readonly number[],
  runs: readonly Record<string, unknown>[],
  statuses: readonly Record<string, unknown>[] = []
): { readonly conclusion: string | null; readonly asked: readonly string[] } {
  const asked: string[] = [];
  const answers: readonly (readonly [string, unknown])[] = [
    ["pulls/7", { mergeable: true, mergeable_state: "draft" }],
    ["/check-runs", { check_runs: runs }],
    ["/status", { statuses }],
  ];
  const door: CanaryDoor = {
    repository: "example-owner/example-repo",
    get: path => {
      asked.push(path);
      const found = answers.find(([part]) => path.includes(part));
      return found === undefined
        ? { ok: false, reason: "Not Found" }
        : { ok: true, value: found[1] };
    },
    send: () => ({ ok: false, reason: "this door does not write" }),
  };
  const read = readEligibility(door, 7, SHA, [
    { context: LINT, app_ids: apps },
  ]);
  return {
    conclusion: read.ok ? (read.eligibility.checks[0]?.conclusion ?? null) : "",
    asked,
  };
}

describe("a check the settings pin to one app", () => {
  it("is read from that app's run", () => {
    expect(concluded([PINNED], [run(1, PINNED, "failure")]).conclusion).toBe(
      "failure"
    );
  });

  it("has not reported while only another app has reported under its name", () => {
    expect(
      concluded([PINNED], [run(1, SOMEONE_ELSE, "failure")]).conclusion
    ).toBeNull();
    expect(
      concluded([PINNED], [run(1, SOMEONE_ELSE, "success")]).conclusion
    ).toBeNull();
  });

  it("is not decided by a newer run of another app", () => {
    expect(
      concluded(
        [PINNED],
        [run(1, PINNED, "failure"), run(2, SOMEONE_ELSE, "success")]
      ).conclusion
    ).toBe("failure");
  });

  it("is never read from a commit status, which does not say who wrote it", () => {
    const read = concluded([PINNED], [], [{ context: LINT, state: "success" }]);

    expect(read.conclusion).toBeNull();
    expect(read.asked.filter(path => path.includes("/status"))).toEqual([]);
  });
});

describe("a check the settings pin to more than one app", () => {
  it("has failed as soon as one of them failed", () => {
    expect(
      concluded([PINNED, ALSO_PINNED], [run(1, PINNED, "failure")]).conclusion
    ).toBe("failure");
  });

  it("has not reported until every one of them has", () => {
    expect(
      concluded([PINNED, ALSO_PINNED], [run(1, PINNED, "success")]).conclusion
    ).toBeNull();
  });

  it("has passed only when every one of them passed", () => {
    expect(
      concluded(
        [PINNED, ALSO_PINNED],
        [run(1, PINNED, "success"), run(2, ALSO_PINNED, "success")]
      ).conclusion
    ).toBe("success");
    expect(
      concluded(
        [PINNED, ALSO_PINNED],
        [run(1, PINNED, "success"), run(2, ALSO_PINNED, "skipped")]
      ).conclusion
    ).toBe("skipped");
  });
});

describe("a canary whose check name is only reported by another app", () => {
  it("is unknown, never passed, though the other app failed the violation and passed the clean change", async () => {
    const platform = canaryPlatform({ reportedBy: SOMEONE_ELSE });

    const settled = await settleWithCanaries(
      provedGates([{ command: WORKING, timeout_seconds: 3 }], PULL_ONLY_GATE, [
        "pull-request",
      ]),
      platform
    );

    expect(pointOf(settled, PULL_ONLY_ENTRY).checks).toEqual([
      {
        context: PULL_ONLY_CHECK,
        state: "required",
        app_ids: [ACTIONS_APP_ID],
      },
    ]);
    expect(entryOf(settled, PULL_ONLY_ENTRY)).toMatchObject({
      outcome: "unknown",
      reason: "timed-out",
      rung: "exercised",
    });
    expect(settled.passed).toBe(false);
    expectNothingLeft(platform);
  });
});

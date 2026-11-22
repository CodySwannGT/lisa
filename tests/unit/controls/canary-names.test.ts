/**
 * How a canary is named, and how a name says whether it may be removed
 * (CodySwannGT/lisa#4997).
 *
 * A canary branch is the only thing `lisa controls attest` ever deletes on a
 * hosting platform, so the rule for which branch that may be is checked on
 * its own, with no platform involved: the name carries the run that made it
 * and the time it was made, and a name that does not say both is never
 * touched.
 * @module tests/unit/controls/canary-names
 */
import { describe, expect, it } from "vitest";

import {
  CANARY_BRANCH_PREFIX,
  CANARY_LIFETIME_SECONDS,
  canaryBody,
  canaryBranch,
  canaryStanding,
  canaryTitle,
  isRunId,
  newRunId,
  parseCanaryBranch,
} from "../../../src/controls/canary-names.js";

const RUN = "run0000a";
const OTHER_RUN = "run0000b";
const MADE = new Date("2026-03-04T05:06:07.000Z");

/**
 * A moment some seconds after {@link MADE}.
 * @param seconds - How many seconds later
 * @returns The moment
 */
function later(seconds: number): Date {
  return new Date(MADE.getTime() + seconds * 1000);
}

describe("canary names", () => {
  it("puts the reserved prefix, the run and the time it was made in a branch name", () => {
    const branch = canaryBranch({
      runId: RUN,
      createdAt: MADE,
      sequence: 3,
      half: "violation",
    });

    expect(branch).toBe("lisa-attest/run0000a/20260304T050607Z-3-violation");
    expect(branch.startsWith(CANARY_BRANCH_PREFIX)).toBe(true);
    expect(parseCanaryBranch(branch)).toEqual({
      runId: RUN,
      createdAt: MADE,
      sequence: 3,
      half: "violation",
    });
  });

  it.each([
    "main",
    "lisa-attest/",
    "lisa-attest/run0000a",
    "lisa-attest/run0000a/notes",
    "lisa-attest/run0000a/20260304T050607Z-3-other",
    "lisa-attest/RUN0000A/20260304T050607Z-3-clean",
    "lisa-attest/run0000a/20261340T050607Z-3-clean",
    "feature/lisa-attest/run0000a/20260304T050607Z-3-clean",
    "lisa-attest/run0000a/20260304T050607Z-3-clean/extra",
  ])("does not recognise %s as a canary", branch => {
    expect(parseCanaryBranch(branch)).toBeNull();
  });

  it("declares a lifetime longer than the longest a canary is kept open", () => {
    // One half may wait thirty minutes for the platform's answer.
    expect(CANARY_LIFETIME_SECONDS).toBeGreaterThan(30 * 60);
  });

  it("makes run identifiers that fit in a branch name and differ each time", () => {
    const made = [newRunId(), newRunId()];

    expect(made.every(id => isRunId(id))).toBe(true);
    expect(made[0]).not.toBe(made[1]);
    expect(isRunId("Has Spaces")).toBe(false);
    expect(isRunId("a/b")).toBe(false);
    expect(isRunId("short")).toBe(false);
  });

  it("names the entry, the half and the run in the pull request", () => {
    const facts = {
      runId: RUN,
      createdAt: MADE,
      entryId: "code-style@api",
      half: "clean",
    } as const;

    expect(canaryTitle(facts)).toBe(
      "[lisa-attest] code-style@api clean half (do not merge)"
    );
    expect(canaryBody(facts)).toContain(
      "lisa-attest run=run0000a created=2026-03-04T05:06:07.000Z entry=code-style@api half=clean"
    );
    expect(canaryBody(facts)).toContain("Do not merge it");
  });
});

describe("whether a canary may be removed", () => {
  const branch = canaryBranch({
    runId: OTHER_RUN,
    createdAt: MADE,
    sequence: 1,
    half: "clean",
  });
  const lifetimeSeconds = CANARY_LIFETIME_SECONDS;

  it("is stale once it is older than the lifetime and belongs to another run", () => {
    expect(
      canaryStanding(branch, {
        runId: RUN,
        now: later(lifetimeSeconds + 1),
        lifetimeSeconds,
      })
    ).toBe("stale");
  });

  it("is live, and left alone, up to and including the lifetime", () => {
    expect(
      [0, 60, lifetimeSeconds].map(age =>
        canaryStanding(branch, { runId: RUN, now: later(age), lifetimeSeconds })
      )
    ).toEqual(["live", "live", "live"]);
  });

  it("is live when its time is ahead of this machine's clock", () => {
    expect(
      canaryStanding(branch, { runId: RUN, now: later(-3600), lifetimeSeconds })
    ).toBe("live");
  });

  it("is this run's own whatever its age, so the sweep never removes it", () => {
    expect(
      canaryStanding(branch, {
        runId: OTHER_RUN,
        now: later(lifetimeSeconds * 10),
        lifetimeSeconds,
      })
    ).toBe("own");
  });

  it("is unrecognised, and left alone, when the name does not say when it was made", () => {
    expect(
      canaryStanding("lisa-attest/someone-elses-branch", {
        runId: RUN,
        now: later(lifetimeSeconds * 10),
        lifetimeSeconds,
      })
    ).toBe("unrecognised");
  });
});

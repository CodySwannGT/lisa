/**
 * The human gate's inverse — that it is REACHABLE, on every copy and vendor.
 *
 * A release path nothing runs is the defect #3852 describes with extra code
 * around it, so this module asserts reach rather than behaviour: that the hold
 * is a row in the signal registry #3855 built for exactly this (a row plus a
 * predicate, not a second bespoke lifecycle), that its label name resolves from
 * config per vendor rather than from a literal, that all five shipped copies of
 * the reader return the same verdict for the same item — run against each copy,
 * not merely asserted to exist, so a missed `bun run build:plugins` fails here
 * — and that the skills on the path name the mechanism instead of telling an
 * operator to rewrite a description.
 *
 * The verdict is covered in `human-gate-release-inverse` and the plan in
 * `human-gate-release-plan`.
 * @module tests/unit/strategies/human-gate-release-reach
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HUMAN_GATE_RELEASE_MARKER } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  ACTIONS,
  HUMAN_GATE_SIGNAL,
  OUTCOMES,
  SIGNALS,
  evaluateSignal,
  resolveSignalLabel,
  unpredicatedConditions,
} from "../../../plugins/src/base/scripts/qa-signal-lifecycle.mjs";

import {
  BODY,
  NEEDED,
  OTHER_RELEASE,
  READY,
  RELEASE,
  trustedHistory,
  readSkill,
} from "./human-gate-release-helpers.js";

describe("the human gate is a row in the signal registry, not a second lifecycle", () => {
  const CONFIG = {
    github: { labels: { build: { ready: READY, human_needed: NEEDED } } },
    jira: { labels: { human_needed: "Waiting On A Person" } },
    linear: { labels: { build: { human_needed: "needs-human" } } },
  };

  const evaluate = (
    comments: readonly string[],
    vendor = "github"
  ): ReturnType<typeof evaluateSignal> =>
    evaluateSignal({
      signal: HUMAN_GATE_SIGNAL,
      labels: [NEEDED],
      body: BODY,
      ...trustedHistory(comments),
      vendor,
      config: CONFIG,
    });

  it("declares the void condition that lifts it", () => {
    expect(SIGNALS[HUMAN_GATE_SIGNAL].voidConditions).toEqual([
      "human-gate-release-recorded",
    ]);
  });

  it("gives every declared void condition an executable predicate", () => {
    // The registry contract from #3855, now with a second row under it: a
    // condition nothing can evaluate is a reported defect, not an exemption.
    expect(unpredicatedConditions()).toEqual([]);
  });

  it("reports the signal stale once the release is recorded", () => {
    const result = evaluate([RELEASE]);

    expect(result.present).toBe(true);
    expect(result.live).toBe(false);
    expect(result.outcome).toBe(OUTCOMES.STALE);
    expect(result.action).toBe(ACTIONS.CLEAR);
    expect(result.voided).toEqual(["human-gate-release-recorded"]);
  });

  it("keeps the signal live while no release names the hold", () => {
    const result = evaluate([OTHER_RELEASE]);

    expect(result.live).toBe(true);
    expect(result.outcome).toBe(OUTCOMES.LIVE);
    expect(result.action).toBe(ACTIONS.KEEP);
    expect(result.voided).toEqual([]);
  });

  it("sees a body-marker hold that carries no label at all", () => {
    // An item held exactly as the filing contract instructs may carry no label
    // (#3805). Presence keyed on the label alone would report nothing to clear.
    const result = evaluateSignal({
      signal: HUMAN_GATE_SIGNAL,
      labels: [],
      body: BODY,
      ...trustedHistory([]),
      vendor: "github",
      config: CONFIG,
    });

    expect(result.present).toBe(true);
    expect(result.live).toBe(true);
  });

  it("resolves the marker label per vendor, never a hardcoded literal", () => {
    for (const [vendor, expected] of [
      ["github", NEEDED],
      ["jira", "Waiting On A Person"],
      ["linear", "needs-human"],
    ] as const) {
      expect(
        resolveSignalLabel({
          signal: HUMAN_GATE_SIGNAL,
          config: CONFIG,
          vendor,
        })
      ).toEqual({ value: expected, source: "config" });
    }
  });

  it("falls back per vendor when a project binds no name", () => {
    expect(
      resolveSignalLabel({
        signal: HUMAN_GATE_SIGNAL,
        config: {},
        vendor: "jira",
      })
    ).toEqual({ value: "Human Needed", source: "fallback" });
    expect(
      resolveSignalLabel({
        signal: HUMAN_GATE_SIGNAL,
        config: {},
        vendor: "github",
      })
    ).toEqual({ value: NEEDED, source: "fallback" });
  });

  it("resolves nothing rather than a guess for an unknown vendor", () => {
    expect(
      resolveSignalLabel({
        signal: HUMAN_GATE_SIGNAL,
        config: CONFIG,
        vendor: "notion",
      })
    ).toEqual({ value: "", source: "none" });
  });
});

const COPIES = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
] as const;

describe("every copy of the check agrees", () => {
  it("returns the same verdict from all five copies of the reader", async () => {
    const held: boolean[] = [];
    const released: boolean[] = [];
    const unauthenticated: boolean[] = [];
    for (const root of COPIES) {
      const module = (await import(
        path.resolve(root, "scripts/intake-blocker-reprobe.mjs")
      )) as {
        isHumanGated: (input: {
          body?: unknown;
          labels?: unknown;
          comments?: unknown;
          trustedHumanActorIds?: unknown;
        }) => boolean;
      };
      held.push(
        module.isHumanGated({
          body: BODY,
          labels: [NEEDED],
          ...trustedHistory([]),
        })
      );
      unauthenticated.push(
        module.isHumanGated({ body: BODY, comments: [RELEASE] })
      );
      released.push(
        module.isHumanGated({
          body: BODY,
          labels: [NEEDED],
          ...trustedHistory([RELEASE]),
        })
      );
    }

    expect(held).toEqual([true, true, true, true, true]);
    expect(released).toEqual([false, false, false, false, false]);
    expect(unauthenticated).toEqual([true, true, true, true, true]);
  });
});

describe("every skill on the release path names the mechanism", () => {
  const skillRoots = ["plugins/src/base", "plugins/lisa"] as const;

  it.each(skillRoots)("%s build-intake skills release, not just hold", root => {
    for (const name of [
      "lisa-github-build-intake",
      "lisa-jira-build-intake",
      "lisa-linear-build-intake",
    ]) {
      const skill = readSkill(root, name);

      expect(skill).toContain("planHumanGateRelease");
      expect(skill).toContain("formatHumanGateReleaseNote");
      expect(skill).toContain("summarizeHumanGateReleases");
      expect(skill).toMatch(
        /pass the item's structured `comments` and `trustedHumanActorIds`/i
      );
    }
  });

  it.each(skillRoots)("%s repair-intake sweeps answered holds", root => {
    const skill = readSkill(root, "lisa-repair-intake");

    expect(skill).toContain("planHumanGateRelease");
    expect(skill).toContain(HUMAN_GATE_RELEASE_MARKER);
  });

  it.each(skillRoots)("%s track names a comment, not a body edit", root => {
    const skill = readSkill(root, "lisa-track");

    expect(skill).toContain(HUMAN_GATE_RELEASE_MARKER);
    expect(skill).not.toContain(
      "a human removes the `[lisa-human-gate]` marker"
    );
  });

  it.each(skillRoots)("%s writers explain how the hold ends", root => {
    for (const name of [
      "lisa-github-write-issue",
      "lisa-jira-write-ticket",
      "lisa-linear-write-issue",
    ]) {
      expect(readSkill(root, name)).toContain(HUMAN_GATE_RELEASE_MARKER);
    }
  });
});

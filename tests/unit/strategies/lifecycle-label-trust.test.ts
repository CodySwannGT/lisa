/**
 * Regression coverage for lifecycle-label identification and drift (#2539).
 *
 * `coderabbitai[bot]` stamps `status:*` labels on issues seconds after they are
 * filed. An issue wearing a bot-applied `status:in-progress` is invisible to
 * build-intake AND looks handled to a human, so nothing re-examines it.
 *
 * This file covers the two halves that decide WHAT is a lifecycle label and
 * WHEN one contradicts native state. Trust resolution lives in the sibling
 * `lifecycle-label-trust-resolution` suite.
 * @module tests/unit/strategies/lifecycle-label-trust
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_LIFECYCLE_LABEL,
  LIFECYCLE_DRIFT_DIRECTIONS,
  LIFECYCLE_LABEL_PREFIX,
  detectLifecycleDrift,
  isBotActor,
  isLifecycleLabel,
  terminalLifecycleLabels,
} from "../../../plugins/src/base/scripts/lifecycle-label-trust.mjs";
import { BUILD_LABEL_DEFAULTS } from "../../../src/sync/lifecycle-defaults.js";

import {
  BLOCKED,
  BOT,
  DONE,
  FICTIONAL,
  HUMAN,
  IN_PROGRESS,
  ON_DEV,
  ON_STG,
  READY,
} from "./support/lifecycle-label-trust.js";

const TERMINAL = [DONE];
const TAXONOMY = ["bug", "repo:lisa", "human-needed"];

/** The rot direction repair-intake already owned. */
const TERMINAL_OPEN = "terminal-label-open-state";
/** The rot direction that had no owner before #2539. */
const OPEN_CLOSED = "open-label-closed-state";
/** The half of that direction which must NEVER earn a terminal write (#3479). */
const OPEN_ABANDONED = "open-label-abandoned-state";
/** GitHub's two closure reasons, as the REST payload spells them. */
const COMPLETED = "COMPLETED";
const NOT_PLANNED = "NOT_PLANNED";

describe("lifecycle label identification (#2539)", () => {
  it("matches on the `status:` prefix rather than a pinned member set", () => {
    expect(LIFECYCLE_LABEL_PREFIX).toBe("status:");
  });

  it("classifies every currently-known member as lifecycle", () => {
    expect(isLifecycleLabel(BLOCKED)).toBe(true);
    expect(isLifecycleLabel(DONE)).toBe(true);
    expect(isLifecycleLabel(IN_PROGRESS)).toBe(true);
    expect(isLifecycleLabel(ON_DEV)).toBe(true);
    expect(isLifecycleLabel(ON_STG)).toBe(true);
    expect(isLifecycleLabel(READY)).toBe(true);
  });

  it("classifies an unknown future member as lifecycle (set drifted 7 -> 6)", () => {
    expect(isLifecycleLabel(FICTIONAL)).toBe(true);
    expect(isLifecycleLabel("status:awaiting-design")).toBe(true);
    expect(isLifecycleLabel("status:")).toBe(true);
  });

  it("does not claim taxonomy labels", () => {
    expect(isLifecycleLabel("bug")).toBe(false);
    expect(isLifecycleLabel("type:bug")).toBe(false);
    expect(isLifecycleLabel("priority:high")).toBe(false);
    expect(isLifecycleLabel("repo:lisa")).toBe(false);
    expect(isLifecycleLabel("component:status")).toBe(false);
    expect(isLifecycleLabel("human-needed")).toBe(false);
  });

  it("tolerates surrounding whitespace and casing drift", () => {
    expect(isLifecycleLabel("  status:ready  ")).toBe(true);
    expect(isLifecycleLabel("Status:Ready")).toBe(true);
  });

  it("rejects non-string and empty input instead of throwing", () => {
    expect(isLifecycleLabel("")).toBe(false);
    expect(isLifecycleLabel(undefined)).toBe(false);
    expect(isLifecycleLabel(null)).toBe(false);
    expect(isLifecycleLabel(42)).toBe(false);
  });
});

describe("bot actor identification (#2539)", () => {
  it("identifies a bot by the timeline actor type", () => {
    expect(isBotActor(BOT)).toBe(true);
  });

  it("identifies a bot by the [bot] login suffix when type is absent", () => {
    expect(isBotActor({ login: "dependabot[bot]" })).toBe(true);
    expect(isBotActor({ login: "some-new-app[bot]" })).toBe(true);
  });

  it("does not treat humans as bots", () => {
    expect(isBotActor(HUMAN)).toBe(false);
    expect(isBotActor({ login: "robotnik" })).toBe(false);
  });

  it("treats a missing actor as non-bot rather than throwing", () => {
    expect(isBotActor(undefined)).toBe(false);
    expect(isBotActor(null)).toBe(false);
    expect(isBotActor({})).toBe(false);
  });
});

describe("terminal lifecycle labels resolved from config (#2539)", () => {
  it("treats only the production done rung as terminal", () => {
    expect(
      terminalLifecycleLabels({
        github: {
          labels: {
            build: {
              ready: READY,
              done: { dev: ON_DEV, staging: ON_STG, production: DONE },
            },
          },
        },
      })
    ).toEqual([DONE]);
  });

  it("follows a renamed done rung rather than a hardcoded literal", () => {
    expect(
      terminalLifecycleLabels({
        github: {
          labels: { build: { done: { production: "status:shipped" } } },
        },
      })
    ).toEqual(["status:shipped"]);
  });

  it("falls back to the built-in default when config is absent", () => {
    expect(terminalLifecycleLabels({})).toEqual([DONE]);
    expect(terminalLifecycleLabels(undefined)).toEqual([DONE]);
  });

  it("keeps its standalone fallback bound to the TypeScript default", () => {
    expect(DEFAULT_TERMINAL_LIFECYCLE_LABEL).toBe(
      BUILD_LABEL_DEFAULTS.done.production
    );
  });

  it("accepts a plain string done role", () => {
    expect(
      terminalLifecycleLabels({
        github: { labels: { build: { done: "status:complete" } } },
      })
    ).toEqual(["status:complete"]);
  });
});

describe("bidirectional lifecycle drift (#2539)", () => {
  it("detects a terminal label on a natively open item (TUN-556 direction)", () => {
    expect(
      detectLifecycleDrift({
        labels: [DONE],
        state: "open",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: TERMINAL_OPEN, label: DONE }]);
  });

  it("detects a non-terminal label on a natively closed item", () => {
    expect(
      detectLifecycleDrift({
        labels: [IN_PROGRESS],
        state: "closed",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: OPEN_CLOSED, label: IN_PROGRESS }]);
  });

  it("reports every direction from one pass so none can be skipped", () => {
    expect(
      detectLifecycleDrift({ labels: [], state: "open" }).directionsWalked
    ).toEqual([TERMINAL_OPEN, OPEN_CLOSED, OPEN_ABANDONED]);
    expect(LIFECYCLE_DRIFT_DIRECTIONS).toHaveLength(3);
  });

  it("does not treat the env rungs as terminal", () => {
    expect(
      detectLifecycleDrift({
        labels: [ON_DEV, ON_STG],
        state: "open",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([]);
  });

  it("classifies an unknown member as a non-terminal lifecycle label", () => {
    expect(
      detectLifecycleDrift({
        labels: [FICTIONAL],
        state: "closed",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: OPEN_CLOSED, label: FICTIONAL }]);
  });

  it("ignores taxonomy labels in both directions", () => {
    expect(
      detectLifecycleDrift({
        labels: TAXONOMY,
        state: "closed",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([]);
  });

  it("excludes an untrusted label from the writing drift direction", () => {
    const result = detectLifecycleDrift({
      labels: [IN_PROGRESS],
      state: "closed",
      terminalLabels: TERMINAL,
      excludeLabels: [IN_PROGRESS],
    });

    expect(result.drifts).toEqual([]);
    expect(result.excluded).toEqual([IN_PROGRESS]);
  });

  it("still walks every direction while excluding a label", () => {
    expect(
      detectLifecycleDrift({
        labels: [IN_PROGRESS],
        state: "closed",
        terminalLabels: TERMINAL,
        excludeLabels: [IN_PROGRESS],
      }).directionsWalked
    ).toEqual([TERMINAL_OPEN, OPEN_CLOSED, OPEN_ABANDONED]);
  });

  it("keeps repairing trusted labels alongside an excluded one", () => {
    const result = detectLifecycleDrift({
      labels: [IN_PROGRESS, READY],
      state: "closed",
      terminalLabels: TERMINAL,
      excludeLabels: [IN_PROGRESS],
    });

    expect(result.drifts).toEqual([{ direction: OPEN_CLOSED, label: READY }]);
    expect(result.excluded).toEqual([IN_PROGRESS]);
  });

  it("reports nothing excluded when no exclusions are supplied", () => {
    expect(
      detectLifecycleDrift({
        labels: [READY],
        state: "open",
        terminalLabels: TERMINAL,
      }).excluded
    ).toEqual([]);
  });

  it("routes a not-planned closure away from the terminal-writing direction", () => {
    // The defect (#3479). This classifier read only `state`, so a deliberate
    // "we will not do this" closure was reported as `open-label-closed-state`
    // — the direction whose repair advances the label to `status:done`,
    // documented "terminal — shipped to production". Measured on this
    // repository, 5 of the 10 closed items still wearing an active role were
    // NOT_PLANNED, so one repair pass would have written a false terminal on
    // half the population.
    expect(
      detectLifecycleDrift({
        labels: [READY],
        state: "closed",
        stateReason: NOT_PLANNED,
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: OPEN_ABANDONED, label: READY }]);
  });

  it("routes a not-planned closure the same way for every active role", () => {
    // The five measured items all carried `ready`, which the ownership guard
    // skips on leaves — so they escaped by accident, not by control. A
    // not-planned item wearing `claimed` or `blocked` has no such shield, and
    // that is the case this row pins.
    expect(
      detectLifecycleDrift({
        labels: [IN_PROGRESS, BLOCKED],
        state: "closed",
        stateReason: NOT_PLANNED,
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([
      { direction: OPEN_ABANDONED, label: IN_PROGRESS },
      { direction: OPEN_ABANDONED, label: BLOCKED },
    ]);
  });

  it("still advances a completed closure to the terminal role", () => {
    // The negative control, and it is not optional: a classifier that routed
    // every closure to the retire-only direction would satisfy the two cases
    // above and repair nothing, which is strictly worse than the defect.
    expect(
      detectLifecycleDrift({
        labels: [IN_PROGRESS],
        state: "closed",
        stateReason: COMPLETED,
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: OPEN_CLOSED, label: IN_PROGRESS }]);
  });

  it("treats an absent closure reason as it always did, not as abandoned", () => {
    // Absence of a reason is not evidence of abandonment. Only a positively
    // reported NOT_PLANNED narrows the repair; inventing a third answer for a
    // reason nobody supplied would change behaviour on evidence nobody has.
    expect(
      detectLifecycleDrift({
        labels: [IN_PROGRESS],
        state: "closed",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([{ direction: OPEN_CLOSED, label: IN_PROGRESS }]);
  });

  it("ignores a closure reason on an item that is not closed", () => {
    expect(
      detectLifecycleDrift({
        labels: [READY],
        state: "open",
        stateReason: NOT_PLANNED,
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([]);
  });

  it("finds no drift when label and native state agree", () => {
    expect(
      detectLifecycleDrift({
        labels: [DONE],
        state: "closed",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([]);
    expect(
      detectLifecycleDrift({
        labels: [READY],
        state: "open",
        terminalLabels: TERMINAL,
      }).drifts
    ).toEqual([]);
  });
});

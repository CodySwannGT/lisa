/**
 * Regression coverage for bot-authored lifecycle-label distrust (#2539).
 *
 * The decisive pair: #2470's `status:in-progress` landed 27s after filing and is
 * a false claim; #2494's landed 3001s after filing and tracked real work. BOTH
 * were applied by `coderabbitai[bot]`, so a guard keyed on the actor alone
 * cannot separate them — and one keyed on latency alone would discard the human
 * `status:ready` applied at filing time, which is the queue's entry signal.
 * Distrust therefore requires a bot actor AND an implausible latency.
 * @module tests/unit/strategies/lifecycle-label-trust-resolution
 */
import { describe, expect, it } from "vitest";

import {
  IMPLAUSIBLE_CLAIM_WINDOW_SECONDS,
  resolveTrustedLifecycleLabels,
} from "../../../plugins/src/base/scripts/lifecycle-label-trust.mjs";

import {
  BOT,
  BOT_STAMP_2470,
  CREATED_2470,
  FICTIONAL,
  HUMAN,
  IMPLAUSIBLE,
  IN_PROGRESS,
  ISSUE_2470,
  ISSUE_2494,
  LABELED,
  PLAUSIBLE,
  READY,
} from "./support/lifecycle-label-trust.js";

describe("trusted lifecycle resolution (#2539)", () => {
  it("distrusts #2470's bot claim applied 27s after filing", () => {
    const result = resolveTrustedLifecycleLabels(ISSUE_2470);

    expect(result.untrusted).toEqual([
      {
        label: IN_PROGRESS,
        actor: BOT.login,
        latencySeconds: 27,
        reason: IMPLAUSIBLE,
      },
    ]);
    expect(result.hasUntrustedLifecycleLabels).toBe(true);
  });

  it("keeps #2470 claimable by preserving the human-applied ready label", () => {
    expect(resolveTrustedLifecycleLabels(ISSUE_2470).trusted).toEqual([READY]);
  });

  it("trusts #2494's bot label applied 3001s after filing", () => {
    const result = resolveTrustedLifecycleLabels(ISSUE_2494);

    expect(result.untrusted).toEqual([]);
    expect(result.hasUntrustedLifecycleLabels).toBe(false);
    expect(result.trusted).toEqual([IN_PROGRESS]);
  });

  it("reports the same 3001s latency it decided to trust", () => {
    expect(resolveTrustedLifecycleLabels(ISSUE_2494).evaluated).toContainEqual({
      label: IN_PROGRESS,
      actor: BOT.login,
      latencySeconds: 3001,
      reason: PLAUSIBLE,
      trusted: true,
    });
  });

  it("distrusts a bot-applied label whose member is not in the known set", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      labels: [FICTIONAL],
      timeline: [
        {
          event: LABELED,
          label: { name: FICTIONAL },
          actor: BOT,
          created_at: BOT_STAMP_2470,
        },
      ],
    });

    expect(result.untrusted).toHaveLength(1);
    expect(result.untrusted[0]?.label).toBe(FICTIONAL);
    expect(result.trusted).toEqual([]);
  });

  it("trusts a human label applied instantly at filing time", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      labels: [READY],
      timeline: [
        {
          event: LABELED,
          label: { name: READY },
          actor: HUMAN,
          created_at: CREATED_2470,
        },
      ],
    });

    expect(result.trusted).toEqual([READY]);
    expect(result.evaluated[0]?.reason).toBe("human-actor");
  });

  it("re-trusts a label a human re-applied after the bot", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      labels: [IN_PROGRESS],
      timeline: [
        {
          event: LABELED,
          label: { name: IN_PROGRESS },
          actor: BOT,
          created_at: BOT_STAMP_2470,
        },
        {
          event: "unlabeled",
          label: { name: IN_PROGRESS },
          actor: HUMAN,
          created_at: "2026-08-14T09:11:42Z",
        },
        {
          event: LABELED,
          label: { name: IN_PROGRESS },
          actor: HUMAN,
          created_at: "2026-08-14T09:22:17Z",
        },
      ],
    });

    expect(result.trusted).toEqual([IN_PROGRESS]);
    expect(result.untrusted).toEqual([]);
  });

  it("ignores taxonomy labels entirely, whoever applied them", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      labels: ["bug", "repo:lisa"],
      timeline: [
        {
          event: LABELED,
          label: { name: "bug" },
          actor: BOT,
          created_at: BOT_STAMP_2470,
        },
      ],
    });

    expect(result.trusted).toEqual([]);
    expect(result.untrusted).toEqual([]);
    expect(result.evaluated).toEqual([]);
  });

  it("flags a label it cannot attribute instead of silently trusting it", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      labels: [READY],
      timeline: [],
    });

    expect(result.trusted).toEqual([READY]);
    expect(result.unknownProvenance).toEqual([READY]);
    expect(result.evaluated[0]?.reason).toBe("provenance-unknown");
  });

  it("attributes a creation-time label to a bot author when one is supplied", () => {
    const result = resolveTrustedLifecycleLabels({
      issueCreatedAt: CREATED_2470,
      issueAuthor: BOT,
      labels: [IN_PROGRESS],
      timeline: [],
    });

    expect(result.trusted).toEqual([]);
    expect(result.untrusted[0]?.reason).toBe(IMPLAUSIBLE);
    expect(result.unknownProvenance).toEqual([]);
  });

  it("honours a caller-supplied plausibility window", () => {
    const result = resolveTrustedLifecycleLabels({
      ...ISSUE_2470,
      windowSeconds: 10,
    });

    expect(result.untrusted).toEqual([]);
    expect(result.trusted).toEqual([READY, IN_PROGRESS]);
  });

  it("defaults the window above the observed bot noise, below a real claim", () => {
    expect(IMPLAUSIBLE_CLAIM_WINDOW_SECONDS).toBe(300);
    expect(IMPLAUSIBLE_CLAIM_WINDOW_SECONDS).toBeGreaterThan(118);
    expect(IMPLAUSIBLE_CLAIM_WINDOW_SECONDS).toBeLessThan(3001);
  });

  it("never proposes a label write — the result carries no mutation plan", () => {
    const keys = Object.keys(resolveTrustedLifecycleLabels(ISSUE_2470));

    expect([...keys].sort((left, right) => left.localeCompare(right))).toEqual([
      "evaluated",
      "hasUntrustedLifecycleLabels",
      "trusted",
      "unknownProvenance",
      "untrusted",
    ]);
  });
});

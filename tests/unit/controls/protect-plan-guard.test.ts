/**
 * The last check before `lisa controls protect` sends a change: nothing the
 * host already requires may be taken away or handed to another app
 * (CodySwannGT/lisa#4993).
 *
 * The steps of a change are planned by the shipped reconciler, which this
 * command does not restate. So the plan is compared with the ruleset as it
 * was read, whatever planned it. Here the planner is replaced by one that
 * plans exactly the step a case names, to show the comparison holds for a
 * plan the real planner would not make today. Nothing is sent anywhere.
 */
import { describe, expect, it } from "vitest";

import { planChange } from "../../../src/controls/protect-apply.js";
import {
  loadProtectionModules,
  type LiveRuleset,
  type ProtectionModules,
  type RepairAction,
} from "../../../src/controls/protect-modules.js";
import {
  statusCheckRuleset,
  type FakeRequiredCheck,
} from "./support/fake-github.js";

const RULESET = "quality checks";
const LINT = "Lint";
const REVIEW = "Review Bot";

/** The review check as the host requires it: from one app. */
const PINNED_REVIEW: FakeRequiredCheck = {
  context: REVIEW,
  integration_id: 999,
};

/** The review check as a host that accepts it from anyone requires it. */
const OPEN_REVIEW: FakeRequiredCheck = {
  context: REVIEW,
  integration_id: null,
};

/**
 * Plan a change with a planner that plans one given step.
 * @param held - The ruleset the platform holds
 * @param next - The ruleset the step would send in its place
 * @returns What planning gave
 */
async function planned(
  held: LiveRuleset,
  next: LiveRuleset
): Promise<ReturnType<typeof planChange>> {
  const modules = await loadProtectionModules();
  const step: RepairAction = {
    kind: "contexts",
    ruleset: RULESET,
    rulesetId: 7,
    add: [LINT],
    payload: next as Readonly<Record<string, unknown>>,
  };
  const stubbed: ProtectionModules = {
    ...modules,
    reconcile: { ...modules.reconcile, planRepairs: () => [step] },
  };
  return planChange({
    comparison: {
      drift: {
        missing: [LINT],
        missingRecords: [{ context: LINT, ruleset: RULESET }],
        matched: [],
      },
      awaitedRecords: [],
      awaitedHomes: {},
    },
    requirement: {
      declared: [LINT],
      configured: { homes: {}, pins: {}, records: [] },
      awaited: [],
      awaitedPins: {},
    },
    rulesets: [held],
    enforced: [held],
    branch: "main",
    defaultBranch: "main",
    rulesetName: null,
    policy: undefined,
    modules: stubbed,
  });
}

describe("a planned change, compared with the ruleset as it was read", () => {
  it("is sent when it adds a check and keeps everything that was there", async () => {
    const plan = await planned(
      statusCheckRuleset(7, RULESET, [PINNED_REVIEW]),
      statusCheckRuleset(7, RULESET, [PINNED_REVIEW, LINT])
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.actions).toHaveLength(1);
  });

  it.each([
    [
      "drop the app a check is pinned to",
      [PINNED_REVIEW],
      [OPEN_REVIEW, LINT],
      /accepts it only from app 999\. The change would accept it from any source instead/u,
    ],
    [
      "pin a check to another app",
      [PINNED_REVIEW],
      [{ context: REVIEW, integration_id: 4242 }, LINT],
      /only from app 999\. The change would accept it only from app 4242 instead/u,
    ],
    [
      "stop requiring a pinned check",
      [PINNED_REVIEW],
      [LINT],
      /only from app 999\. The change would stop requiring it/u,
    ],
    [
      "stop requiring a check any source may report",
      [OPEN_REVIEW],
      [LINT],
      /accepts it from any source\. The change would stop requiring it/u,
    ],
  ] as const)(
    "is refused whole when it would %s",
    async (_what, before, after, why) => {
      const plan = await planned(
        statusCheckRuleset(7, RULESET, before),
        statusCheckRuleset(7, RULESET, after)
      );

      expect(plan.actions).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]).toContain(`\`${REVIEW}\``);
      expect(plan.blockers[0]).toMatch(why);
    }
  );

  it("may pin a check the host left open to any source: that takes nothing away", async () => {
    const plan = await planned(
      statusCheckRuleset(7, RULESET, [OPEN_REVIEW]),
      statusCheckRuleset(7, RULESET, [
        { context: REVIEW, integration_id: 4242 },
        LINT,
      ])
    );

    expect(plan.blockers).toEqual([]);
  });
});

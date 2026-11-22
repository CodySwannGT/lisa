/**
 * The hold sweep under `humanGate.mode` (CodySwannGT/lisa#4687).
 *
 * A hold filed for a pre-#4687 gate — naming an accountable person, a call
 * Lisa's policy used to reserve for a person — is a decision under the default
 * `access-only` mode, so the sweep lifts it and the item goes back to the
 * build queue. Under `strict` the same hold is valid and stays. A credential
 * hold is never lifted in either mode.
 * @module tests/unit/strategies/human-gate-lift-mode
 */
import { describe, expect, it } from "vitest";

import {
  formatHumanGateLift,
  planHumanGateLift,
} from "../../../plugins/src/base/scripts/human-gate-lift.mjs";
import { isHumanGated } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const NEEDED = "human-needed";
const READY = "status:ready";
const LIFECYCLE = [READY, "status:in-progress", "status:blocked", NEEDED];
const ACCOUNTABLE = "accountable-owner";
const PROMOTION = "knowledge-promotion";

/**
 * A body held the way the writers stamp it.
 * @param reason - The hold's slug
 * @param visible - The visible "Held for …" line
 * @returns The item body
 */
function heldBody(reason: string, visible: string): string {
  return [
    "## Problem",
    "",
    "Something needs doing.",
    "",
    visible,
    `<!-- [lisa-human-gate] reason=${reason} -->`,
  ].join("\n");
}

const accountable = heldBody(
  ACCOUNTABLE,
  "Held for a person to name an accountable person: the data processor owner."
);
const promotion = heldBody(
  PROMOTION,
  "Held for a person to make a call Lisa's own policy reserves for a person: whether this knowledge is promoted."
);

describe("legacy holds under humanGate.mode", () => {
  it.each([
    ["accountable person", accountable, ACCOUNTABLE],
    ["learnings promotion", promotion, PROMOTION],
  ])(
    "lifts a %s hold by default and keeps it under strict",
    (_name, body, reason) => {
      const base = {
        body,
        labels: [NEEDED],
        readyLabel: READY,
        lifecycleLabels: LIFECYCLE,
      };
      const access = planHumanGateLift(base);
      expect(access.lift).toBe(true);
      expect(access.lifted).toEqual([reason]);
      expect(access.actions.removeHumanNeededLabel).toBe(true);
      const strict = planHumanGateLift({ ...base, humanGateMode: "strict" });
      expect(strict.lift).toBe(false);
      expect(strict.kept).toEqual([reason]);
    }
  );

  it("lets a lift comment discharge a legacy hold only outside strict", () => {
    const comments = [{ body: formatHumanGateLift({ reason: ACCOUNTABLE }) }];
    const surfaces = { body: accountable, labels: [NEEDED], comments };
    expect(isHumanGated(surfaces)).toBe(false);
    expect(isHumanGated({ ...surfaces, humanGateMode: "strict" })).toBe(true);
  });

  // Review finding (HIGH): a gardener hold filed under the old wording whose
  // destination is a human-authored file was lifted under access-only, which
  // would let an agent write the operator's own rules file.
  it.each([
    [
      "the destination path beside the hold",
      "Destination: .claude/rules/PROJECT_RULES.md",
    ],
    [
      "the destination far from the hold",
      "Target file\n\nSee AGENTS.md for where this lands.",
    ],
    ["a host rules directory", "Lands in .agents/rules/testing.md"],
  ])(
    "keeps a lisa-policy hold that targets a human-authored file: %s",
    (_name, destination) => {
      const body = [
        "## Proposal",
        "",
        "Promote the learning about fixture cleanup.",
        "",
        destination,
        "",
        "Held for a person to make a call Lisa's own policy reserves for a person: a human decides whether this knowledge is promoted, demoted, or retired.",
        "<!-- [lisa-human-gate] reason=lisa-policy -->",
      ].join("\n");
      for (const humanGateMode of [undefined, "strict"]) {
        const plan = planHumanGateLift({
          body,
          labels: [NEEDED],
          humanGateMode,
        });
        expect(plan.lift).toBe(false);
        expect(plan.lifted).toEqual([]);
      }
    }
  );

  it("still lifts the same lisa-policy hold when it targets the ledger", () => {
    const body = [
      "Promote the learning about fixture cleanup.",
      "Destination: .lisa/PROJECT_LEARNINGS.md",
      "",
      "Held for a person to make a call Lisa's own policy reserves for a person: a human decides whether this knowledge is promoted, demoted, or retired.",
      "<!-- [lisa-human-gate] reason=lisa-policy -->",
    ].join("\n");
    expect(planHumanGateLift({ body, labels: [NEEDED] }).lifted).toEqual([
      "lisa-policy",
    ]);
  });

  // History review A: any hold whose text mentions the operator is the
  // operator's to release, so the sweep never lifts it, whatever the slug.
  it("never lifts a hold whose text mentions the operator", () => {
    const body = heldBody(
      "naming-triage",
      "Held for a human product call: naming triage, which the operator wants to see first."
    );
    for (const humanGateMode of [undefined, "strict"]) {
      expect(
        planHumanGateLift({ body, labels: [NEEDED], humanGateMode }).lift
      ).toBe(false);
    }
  });

  it("never lifts a credential hold in either mode", () => {
    const credential = heldBody(
      "vendor-api-key",
      "Held for a person to complete a login or supply a credential only a person holds: the vendor API key."
    );
    for (const humanGateMode of [undefined, "strict"]) {
      expect(
        planHumanGateLift({ body: credential, labels: [NEEDED], humanGateMode })
          .lift
      ).toBe(false);
    }
  });
});

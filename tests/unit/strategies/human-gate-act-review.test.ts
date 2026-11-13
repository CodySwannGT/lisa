/**
 * Review findings on the access-only classifier (CodySwannGT/lisa#4687).
 *
 * An independent run of about 100 hold reasons found real acts the narrowed
 * patterns refused (a contract signature without an article, an interactive
 * console login, a deployment approval), a hold reason that never said "hold"
 * passing as the operator's own hold, and a human-authored destination
 * spelled as a path rather than in words. Each case is pinned in both modes:
 * an access act or the authorship rule must hold whatever the mode.
 * @module tests/unit/strategies/human-gate-act-review
 */
import { describe, expect, it } from "vitest";

import {
  DECIDE_AND_RECORD,
  classifyHumanGateReason,
} from "../../../plugins/src/base/scripts/human-gate-act.mjs";

const MODES = [{}, { mode: "strict" }] as const;
const LEGAL = "legal-signoff";
const CREDENTIAL = "credential";
const PERSON_ONLY = "person-only-account";
const OPERATOR_HOLD = "operator-hold";
const AUTHORED = "human-authored-surface";

/**
 * Assert a reason is a valid gate naming one act, in both modes.
 * @param reason - The hold reason
 * @param act - The act it must name
 */
function heldInBothModes(reason: string, act: string): void {
  for (const options of MODES) {
    const verdict = classifyHumanGateReason(reason, options);
    expect(verdict.valid, JSON.stringify(options)).toBe(true);
    expect(verdict.act).toBe(act);
  }
}

describe("legal signatures without an article", () => {
  it.each([
    "sign-contract",
    "sign contract",
    "sign-nda",
    "sign-msa",
    "countersign-msa",
    "accept-apple-developer-agreement",
    "sign the master services agreement",
  ])("holds %j as a legal signature", reason => {
    heldInBothModes(reason, LEGAL);
  });

  it.each(["contract-test-framework-pick", "contract-renewal-dispatch"])(
    "still refuses the topic slug %j by default",
    reason => {
      expect(classifyHumanGateReason(reason).valid).toBe(false);
    }
  );
});

describe("interactive console logins", () => {
  it.each([
    "log in to App Store Connect",
    "interactive App Store Connect login",
    "sign in to the AWS console",
    "an interactive console login only the founder can complete",
  ])("holds %j as a login", reason => {
    heldInBothModes(reason, CREDENTIAL);
  });

  it("still refuses a sign-in page design slug", () => {
    expect(classifyHumanGateReason("sign-in-page-design").valid).toBe(false);
  });
});

describe("deployment approvals", () => {
  it.each([
    "deploy-approval",
    "production-approval",
    "the required reviewer must approve the production environment",
    "approve the production deployment",
    "approve the release to production",
  ])("holds %j as a person-only account act", reason => {
    heldInBothModes(reason, PERSON_ONLY);
  });
});

// Review findings 4b-4d: decisions about a topic that merely mention a login
// provider, a reviewer list, a personal account or "on behalf of the company"
// are not gates, in either mode.
describe("topic decisions that name an act word", () => {
  it.each([
    "sso-choice",
    "sso-provider-choice",
    "oauth-provider-choice",
    "oauth-scope-list",
    "sso login button design",
    "add the personal account picker",
    "required reviewers list in the settings UI",
    "add a protected deployment environment to the CDK stack",
    "on behalf of the company decide the name",
  ])("refuses %j in both modes", reason => {
    for (const options of MODES) {
      expect(classifyHumanGateReason(reason, options).valid).toBe(false);
    }
  });
});

describe("the operator's own hold must say hold", () => {
  it.each([
    "the customer explicitly asked for dark mode",
    "the operator explicitly asked for a CSV export",
    "requested by the operator: rename the field",
  ])("refuses %j, which names no hold", reason => {
    const verdict = classifyHumanGateReason(reason);
    expect(verdict.valid).toBe(false);
    expect(verdict.remedy).toBe(DECIDE_AND_RECORD);
  });

  it.each([
    "a hold the operator explicitly asked for",
    "Coverage work explicitly held for operator prioritization",
    "the operator explicitly asked for this exploratory pass to be held for review",
    "operator hold",
    "paused by the operator until the launch",
  ])("holds %j as the operator's hold", reason => {
    heldInBothModes(reason, OPERATOR_HOLD);
  });
});

describe("human-authored destinations spelled as paths", () => {
  it.each([
    "promote this learning into .claude/rules/PROJECT_RULES.md",
    "retire the entry in AGENTS.md",
    "add a rule file under .agents/rules/",
    "edit PROJECT_RULES.md",
  ])("holds %j under the authorship rule", reason => {
    heldInBothModes(reason, AUTHORED);
    expect(classifyHumanGateReason(reason).label).toBe(
      "edit a file the project says only people write"
    );
  });
});

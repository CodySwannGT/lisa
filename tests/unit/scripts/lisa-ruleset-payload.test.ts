/**
 * Tests for the config-derived `base` ruleset payload.
 *
 * `all/github-rulesets/base.json` was a shipped template that duplicated seven
 * `policy` fields, could not express four more, and pinned two vendor status
 * checks every repository inherited and none could drop. It is gone; this
 * module builds the same payload from `.lisa.config.json` instead.
 *
 * The expected documents here are written out in full rather than derived from
 * the module under test. A test that computed its expectation from
 * `RULESET_DEFAULTS` would keep passing through a change to those defaults,
 * which is exactly the change that would silently drop a repository's branch
 * protection.
 * @module tests/unit/scripts/lisa-ruleset-payload
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  POLICY_RULESET_NAME,
  awaitedChecks,
  buildRulesetPayload,
} from "../../../scripts/lisa-ruleset-payload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const CODERABBIT = "CodeRabbit";
const GITGUARDIAN = "GitGuardian Security Checks";
const CODERABBIT_APP = 347_564;
const GITGUARDIAN_APP = 46_505;
const PULL_REQUEST = "pull-request";
const STATUS_CHECKS = "required_status_checks";
const DEFAULT_REFS = [
  "~DEFAULT_BRANCH",
  "refs/heads/dev",
  "refs/heads/staging",
  "refs/heads/main",
];

/** One rule in a generated payload, projected to what the tests read. */
type Rule = {
  readonly type: string;
  readonly parameters?: Record<string, unknown>;
};

/**
 * Reads one rule out of a generated payload.
 *
 * @param payload The generated ruleset.
 * @param type The rule type to find.
 * @returns The rule, or undefined when the payload has none.
 */
function ruleOf(
  payload: Record<string, unknown>,
  type: string
): Rule | undefined {
  return (payload.rules as readonly Rule[]).find(rule => rule.type === type);
}

/**
 * The contexts a generated payload requires.
 *
 * @param payload The generated ruleset.
 * @returns Required contexts, with their pins.
 */
function requiredChecks(
  payload: Record<string, unknown>
): readonly { context: string; integration_id?: number }[] {
  const rule = ruleOf(payload, STATUS_CHECKS);
  return (rule?.parameters?.required_status_checks ?? []) as readonly {
    context: string;
    integration_id?: number;
  }[];
}

/**
 * An awaited gate declaration.
 *
 * @param context The context the external app posts.
 * @param postedBy The app id, when the project pins one.
 * @param level The declared level.
 * @returns A gates block with that one declaration.
 */
function awaiting(
  context: string,
  postedBy?: number,
  level = "required"
): Record<string, unknown> {
  return {
    "credential-leakage": {
      [PULL_REQUEST]: {
        level,
        await: context,
        ...(postedBy === undefined ? {} : { posted_by: postedBy }),
      },
    },
  };
}

describe("the retired base.json template", () => {
  // The first acceptance criterion, stated as a file that must not come back.
  it("no longer exists", () => {
    expect(
      existsSync(path.join(REPO_ROOT, "all", "github-rulesets", "base.json"))
    ).toBe(false);
  });
});

describe("buildRulesetPayload", () => {
  it("reproduces the retired template's shape for a project declaring nothing", () => {
    expect(buildRulesetPayload()).toEqual({
      name: "base",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { exclude: [], include: DEFAULT_REFS } },
      bypass_actors: [
        { actor_id: null, actor_type: "DeployKey", bypass_mode: "always" },
        { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
      ],
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
            allowed_merge_methods: ["merge"],
          },
        },
      ],
    });
  });

  describe("require_extra_approval_for_unattributed_changes", () => {
    // CodySwannGT/lisa#3096 item 2. Measured against the live rulesets API on
    // 2026-08-25 with a disabled probe ruleset on a non-existent ref: a
    // `pull_request` rule sent WITHOUT this parameter came back with it
    // `true`; sent `false`, it came back `false`; sent without it again, it
    // came back `true`. GitHub re-applies its own default on every write that
    // omits the field, so an operator who wants it off cannot hold it off, and
    // an operator who wants it on is recording no choice at all — the value is
    // whatever GitHub's default happens to be that week.
    const EXTRA = "require_extra_approval_for_unattributed_changes";

    it("carries a declared true into the pull_request rule", () => {
      const parameters = ruleOf(
        buildRulesetPayload({ policy: { review: { [EXTRA]: true } } }),
        "pull_request"
      )?.parameters;

      expect(parameters?.[EXTRA]).toBe(true);
    });

    it("carries a declared false, which is the only way to hold it off", () => {
      // The direction that cannot be expressed any other way: omission does
      // not mean "leave it", it means "reset it to GitHub's default", and the
      // measured default is `true`.
      const parameters = ruleOf(
        buildRulesetPayload({ policy: { review: { [EXTRA]: false } } }),
        "pull_request"
      )?.parameters;

      expect(parameters?.[EXTRA]).toBe(false);
    });

    it("omits the parameter entirely when nothing declares it (control)", () => {
      // The negative control. A default of either polarity would send every
      // repository a change it never asked for; the byte-exact payload above
      // is the other half of the same assertion.
      const parameters = ruleOf(
        buildRulesetPayload(),
        "pull_request"
      )?.parameters;

      expect(parameters).not.toHaveProperty(EXTRA);
      expect(Object.keys(parameters ?? {})).toEqual([
        "required_approving_review_count",
        "dismiss_stale_reviews_on_push",
        "require_code_owner_review",
        "require_last_push_approval",
        "required_review_thread_resolution",
        "allowed_merge_methods",
      ]);
    });
  });

  // The vendor lock, gone. The template required these two of every repository
  // and `addRequiredChecks` could only ever add more.
  it("requires no vendor context when the project declares no await", () => {
    const payload = buildRulesetPayload();

    expect(ruleOf(payload, STATUS_CHECKS)).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(GITGUARDIAN);
    expect(JSON.stringify(payload)).not.toContain(CODERABBIT);
  });

  it("requires an awaited context, pinned to the app the project named", () => {
    const payload = buildRulesetPayload({
      gates: awaiting(GITGUARDIAN, GITGUARDIAN_APP),
    });

    expect(requiredChecks(payload)).toEqual([
      { context: GITGUARDIAN, integration_id: GITGUARDIAN_APP },
    ]);
  });

  // Unpinned is GitHub's "any source". It is the honest answer when the project
  // has not said which app posts the signal, and it is what the reconciler has
  // always written for an awaited context.
  it("requires an awaited context unpinned when no app is named", () => {
    const payload = buildRulesetPayload({ gates: awaiting(GITGUARDIAN) });

    expect(requiredChecks(payload)).toEqual([{ context: GITGUARDIAN }]);
  });

  // An awaited gate at `optional` says the signal is read, not that a pull
  // request waits for it. Promoting it would turn advice into a merge block.
  it("does not require an awaited context declared optional", () => {
    const payload = buildRulesetPayload({
      gates: awaiting(GITGUARDIAN, GITGUARDIAN_APP, "optional"),
    });

    expect(ruleOf(payload, STATUS_CHECKS)).toBeUndefined();
  });

  it("carries the strict-checks policy from policy.protect", () => {
    const payload = buildRulesetPayload({
      gates: awaiting(CODERABBIT, CODERABBIT_APP),
      policy: { protect: { up_to_date_before_merge: true } },
    });

    expect(
      ruleOf(payload, STATUS_CHECKS)?.parameters
        ?.strict_required_status_checks_policy
    ).toBe(true);
  });

  describe("the four fields config could not express", () => {
    it("takes enforcement from policy.ruleset", () => {
      expect(
        buildRulesetPayload({
          policy: { ruleset: { enforcement: "evaluate" } },
        }).enforcement
      ).toBe("evaluate");
    });

    it("takes the ref-name conditions from policy.ruleset", () => {
      const payload = buildRulesetPayload({
        policy: {
          ruleset: {
            include_refs: ["refs/heads/trunk"],
            exclude_refs: ["refs/heads/trunk/experimental/**"],
          },
        },
      });

      expect(payload.conditions).toEqual({
        ref_name: {
          include: ["refs/heads/trunk"],
          exclude: ["refs/heads/trunk/experimental/**"],
        },
      });
    });

    it("takes bypass_actors from policy.ruleset, including an empty list", () => {
      expect(
        buildRulesetPayload({ policy: { ruleset: { bypass_actors: [] } } })
          .bypass_actors
      ).toEqual([]);
    });

    it("takes the approving-review count from policy.review", () => {
      const parameters = ruleOf(
        buildRulesetPayload({
          policy: { review: { required_approving_review_count: 2 } },
        }),
        "pull_request"
      )?.parameters;

      expect(parameters?.required_approving_review_count).toBe(2);
    });
  });

  describe("the seven fields that were declared twice", () => {
    it("drops the deletion rule when policy.protect.deletion is false", () => {
      expect(
        ruleOf(
          buildRulesetPayload({ policy: { protect: { deletion: false } } }),
          "deletion"
        )
      ).toBeUndefined();
    });

    it("drops the non-fast-forward rule when force_push protection is off", () => {
      expect(
        ruleOf(
          buildRulesetPayload({ policy: { protect: { force_push: false } } }),
          "non_fast_forward"
        )
      ).toBeUndefined();
    });

    it("derives allowed_merge_methods from policy.merge", () => {
      const parameters = ruleOf(
        buildRulesetPayload({
          policy: {
            merge: { merge_commit: false, squash: true, rebase: true },
          },
        }),
        "pull_request"
      )?.parameters;

      expect(parameters?.allowed_merge_methods).toEqual(["squash", "rebase"]);
    });

    it("carries the three pull-request protections from policy.protect", () => {
      const parameters = ruleOf(
        buildRulesetPayload({
          policy: {
            protect: {
              conversation_resolution: false,
              dismiss_stale_reviews: true,
              require_last_push_approval: true,
            },
          },
        }),
        "pull_request"
      )?.parameters;

      expect(parameters?.required_review_thread_resolution).toBe(false);
      expect(parameters?.dismiss_stale_reviews_on_push).toBe(true);
      expect(parameters?.require_last_push_approval).toBe(true);
    });
  });

  describe("history rules", () => {
    it("adds linear history and signed commits only when declared", () => {
      const payload = buildRulesetPayload({
        policy: { history: { linear: true, signed_commits: true } },
      });

      expect(ruleOf(payload, "required_linear_history")).toBeDefined();
      expect(ruleOf(payload, "required_signatures")).toBeDefined();
      expect(
        ruleOf(buildRulesetPayload(), "required_linear_history")
      ).toBeUndefined();
    });
  });
});

describe("two gates awaiting one context", () => {
  /**
   * Two required gates awaiting the same context, with the given pins.
   *
   * @param first The first gate's app id, or undefined for unpinned.
   * @param second The second gate's app id, or undefined for unpinned.
   * @returns A gates block declaring both.
   */
  function bothAwaiting(
    first?: number,
    second?: number
  ): Record<string, unknown> {
    const declare = (postedBy?: number): Record<string, unknown> => ({
      [PULL_REQUEST]: {
        level: "required",
        await: CODERABBIT,
        ...(postedBy === undefined ? {} : { posted_by: postedBy }),
      },
    });
    return {
      "code-review": declare(first),
      "x-second-opinion": declare(second),
    };
  }

  // A ruleset carries one entry per context, so the writer must collapse them.
  it("collapses an exact duplicate to a single required check", () => {
    expect(
      requiredChecks(
        buildRulesetPayload({
          gates: bothAwaiting(CODERABBIT_APP, CODERABBIT_APP),
        })
      )
    ).toEqual([{ context: CODERABBIT, integration_id: CODERABBIT_APP }]);
  });

  it("collapses two unpinned declarations", () => {
    expect(
      requiredChecks(buildRulesetPayload({ gates: bothAwaiting() }))
    ).toEqual([{ context: CODERABBIT }]);
  });

  // Silently keeping the first would require the context pinned to an app the
  // project never named for it — a declaration discarded without a word.
  it("refuses two different pins for one context", () => {
    expect(() =>
      buildRulesetPayload({ gates: bothAwaiting(CODERABBIT_APP, 1) })
    ).toThrow(/naming different apps/u);
  });

  // Unpinned is "any source", which is a different requirement from a pinned
  // one — not an absent opinion to be overridden.
  it("refuses an unpinned declaration against a pinned one", () => {
    expect(() =>
      buildRulesetPayload({ gates: bothAwaiting(undefined, CODERABBIT_APP) })
    ).toThrow(/naming different apps/u);
  });
});

describe("awaitedChecks", () => {
  it("names the ruleset the policy block describes", () => {
    expect(POLICY_RULESET_NAME).toBe("base");
  });

  it("returns nothing when no gate awaits anything", () => {
    expect(
      awaitedChecks(
        { "code-style": { [PULL_REQUEST]: "required" } },
        PULL_REQUEST
      )
    ).toEqual([]);
  });

  it("returns one entry per required awaited gate", () => {
    expect(
      awaitedChecks(
        {
          "credential-leakage": {
            [PULL_REQUEST]: {
              level: "required",
              await: GITGUARDIAN,
              posted_by: GITGUARDIAN_APP,
            },
          },
          "code-review": {
            [PULL_REQUEST]: { level: "required", await: CODERABBIT },
          },
        },
        PULL_REQUEST
      )
    ).toEqual([
      { context: CODERABBIT },
      { context: GITGUARDIAN, integration_id: GITGUARDIAN_APP },
    ]);
  });
});

/**
 * Tests for the pure comparison helpers behind ruleset reconciliation.
 *
 * These never touch `gh`. The behaviors that read a live repository — the
 * UNPROVEN verdict above all — live in `lisa-reconcile-policy`.
 * @module tests/unit/scripts/lisa-reconcile-policy-units
 */

import { describe, expect, it } from "vitest";

import {
  liveContexts,
  planRepairs,
  reconcileContexts,
  reconcileSettings,
  repairTarget,
  rulesetPayload,
  rulesetSignals,
  unobservablePolicyFields,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import { QUALITY } from "./lisa-gates-fixtures.js";
import {
  ACTIONS_ID,
  LINT,
  SONAR,
  TYPES,
  baseRuleset,
  liveEntries,
} from "./lisa-reconcile-policy-fixtures.js";

const BASE = "base";
const QUALITY_CHECKS = "quality checks";
const SLOW_LINT = `${QUALITY} / 🐢 Slow Lint Rules`;

describe("reconcileContexts", () => {
  it("splits declared against live into missing, extra, and matched", () => {
    const live = liveEntries([LINT, SONAR]);
    expect(reconcileContexts({ declared: [LINT, TYPES], live })).toEqual({
      missing: [TYPES],
      // A gate-derived context declares no ruleset, so its record constrains
      // only the name — the repair still routes it through `homes`/fallback.
      missingRecords: [{ context: TYPES }],
      extra: liveEntries([SONAR]),
      matched: [LINT],
    });
  });

  it("keeps a context required by two rulesets missing until both have it", () => {
    // The unit of declaration is a (ruleset, context) PAIR. Reduced to a name,
    // `homes[LINT]` held only the ruleset read LAST, so a live LINT in
    // `release` answered for the `base` requirement too: the declaration read
    // as matched and no repair was ever produced for the ruleset that lacked
    // it. A requirement that does not exist, reported satisfied.
    const result = reconcileContexts({
      declared: [LINT],
      live: [
        {
          context: LINT,
          integration_id: ACTIONS_ID,
          ruleset: "release",
          rulesetId: 8,
        },
      ],
      homes: { [LINT]: "release" },
      records: [
        { context: LINT, ruleset: BASE },
        { context: LINT, ruleset: "release" },
      ],
    });

    expect(result.missing).toEqual([LINT]);
    expect(result.matched).toEqual([]);
    expect(result.missingRecords).toEqual([{ context: LINT, ruleset: BASE }]);
  });

  it("reports a same-ruleset check whose pin differs as the pair still missing", () => {
    // Same name, same ruleset, wrong writer. The requirement the pin exists to
    // establish — that only the named app may satisfy it — is not met, and the
    // repair has to REPLACE the live check rather than sit beside it.
    const result = reconcileContexts({
      declared: [LINT],
      live: liveEntries([LINT]),
      records: [{ context: LINT, ruleset: BASE, integration_id: 99 }],
    });

    expect(result.missing).toEqual([LINT]);
    // Not EXTRA: it is the same requirement in the wrong shape, and listing it
    // there would tell `--prune` to delete what the repair is about to write.
    expect(result.extra).toEqual([]);
    expect(result.missingRecords).toEqual([
      { context: LINT, ruleset: BASE, integration_id: 99 },
    ]);
  });

  it("defaults an unpinned configured check to the Actions integration", () => {
    const result = reconcileContexts({
      declared: [LINT],
      live: [
        {
          context: LINT,
          integration_id: 99,
          ruleset: BASE,
          rulesetId: 7,
        },
      ],
      records: [{ context: LINT, ruleset: BASE }],
    });

    expect(result.missing).toEqual([LINT]);
    expect(result.missingRecords).toEqual([{ context: LINT, ruleset: BASE }]);
  });

  it("keeps a gate-derived check name-only", () => {
    expect(
      reconcileContexts({
        declared: [LINT],
        live: [
          {
            context: LINT,
            integration_id: 99,
            ruleset: BASE,
            rulesetId: 7,
          },
        ],
      }).matched
    ).toEqual([LINT]);
  });

  it("compares by exact string, so confusable pairs never satisfy each other", () => {
    // `🧹 Lint` and `🐢 Slow Lint Rules` are a real shipped pair whose skip
    // tokens are a strict prefix pair. A fuzzy match raises a false alarm whose
    // obvious fix is deleting the guard.
    const result = reconcileContexts({
      declared: [SLOW_LINT],
      live: liveEntries([LINT]),
    });
    expect(result.missing).toEqual([SLOW_LINT]);
    expect(result.matched).toEqual([]);
  });

  it("reports nothing when both sides agree", () => {
    expect(
      reconcileContexts({
        declared: [LINT],
        live: liveEntries([LINT]),
      })
    ).toEqual({ missing: [], missingRecords: [], extra: [], matched: [LINT] });
  });

  it("treats an empty live list as everything missing, not as agreement", () => {
    const result = reconcileContexts({ declared: [LINT, TYPES], live: [] });
    // Written out rather than sorted here: re-running the implementation's own
    // comparator over the expectation would agree with any order it produced.
    expect(result.missing).toEqual([TYPES, LINT]);
    expect(result.matched).toEqual([]);
  });
});

describe("liveContexts and rulesetSignals", () => {
  it("carries the owning ruleset so an EXTRA context can be named", () => {
    expect(liveContexts([baseRuleset([SONAR])])).toEqual([
      {
        context: SONAR,
        integration_id: ACTIONS_ID,
        ruleset: BASE,
        rulesetId: 7,
      },
    ]);
  });

  it("ignores a ruleset that is not actively enforced", () => {
    // An `evaluate` ruleset asserts nothing; counting it would make a dry-run
    // ruleset read as live protection.
    const evaluating = baseRuleset([LINT], { enforcement: "evaluate" });
    expect(liveContexts([evaluating])).toEqual([]);
    expect(rulesetSignals([evaluating]).up_to_date_before_merge).toBe(false);
  });

  it("derives each ruleset-surface policy signal from its rule", () => {
    const signals = rulesetSignals([
      {
        name: BASE,
        enforcement: "active",
        rules: [
          { type: "deletion" },
          { type: "non_fast_forward" },
          { type: "required_linear_history" },
          { type: "required_signatures" },
          {
            type: "required_status_checks",
            parameters: { strict_required_status_checks_policy: true },
          },
          {
            type: "pull_request",
            parameters: {
              required_review_thread_resolution: true,
              dismiss_stale_reviews_on_push: true,
              require_last_push_approval: true,
            },
          },
        ],
      },
    ]);
    expect(signals).toEqual({
      linear: true,
      signed_commits: true,
      force_push: true,
      deletion: true,
      up_to_date_before_merge: true,
      conversation_resolution: true,
      dismiss_stale_reviews: true,
      require_last_push_approval: true,
      // Read off the policy ruleset by name rather than ORed across all of
      // them: these are per-ruleset, and this fixture declares none of them.
      enforcement: "active",
      include_refs: undefined,
      exclude_refs: undefined,
      bypass_actors: undefined,
      required_approving_review_count: undefined,
      require_code_owner_review: undefined,
    });
  });

  it("reads the ruleset shape off the policy ruleset, not off any other", () => {
    const signals = rulesetSignals([
      {
        name: QUALITY_CHECKS,
        enforcement: "active",
        conditions: {
          ref_name: { include: ["refs/heads/other"], exclude: [] },
        },
        bypass_actors: [{ actor_id: 9, actor_type: "Team" }],
        rules: [],
      },
      {
        name: BASE,
        enforcement: "evaluate",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        bypass_actors: [],
        rules: [
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 2,
              require_code_owner_review: true,
            },
          },
        ],
      },
    ]);

    expect(signals.enforcement).toBe("evaluate");
    expect(signals.include_refs).toEqual(["~DEFAULT_BRANCH"]);
    expect(signals.bypass_actors).toEqual([]);
    expect(signals.required_approving_review_count).toBe(2);
    expect(signals.require_code_owner_review).toBe(true);
  });

  it("leaves every shape field unset when the policy ruleset is absent", () => {
    const signals = rulesetSignals([
      { name: QUALITY_CHECKS, enforcement: "active", rules: [] },
    ]);

    expect(signals.enforcement).toBeUndefined();
    expect(signals.include_refs).toBeUndefined();
    expect(signals.bypass_actors).toBeUndefined();
  });

  it("reports every boolean signal false for a repository with no rules", () => {
    expect(Object.values(rulesetSignals([]))).toEqual(Array(8).fill(false));
  });
});

describe("reconcileSettings", () => {
  const live = {
    settings: {
      allow_squash_merge: true,
      has_wiki: false,
      default_branch: "main",
    },
    signals: rulesetSignals([]),
  };

  it("splits declared policy into drift and matched by observed value", () => {
    const result = reconcileSettings({
      policy: {
        on_drift: "repair",
        merge: { squash: false },
        repository: { has_wiki: false, default_branch: "main" },
      },
      live,
    });
    expect(result.drift).toEqual([
      {
        path: "merge.squash",
        declared: false,
        observed: true,
        surface: "repository",
        field: "allow_squash_merge",
      },
    ]);
    expect(
      result.matched.map((finding: { path: string }) => finding.path)
    ).toEqual(["repository.has_wiki", "repository.default_branch"]);
  });

  it("compares only declared fields, never Lisa's taste", () => {
    expect(reconcileSettings({ policy: {}, live }).drift).toEqual([]);
  });

  it("reads ruleset-surface policy from the rule signals, not repo settings", () => {
    const result = reconcileSettings({
      policy: { history: { linear: true } },
      live,
    });
    expect(result.drift).toEqual([
      {
        path: "history.linear",
        declared: true,
        observed: false,
        surface: "ruleset",
        field: "linear",
      },
    ]);
  });

  it("reports a field it cannot observe rather than passing it", () => {
    const result = reconcileSettings({
      policy: { merge: { nonsense: true } },
      live,
    });
    expect(result.unknown).toEqual(["merge.nonsense"]);
    expect(result.matched).toEqual([]);
  });

  it("observes every policy field Lisa's schema declares", () => {
    // Without this, a policy field added upstream becomes one nothing compares
    // — which presents as a clean reconciliation of a setting nobody read.
    expect(unobservablePolicyFields()).toEqual([]);
  });
});

describe("repairTarget", () => {
  const quality = { ...baseRuleset([LINT]), id: 9, name: QUALITY_CHECKS };

  it("picks the single ruleset that requires status checks", () => {
    const { ruleset, problem } = repairTarget([baseRuleset([LINT])]);
    expect(ruleset?.name).toBe(BASE);
    expect(problem).toBeNull();
  });

  it("refuses to guess when more than one ruleset requires checks", () => {
    // Writing to the wrong one puts a context under a different ref-name
    // condition — enforced somewhere other than where it was meant to be.
    const { ruleset, problem } = repairTarget([baseRuleset([LINT]), quality]);
    // A refusal must not also hand back a target, or a caller reading only
    // `ruleset` would write to the very ruleset this refused to choose.
    expect(ruleset).toBeNull();
    expect(problem).toContain("--ruleset=");
    expect(problem).toContain(QUALITY_CHECKS);
  });

  it("honors an explicit name, and refuses one that does not exist", () => {
    expect(
      repairTarget([baseRuleset([LINT]), quality], QUALITY_CHECKS).ruleset?.id
    ).toBe(9);
    expect(repairTarget([baseRuleset([LINT])], "nope").problem).toContain(
      "nope"
    );
  });

  it("refuses when no ruleset requires anything, naming the seeding script", () => {
    expect(repairTarget([{ name: BASE, rules: [] }]).problem).toContain(
      "lisa-github-rulesets.sh"
    );
  });
});

describe("planContextRepairs, through planRepairs", () => {
  const RELEASE = "release";

  it("does not carry one ruleset's pin onto another's unpinned declaration", () => {
    // `pins` is name-keyed and last-write-wins. With `base` declaring LINT
    // UNPINNED and `release` pinning it to app 99, `configured.pins[LINT]` is
    // 99 — so the addition planned for `base` inherited a pin the project never
    // declared there, written by the repair itself. Silently narrowing WHO may
    // satisfy a required check is the same class of harm as widening it: both
    // replace a stated policy with an invented one.
    const rulesets = [
      baseRuleset([], { id: 7, name: BASE }),
      baseRuleset([], { id: 8, name: RELEASE }),
    ];
    const plan = planRepairs({
      contexts: {
        missing: [LINT],
        missingRecords: [
          { context: LINT, ruleset: BASE },
          { context: LINT, ruleset: RELEASE, integration_id: 99 },
        ],
        extra: [],
        matched: [],
      },
      settings: { drift: [], matched: [], unknown: [] },
      live: { rulesets },
      prune: false,
      rulesetName: null,
      awaited: [],
      pins: { [LINT]: 99 },
      homes: { [LINT]: RELEASE },
    });

    const checksIn = name =>
      plan.find(action => action.ruleset === name)?.payload.rules[0].parameters
        .required_status_checks;

    // `base` declared no pin, so it gets the default Actions writer — NOT 99.
    expect(checksIn(BASE)).toEqual([
      { context: LINT, integration_id: ACTIONS_ID },
    ]);
    // `release` declared 99, and still gets exactly that.
    expect(checksIn(RELEASE)).toEqual([{ context: LINT, integration_id: 99 }]);
  });
});

describe("rulesetPayload", () => {
  it("never duplicates a context that is already required", () => {
    const payload = rulesetPayload(baseRuleset([LINT]), { add: [LINT, TYPES] });
    expect(
      payload.rules[0].parameters.required_status_checks.map(
        (check: { context: string }) => check.context
      )
    ).toEqual([LINT, TYPES]);
  });

  it("replaces a same-named check whose pin is wrong, rather than keeping it", () => {
    // The non-convergence: an addition was de-duplicated away by context name,
    // so the PUT kept the live check with the wrong `integration_id` and the
    // repair reported success. The next run found the same drift, planned the
    // same repair, and reported the same success — forever. Only a context the
    // comparison reported unsatisfied HERE reaches `add`, so an existing check
    // of that name in this ruleset is by construction the wrong shape.
    const payload = rulesetPayload(baseRuleset([LINT]), {
      add: [LINT],
      pins: { [LINT]: 99 },
    });

    expect(payload.rules[0].parameters.required_status_checks).toEqual([
      { context: LINT, integration_id: 99 },
    ]);
  });

  it("creates the rule when the ruleset has none, so an addition is never dropped", () => {
    const payload = rulesetPayload(
      { id: 1, name: BASE, rules: [] },
      { add: [LINT] }
    );
    expect(payload.rules[0].type).toBe("required_status_checks");
    expect(payload.rules[0].parameters.required_status_checks).toEqual([
      { context: LINT, integration_id: ACTIONS_ID },
    ]);
  });

  it("preserves rules it was not asked to touch", () => {
    const live = baseRuleset([LINT], {
      rules: [{ type: "deletion" }, ...(baseRuleset([LINT]).rules as object[])],
    });
    const payload = rulesetPayload(live, { add: [TYPES] });
    expect(payload.rules[0]).toEqual({ type: "deletion" });
    expect(payload.rules).toHaveLength(2);
  });

  it("leaves the live ruleset object untouched", () => {
    const live = baseRuleset([LINT]);
    rulesetPayload(live, { add: [TYPES], remove: [LINT] });
    const [rule] = live.rules as {
      parameters: { required_status_checks: object[] };
    }[];
    expect(rule.parameters.required_status_checks).toHaveLength(1);
    expect(live.id).toBe(7);
  });
});

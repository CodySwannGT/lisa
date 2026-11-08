/**
 * Tests for ruleset reconciliation — the behaviors that read the live repo.
 *
 * Three of them carry the weight, and each encodes a measured incident:
 *
 * 1. **UNPROVEN is not clean.** A failed read returns `contexts: null`, not
 *    `{missing: [], extra: [], matched: []}` — because empty sets are exactly
 *    what a clean repository looks like, and a reader who cannot tell them
 *    apart reports "policy matches" having checked nothing.
 * 2. **An EXTRA context is never deleted silently.** Most are external apps
 *    Lisa does not declare (`SonarCloud Code Analysis`), so converging by
 *    deletion strips live protection on the first run.
 * 3. **The alias window.** Both the old and the new context are required for one
 *    release during a rename, or in-flight PRs block on a context that will
 *    never report again — and the fastest fix for whoever is blocked is
 *    deleting the requirement, which is how a rename removes a gate.
 *
 * The pure comparison helpers are covered in the `reconcileContexts` and
 * related suites below.
 * @module tests/unit/scripts/lisa-reconcile-policy
 */

import { describe, expect, it } from "vitest";

import {
  UNPROVEN,
  VERDICT,
  exitCodeFor,
  reconcile,
  render,
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
  GATES,
  type GhState,
  LINT,
  REPO,
  SONAR,
  TYPES,
  baseRuleset,
  boom,
  gitHub,
  recorded,
  run,
  writes,
  writtenContexts,
  liveEntries,
} from "./lisa-reconcile-policy-fixtures.js";
import { buildRulesetPayload } from "../../../scripts/lisa-ruleset-payload.mjs";

const REPAIR = "repair";
const MANUAL = "manual";

describe("UNPROVEN is its own state, never clean and never a drift report", () => {
  const cases: [string, GhState, string][] = [
    [
      "gh is not installed",
      {
        index: {
          ok: false,
          stdout: "",
          stderr: "spawn gh ENOENT",
          missing: true,
        },
      },
      UNPROVEN.NO_CLI,
    ],
    [
      "gh is unauthenticated",
      { index: boom("gh auth login required") },
      UNPROVEN.UNAUTHENTICATED,
    ],
    [
      "the API refuses the read",
      { index: boom("HTTP 403: Upgrade to GitHub Team") },
      UNPROVEN.API_ERROR,
    ],
    [
      "the response is not JSON",
      { index: { ok: true, stdout: "<html>502</html>", stderr: "" } },
      UNPROVEN.MALFORMED,
    ],
  ];

  for (const [label, state, reason] of cases) {
    it(`reports ${reason} when ${label}`, () => {
      const { result } = run(state);
      expect(result.verdict).toBe(VERDICT.UNPROVEN);
      expect(result.unproven?.reason).toBe(reason);
      // Null, not []. Empty sets are what CLEAN looks like.
      expect(result.contexts).toBeNull();
      expect(result.settings).toBeNull();
    });
  }

  it("preserves the failure text verbatim so the operator can act on it", () => {
    const { result } = run({ index: boom("HTTP 403: Upgrade to GitHub Team") });
    expect(result.unproven?.detail).toContain("Upgrade to GitHub Team");
    expect(result.unproven?.command).toBe(`gh api repos/${REPO}/rulesets`);
  });

  it("is unproven when the index reads but a ruleset detail does not", () => {
    // Half a required list compared against a whole declaration reports drift
    // that may not exist.
    const { result } = run({
      rulesets: [baseRuleset([LINT])],
      detail: boom("HTTP 500"),
    });
    expect(result.verdict).toBe(VERDICT.UNPROVEN);
  });

  it("is unproven when the repository settings read fails", () => {
    const { result } = run({
      rulesets: [baseRuleset([LINT, TYPES])],
      settings: boom("HTTP 404"),
    });
    expect(result.verdict).toBe(VERDICT.UNPROVEN);
  });

  it("is unproven when no repository could be resolved", () => {
    const result = reconcile({ repo: null, gates: GATES, gh: gitHub({}) });
    expect(result.unproven?.reason).toBe(UNPROVEN.NO_REPO);
    expect(result.contexts).toBeNull();
  });

  it("exits 2 in every mode, including report, and writes nothing", () => {
    for (const onDrift of [REPAIR, "report", "block"]) {
      const { result, calls } = run({ index: boom("HTTP 500") }, { onDrift });
      expect(exitCodeFor(result)).toBe(2);
      expect(writes(calls)).toEqual([]);
    }
  });

  it("never renders as a match", () => {
    const report = render(run({ index: boom("HTTP 500") }).result);
    expect(report).toContain("UNPROVEN");
    expect(report).toContain('This is not "matches"');
    expect(report).not.toMatch(/^MATCHED/mu);
  });
});

describe("reconcile", () => {
  it("matches when the live contexts equal the derived ones", () => {
    const { result, calls } = run({
      rulesets: [baseRuleset([LINT, TYPES])],
      settings: {},
    });
    expect(result.verdict).toBe(VERDICT.MATCHED);
    expect(result.contexts?.matched).toHaveLength(2);
    expect(result.plan).toEqual([]);
    expect(writes(calls)).toEqual([]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it("adds a MISSING context under repair, by writing the ruleset", () => {
    const { result, calls } = run({
      rulesets: [baseRuleset([LINT])],
      settings: {},
    });
    expect(result.verdict).toBe(VERDICT.DRIFT);
    expect(result.contexts?.missing).toEqual([TYPES]);

    const [write] = writes(calls);
    expect(write.args).toEqual([
      "api",
      "-X",
      "PUT",
      `repos/${REPO}/rulesets/7`,
      "--input",
      "-",
    ]);
    expect(writtenContexts(write.input)).toEqual([LINT, TYPES]);
    // Read-only fields are rejected by the API, so the payload must not carry
    // the ones the live object came back with.
    const payload = JSON.parse(write.input ?? "{}");
    expect(payload.id).toBeUndefined();
    expect(payload._links).toBeUndefined();
    expect(payload.created_at).toBeUndefined();
  });

  it("patches repository settings that drifted from the policy block", () => {
    const { calls } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: { has_wiki: true } },
      { policy: { repository: { has_wiki: false } } }
    );
    const [write] = writes(calls);
    expect(write.args).toEqual([
      "api",
      "-X",
      "PATCH",
      `repos/${REPO}`,
      "--input",
      "-",
    ]);
    expect(JSON.parse(write.input ?? "{}")).toEqual({ has_wiki: false });
  });

  it("reports ruleset-shape policy drift instead of reshaping rules itself", () => {
    // Reshaping rules from two places is how a repair strips a rule it did not
    // understand, so the script that builds them keeps ownership.
    const { result, calls } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: {} },
      { policy: { history: { linear: true } } }
    );
    expect(writes(calls)).toEqual([]);
    expect(result.plan).toEqual([
      {
        kind: MANUAL,
        message: expect.stringContaining("lisa-github-rulesets.sh"),
      },
    ]);
    expect(result.verdict).toBe(VERDICT.DRIFT);
  });
});

describe("an EXTRA context is reported, never removed by default", () => {
  const withSonar: GhState = {
    rulesets: [baseRuleset([LINT, TYPES, SONAR])],
    settings: {},
  };

  it("leaves it in place and names it", () => {
    const { result, calls } = run(withSonar);
    expect(result.contexts?.extra).toEqual([
      {
        context: SONAR,
        integration_id: ACTIONS_ID,
        ruleset: "base",
        rulesetId: 7,
      },
    ]);
    expect(writes(calls)).toEqual([]);
    const [action] = result.plan;
    expect(action.kind).toBe(MANUAL);
    expect(action.message).toContain(SONAR);
    expect(action.message).toContain("NOT removed");
    expect(action.message).toContain("--prune");
  });

  it("removes it only when --prune is passed explicitly", () => {
    const { calls } = run(withSonar, { prune: true });
    expect(writtenContexts(writes(calls)[0].input)).toEqual([LINT, TYPES]);
  });

  it("still writes nothing under --prune when --dry-run is also set", () => {
    const { calls } = run(withSonar, { prune: true, dryRun: true });
    expect(writes(calls)).toEqual([]);
  });
});

describe("the alias window", () => {
  it("requires both the old and the new context for one release", () => {
    const { result } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: {} },
      { previousLabels: ["🧽 Lint"] }
    );
    expect(result.declared).toContain(`${QUALITY} / 🧽 Lint`);
    expect(result.contexts?.missing).toEqual([`${QUALITY} / 🧽 Lint`]);
  });

  it("does not report the retired context as EXTRA while the window is open", () => {
    // The mirror failure: without the pass-through the still-required old
    // context reads as unmanaged, and `--prune` would delete it mid-rename.
    const { result } = run(
      {
        rulesets: [baseRuleset([LINT, TYPES, `${QUALITY} / 🧽 Lint`])],
        settings: {},
      },
      { previousLabels: ["🧽 Lint"] }
    );
    expect(result.verdict).toBe(VERDICT.MATCHED);
    expect(result.contexts?.extra).toEqual([]);
  });
});

describe("on_drift and --dry-run", () => {
  const drifted: GhState = { rulesets: [baseRuleset([LINT])], settings: {} };

  it("writes nothing under report, and exits 0", () => {
    const { result, calls } = run(drifted, { onDrift: "report" });
    expect(writes(calls)).toEqual([]);
    expect(result.plan).not.toEqual([]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it("writes nothing under block, and exits non-zero", () => {
    const { result, calls } = run(drifted, { onDrift: "block" });
    expect(writes(calls)).toEqual([]);
    expect(exitCodeFor(result)).toBe(1);
  });

  it("writes nothing under --dry-run even when on_drift is repair", () => {
    const { result, calls } = run(drifted, { onDrift: REPAIR, dryRun: true });
    expect(writes(calls)).toEqual([]);
    expect(
      result.plan.some((action: { kind: string }) => action.kind === "contexts")
    ).toBe(true);
    expect(render(result)).toContain("nothing was written");
  });

  it("reads on_drift from the policy block when no override is given", () => {
    const gh = gitHub(drifted);
    const result = reconcile({
      repo: REPO,
      gates: GATES,
      gh,
      policy: { on_drift: "block" },
    });
    expect(result.onDrift).toBe("block");
    expect(writes(recorded(gh.mock.calls))).toEqual([]);
  });

  it("exits 1 when a repair write fails, rather than claiming it converged", () => {
    const { result } = run({ ...drifted, write: boom("HTTP 422") });
    expect(exitCodeFor(result)).toBe(1);
    expect(render(result)).toContain("FAILED");
  });

  it("refuses to guess a target ruleset instead of writing to the wrong one", () => {
    const { result, calls } = run({
      rulesets: [
        baseRuleset([LINT]),
        { ...baseRuleset([LINT]), id: 9, name: "quality" },
      ],
      settings: {},
    });
    expect(writes(calls)).toEqual([]);
    expect(result.plan[0]).toEqual({
      kind: MANUAL,
      message: expect.stringContaining("--ruleset="),
    });
  });
});

/**
 * Tests for the pure comparison helpers behind ruleset reconciliation.
 *
 * These never touch `gh`. The behaviors that read a live repository — the
 * UNPROVEN verdict above all — live in the suites above.
 */
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

  it("observes the generated default ruleset as dismissing stale reviews (#4574)", () => {
    // The generator and the drift check must agree: a project that declares
    // `policy.protect.dismiss_stale_reviews: true` and applies the default
    // ruleset has no drift on that field.
    const signals = rulesetSignals([buildRulesetPayload()]);
    expect(signals.dismiss_stale_reviews).toBe(true);
    const result = reconcileSettings({
      policy: { protect: { dismiss_stale_reviews: true } },
      live: { settings: {}, signals },
    });
    expect(result.drift).toEqual([]);
    expect(
      result.matched.map((finding: { path: string }) => finding.path)
    ).toEqual(["protect.dismiss_stale_reviews"]);
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

describe("awaited ruleset overlaps", () => {
  it("accepts the unpinned shape written for an awaited context", () => {
    const result = reconcileContexts({
      declared: [LINT],
      live: [
        {
          context: LINT,
          integration_id: null,
          ruleset: BASE,
          rulesetId: 7,
        },
      ],
      awaited: [{ context: LINT, ruleset: BASE }],
    });

    expect(result.missing).toEqual([]);
  });

  it("does not apply one awaited declaration to the same context elsewhere", () => {
    const result = reconcileContexts({
      declared: [LINT],
      live: [
        {
          context: LINT,
          integration_id: null,
          ruleset: BASE,
          rulesetId: 7,
        },
        {
          context: LINT,
          integration_id: ACTIONS_ID,
          ruleset: "release",
          rulesetId: 8,
        },
      ],
      records: [{ context: LINT, ruleset: "release" }],
      awaited: [{ context: LINT, ruleset: BASE }],
    });

    expect(result.missing).toEqual([]);
    expect(result.matched).toEqual([LINT]);
  });

  it("repairs only the matching ruleset with the awaited unpinned shape", () => {
    const rulesets = [
      baseRuleset([], { id: 7, name: BASE }),
      baseRuleset([], { id: 8, name: "release" }),
    ];
    const plan = planRepairs({
      contexts: {
        extra: [],
        matched: [],
        missing: [LINT],
        missingRecords: [
          { context: LINT, ruleset: BASE },
          { context: LINT, ruleset: "release" },
        ],
      },
      settings: { drift: [], matched: [], unknown: [] },
      live: { rulesets },
      prune: false,
      rulesetName: null,
      awaited: [{ context: LINT, ruleset: BASE }],
    });
    const checksIn = (name: string): unknown =>
      plan.find(action => action.ruleset === name)?.payload.rules[0].parameters
        .required_status_checks;

    expect(checksIn(BASE)).toEqual([{ context: LINT }]);
    expect(checksIn("release")).toEqual([
      { context: LINT, integration_id: ACTIONS_ID },
    ]);
  });

  it("still defaults non-awaited unpinned declarations to Actions", () => {
    const result = reconcileContexts({
      declared: [LINT],
      live: [
        {
          context: LINT,
          integration_id: null,
          ruleset: BASE,
          rulesetId: 7,
        },
      ],
      records: [{ context: LINT, ruleset: BASE }],
      awaited: [],
    });

    expect(result.missing).toEqual([LINT]);
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

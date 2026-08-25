/**
 * Tests for the declarative half of ruleset reconciliation.
 *
 * Three things moved into `.lisa.config.json` and this file is what proves each
 * one reaches GitHub:
 *
 * 1. **`await` gate declarations** replace two vendor status checks a shipped
 *    template pinned into every repository. The mode existed and nothing used
 *    it; a context it derives must now be MATCHED rather than EXTRA, and a
 *    repair must write it with the app id the declaration named.
 * 2. **`github.rulesets.requiredChecks`** replaces the additive-only
 *    `addRequiredChecks`. Its contexts are declared, so they stop reading as
 *    EXTRA, and each one names the ruleset it belongs to.
 * 3. **The ruleset SHAPE** — `enforcement`, ref conditions, `bypass_actors`,
 *    the review counts — is compared for the first time. Those are arrays and
 *    objects, and the comparison used `===`, which would have reported drift on
 *    every run against a repository that agreed with its declaration.
 * @module tests/unit/scripts/lisa-reconcile-policy-declarative
 */

import { describe, expect, it } from "vitest";

import {
  VERDICT,
  awaitedPins,
  declaredChecks,
  reconcile,
  reconcileSettings,
  rulesetPayload,
  sameDeclaredValue,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import {
  ACTIONS_ID,
  REPO,
  baseRuleset,
  gitHub,
  ok,
  recorded,
  writes,
} from "./lisa-reconcile-policy-fixtures.js";

const CODERABBIT = "CodeRabbit";
const GITGUARDIAN = "GitGuardian Security Checks";
const CODERABBIT_APP = 347_564;
const GITGUARDIAN_APP = 46_505;
const PULL_REQUEST = "pull-request";
const QUALITY_CHECKS = "quality checks";
const REPO_ONLY = "🧩 Plugin artifacts match source";
const LOCAL_SECRET_SCAN = "🔐 Local Secret Scan";
const DEFAULT_BRANCH_REF = "~DEFAULT_BRANCH";
const MAIN_REF = "refs/heads/main";
const REPOSITORY_ROLE = "RepositoryRole";

/** A project awaiting both vendor signals, each pinned to its app. */
const AWAIT_GATES = {
  "code-review": {
    [PULL_REQUEST]: {
      level: "required",
      await: CODERABBIT,
      posted_by: CODERABBIT_APP,
    },
  },
  "credential-leakage": {
    [PULL_REQUEST]: {
      level: "required",
      await: GITGUARDIAN,
      posted_by: GITGUARDIAN_APP,
    },
  },
};

/**
 * The body of the one write a reconciliation performed.
 *
 * @param calls Recorded `gh` calls.
 * @returns The parsed payload.
 */
function soleWrite(
  calls: readonly { args: string[]; input?: string }[]
): Record<string, never> & {
  rules: { type: string; parameters: Record<string, unknown> }[];
} {
  const written = writes([...calls]);
  expect(written).toHaveLength(1);
  return JSON.parse(written[0].input as string);
}

/**
 * The required checks in a written payload.
 *
 * @param payload A written ruleset payload.
 * @returns Contexts with their pins.
 */
function checksOf(payload: {
  rules: { type: string; parameters: Record<string, unknown> }[];
}): readonly { context: string; integration_id?: number }[] {
  const rule = payload.rules.find(
    entry => entry.type === "required_status_checks"
  );
  return (rule?.parameters.required_status_checks ?? []) as readonly {
    context: string;
    integration_id?: number;
  }[];
}

describe("an awaited context is declared, not extra", () => {
  it("matches a live vendor context the gates block awaits", () => {
    const gh = gitHub({
      rulesets: [baseRuleset([]) as Record<string, unknown>],
      settings: {},
    });
    const live = baseRuleset([]) as {
      rules: { parameters: { required_status_checks: unknown[] } }[];
    };
    live.rules[0].parameters.required_status_checks = [
      { context: CODERABBIT, integration_id: CODERABBIT_APP },
      { context: GITGUARDIAN, integration_id: GITGUARDIAN_APP },
    ];
    const result = reconcile({
      repo: REPO,
      gates: AWAIT_GATES,
      gh: gitHub({ rulesets: [live as Record<string, unknown>], settings: {} }),
    });

    expect(result.verdict).toBe(VERDICT.MATCHED);
    expect(result.contexts?.matched).toEqual([CODERABBIT, GITGUARDIAN]);
    expect(result.contexts?.extra).toEqual([]);
    expect(gh).toBeDefined();
  });

  // The acceptance criterion, at the unit level: declared and not live is a
  // reported drift, and `repair` converges it.
  it("reports a declared vendor context the live ruleset does not require, and repairs it", () => {
    const gh = gitHub({
      rulesets: [baseRuleset([]) as Record<string, unknown>],
      settings: {},
    });
    const result = reconcile({ repo: REPO, gates: AWAIT_GATES, gh });

    expect(result.verdict).toBe(VERDICT.DRIFT);
    expect(result.contexts?.missing).toEqual([CODERABBIT, GITGUARDIAN]);
    expect(result.outcomes.every(outcome => outcome.applied)).toBe(true);
    expect(checksOf(soleWrite(recorded(gh.mock.calls)))).toEqual([
      { context: CODERABBIT, integration_id: CODERABBIT_APP },
      { context: GITGUARDIAN, integration_id: GITGUARDIAN_APP },
    ]);
  });

  // Pinning an awaited context to the Actions app names the one writer that can
  // never post it, which blocks every pull request in the repository forever.
  it("writes an awaited context unpinned when the project named no app", () => {
    const gh = gitHub({
      rulesets: [baseRuleset([]) as Record<string, unknown>],
      settings: {},
    });
    reconcile({
      repo: REPO,
      gates: {
        "code-review": {
          [PULL_REQUEST]: { level: "required", await: CODERABBIT },
        },
      },
      gh,
    });

    expect(checksOf(soleWrite(recorded(gh.mock.calls)))).toEqual([
      { context: CODERABBIT },
    ]);
  });
});

describe("github.rulesets.requiredChecks", () => {
  it("reads context, home ruleset, and pin out of the declaration", () => {
    expect(
      declaredChecks({
        [QUALITY_CHECKS]: [{ context: REPO_ONLY, integration_id: ACTIONS_ID }],
        base: [{ context: LOCAL_SECRET_SCAN }],
      })
    ).toEqual({
      contexts: [REPO_ONLY, LOCAL_SECRET_SCAN],
      homes: { [REPO_ONLY]: QUALITY_CHECKS, [LOCAL_SECRET_SCAN]: "base" },
      pins: { [REPO_ONLY]: ACTIONS_ID },
      // The records are the declaration; `homes` and `pins` are a name-keyed
      // projection of them that cannot hold two rulesets wanting one context.
      records: [
        {
          context: REPO_ONLY,
          ruleset: QUALITY_CHECKS,
          integration_id: ACTIONS_ID,
        },
        { context: LOCAL_SECRET_SCAN, ruleset: "base" },
      ],
    });
  });

  it("keeps one record per ruleset for a context two rulesets require", () => {
    // `homes[context] = ruleset` is last-write-wins, so this pair collapsed to
    // whichever ruleset was read last, and the other requirement became
    // invisible to both the comparison and the repair.
    const { records, homes } = declaredChecks({
      [QUALITY_CHECKS]: [{ context: REPO_ONLY }],
      base: [{ context: REPO_ONLY }],
    });
    expect(records).toEqual([
      { context: REPO_ONLY, ruleset: QUALITY_CHECKS },
      { context: REPO_ONLY, ruleset: "base" },
    ]);
    expect(homes).toEqual({ [REPO_ONLY]: "base" });
  });

  it("ignores entries that are not objects carrying a string context", () => {
    expect(
      declaredChecks({ base: [null, "bare", { integration_id: 1 }] }).contexts
    ).toEqual([]);
  });

  // Before this, a repository-specific check declared in config was EXTRA by
  // construction — a false alarm whose only offered fixes both lost something.
  it("stops a declared repo-specific context reading as EXTRA", () => {
    const quality = {
      ...(baseRuleset([REPO_ONLY]) as Record<string, unknown>),
      id: 9,
      name: QUALITY_CHECKS,
    };
    const result = reconcile({
      repo: REPO,
      gates: {},
      requiredChecks: { [QUALITY_CHECKS]: [{ context: REPO_ONLY }] },
      gh: gitHub({ rulesets: [quality], settings: {} }),
    });

    expect(result.contexts?.matched).toEqual([REPO_ONLY]);
    expect(result.contexts?.extra).toEqual([]);
    expect(result.verdict).toBe(VERDICT.MATCHED);
  });

  // Writing every missing context into one ruleset put it under whichever
  // ref-name condition that ruleset carries — enforced somewhere other than
  // where it was declared.
  it("repairs a missing context into the ruleset that declares it", () => {
    const base = baseRuleset([]) as Record<string, unknown>;
    const quality = {
      ...(baseRuleset([]) as Record<string, unknown>),
      id: 9,
      name: QUALITY_CHECKS,
    };
    const gh = gitHub({ rulesets: [base, quality], settings: {} });
    const result = reconcile({
      repo: REPO,
      gates: {},
      requiredChecks: { [QUALITY_CHECKS]: [{ context: REPO_ONLY }] },
      gh,
    });

    const written = writes(recorded(gh.mock.calls));
    expect(written).toHaveLength(1);
    expect(written[0].args.join(" ")).toContain("rulesets/9");
    expect(result.plan[0]).toMatchObject({
      kind: "contexts",
      ruleset: QUALITY_CHECKS,
      add: [REPO_ONLY],
    });
  });

  // Two rulesets carry required checks, so the fallback target refuses. A
  // declared home means the refusal never has to be reached — which is what
  // stops `--ruleset` being mandatory on every repository Lisa configures.
  it("needs no --ruleset when every missing context declares its home", () => {
    const base = baseRuleset([]) as Record<string, unknown>;
    const quality = {
      ...(baseRuleset([]) as Record<string, unknown>),
      id: 9,
      name: QUALITY_CHECKS,
    };
    const result = reconcile({
      repo: REPO,
      gates: AWAIT_GATES,
      gh: gitHub({ rulesets: [base, quality], settings: {} }),
    });

    expect(result.plan.filter(action => action.kind === "manual")).toEqual([]);
    expect(result.plan[0]).toMatchObject({ ruleset: "base" });
  });

  it("says so when a declared context names a ruleset the repository lacks", () => {
    const result = reconcile({
      repo: REPO,
      gates: {},
      requiredChecks: { "no such ruleset": [{ context: REPO_ONLY }] },
      gh: gitHub({
        rulesets: [baseRuleset([]) as Record<string, unknown>],
        settings: {},
      }),
    });

    expect(result.plan[0]?.kind).toBe("manual");
    expect(result.plan[0]?.message).toContain("no such ruleset");
  });
});

describe("prune removes a context from the ruleset that requires it", () => {
  // A removal written into the fallback target dropped a context that target
  // never required: GitHub accepted the write and the check stayed required.
  it("writes the removal to the ruleset carrying the extra context", () => {
    const base = baseRuleset([]) as Record<string, unknown>;
    const quality = {
      ...(baseRuleset(["🐢 Stale"]) as Record<string, unknown>),
      id: 9,
      name: QUALITY_CHECKS,
    };
    const gh = gitHub({ rulesets: [base, quality], settings: {} });
    reconcile({ repo: REPO, gates: {}, prune: true, gh });

    const written = writes(recorded(gh.mock.calls));
    expect(written).toHaveLength(1);
    expect(written[0].args.join(" ")).toContain("rulesets/9");
    expect(checksOf(JSON.parse(written[0].input as string))).toEqual([]);
  });
});

describe("the ruleset shape is compared, not just the booleans", () => {
  const live = {
    settings: {},
    signals: {
      enforcement: "active",
      include_refs: [DEFAULT_BRANCH_REF, MAIN_REF],
      bypass_actors: [{ actor_id: 5, actor_type: REPOSITORY_ROLE }],
      required_approving_review_count: 0,
    },
  };

  it("treats an identical array as matched rather than as drift", () => {
    const { drift, matched } = reconcileSettings({
      policy: {
        ruleset: {
          include_refs: [DEFAULT_BRANCH_REF, MAIN_REF],
          bypass_actors: [{ actor_id: 5, actor_type: REPOSITORY_ROLE }],
        },
      },
      live,
    });

    expect(drift).toEqual([]);
    expect(matched.map(finding => finding.path)).toEqual([
      "ruleset.include_refs",
      "ruleset.bypass_actors",
    ]);
  });

  // Order is meaningful in a ref-name list a human reads line by line, so the
  // comparison must not be order-insensitive.
  it("reports a reordered ref list as drift", () => {
    const { drift } = reconcileSettings({
      policy: {
        ruleset: { include_refs: [MAIN_REF, DEFAULT_BRANCH_REF] },
      },
      live,
    });

    expect(drift.map(finding => finding.path)).toEqual([
      "ruleset.include_refs",
    ]);
  });

  it("reports a changed enforcement as drift on the ruleset surface", () => {
    const { drift } = reconcileSettings({
      policy: { ruleset: { enforcement: "evaluate" } },
      live,
    });

    expect(drift[0]).toMatchObject({
      path: "ruleset.enforcement",
      declared: "evaluate",
      observed: "active",
      surface: "ruleset",
    });
  });
});

describe("sameDeclaredValue", () => {
  it("compares primitives by identity and structures by content", () => {
    expect(sameDeclaredValue(true, true)).toBe(true);
    expect(sameDeclaredValue(0, false)).toBe(false);
    expect(sameDeclaredValue(["a"], ["a"])).toBe(true);
    expect(sameDeclaredValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameDeclaredValue(undefined, [])).toBe(false);
    expect(sameDeclaredValue(null, null)).toBe(true);
  });

  // `bypass_actors` entries are objects: GitHub emits its own key order and the
  // declaration is hand-authored, so a serializer that preserves insertion
  // order would report drift forever against a repository that agrees exactly.
  it("ignores object key order, which no writer controls", () => {
    expect(
      sameDeclaredValue(
        [{ actor_id: 5, actor_type: REPOSITORY_ROLE, bypass_mode: "always" }],
        [{ bypass_mode: "always", actor_type: REPOSITORY_ROLE, actor_id: 5 }]
      )
    ).toBe(true);
    expect(
      sameDeclaredValue({ a: { b: 1, c: 2 } }, { a: { c: 2, b: 1 } })
    ).toBe(true);
  });

  // Ignoring key order must not become ignoring content.
  it("still reports a real difference inside a reordered object", () => {
    expect(
      sameDeclaredValue(
        [{ actor_id: 5, actor_type: REPOSITORY_ROLE }],
        [{ actor_type: REPOSITORY_ROLE, actor_id: 6 }]
      )
    ).toBe(false);
  });

  // Array order is a real difference: a ref list is read line by line.
  it("keeps array order significant", () => {
    expect(
      sameDeclaredValue(
        [DEFAULT_BRANCH_REF, MAIN_REF],
        [MAIN_REF, DEFAULT_BRANCH_REF]
      )
    ).toBe(false);
  });
});

describe("awaitedPins", () => {
  it("returns only the awaited gates that named an app", () => {
    expect(awaitedPins(AWAIT_GATES, PULL_REQUEST)).toEqual({
      [CODERABBIT]: CODERABBIT_APP,
      [GITGUARDIAN]: GITGUARDIAN_APP,
    });
    expect(
      awaitedPins(
        {
          "code-review": {
            [PULL_REQUEST]: { level: "required", await: CODERABBIT },
          },
        },
        PULL_REQUEST
      )
    ).toEqual({});
  });
});

describe("rulesetPayload pins", () => {
  it("prefers a declared pin over the Actions default", () => {
    const payload = rulesetPayload(baseRuleset([]) as Record<string, unknown>, {
      add: [GITGUARDIAN, "🧹 Lint"],
      awaited: [GITGUARDIAN],
      pins: { [GITGUARDIAN]: GITGUARDIAN_APP },
    });

    expect(
      checksOf(
        payload as {
          rules: { type: string; parameters: Record<string, unknown> }[];
        }
      )
    ).toEqual([
      { context: GITGUARDIAN, integration_id: GITGUARDIAN_APP },
      { context: "🧹 Lint", integration_id: ACTIONS_ID },
    ]);
  });
});

describe("ok fixture", () => {
  it("is exported for callers that build their own responses", () => {
    expect(ok([]).ok).toBe(true);
  });
});

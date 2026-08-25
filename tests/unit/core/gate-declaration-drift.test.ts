/**
 * The comparator that holds a gates declaration against the ruleset enforcing
 * it.
 *
 * The assertions that matter are the ones about NOT collapsing states: `off`
 * must not read as undeclared, undeclared must not read as "not required", and
 * a third-party context must not sit in the same bucket as a Lisa gate that
 * fell out of the settings file. Each of those collapses would produce a
 * comparator that runs, reports, and proves nothing.
 * @module tests/unit/core/gate-declaration-drift
 */
/* eslint-disable max-lines -- one comparator, and the #3067 rename cases
   belong beside the verdicts they are distinguished from */
import { describe, expect, it } from "vitest";

import {
  classifyDeclarationDrift,
  contextOwners,
  declaredRequiredContexts,
  type ContextOwner,
  type DriftRemedy,
  type EnforcedContext,
  type MergeContextRegistry,
} from "../../../src/core/gate-declaration-drift.js";

const WORKFLOW = "🔍 Quality Checks";
const SECURITY = `${WORKFLOW} / 🔒 Security Scan`;
const LINT = `${WORKFLOW} / 🧹 Lint`;
const TEMPLATE = "typescript/github-rulesets/quality-checks.json";
const QUALITY_CHECKS = "quality checks";
const CODERABBIT = "CodeRabbit";
const TEMPLATES_SURFACE = "ruleset-templates";
const LIVE_SURFACE = "live-ruleset";
const REQUIRED = "required";
const OFF = "off";
const NOT_DECLARED = "not-declared";
const DEPENDENCY_VULNERABILITY = "dependency-vulnerability";
const ENFORCED_UNDECLARED = "enforced-undeclared";
/** The context 4.x renamed away, and the one the same job posts now. */
const AST_GREP = `${WORKFLOW} / 🔎 AST Grep Scan`;
const STRUCTURAL = `${WORKFLOW} / 🔎 Structural Rules`;
const STRUCTURAL_RULES = "structural-rules";
const RETIRED_VERDICT = "enforced-context-retired";
const REMOVAL_REMEDY = "stop-requiring-the-retired-context";
/** The hand-made ruleset in #3067 — one Lisa does not manage. */
const HAND_MADE = "enforce pr rules";
const LIVE_SOURCE = "the repository’s live rulesets";
const NOT_LISA_OWNED = "enforced-not-lisa-owned";
const LINT_LABEL = "🧹 Lint";
const REVIEW_LABEL = "🤖 Code Review";
const PULL_REQUEST = "pull-request";

/**
 * An owner for the retired half of a rename, at a given declaration.
 * @param declaration - What the settings file says about the gate
 * @returns The owner
 */
function retiredOwner(declaration: ContextOwner["declaration"]): ContextOwner {
  return {
    gateId: STRUCTURAL_RULES,
    declaration,
    legalAtMerge: true,
    retired: { label: "🔎 AST Grep Scan", replacement: STRUCTURAL },
  };
}

/**
 * An owner for a live label, at a given declaration.
 * @param declaration - What the settings file says about the gate
 * @returns The owner
 */
function plainOwner(declaration: ContextOwner["declaration"]): ContextOwner {
  return {
    gateId: STRUCTURAL_RULES,
    declaration,
    legalAtMerge: true,
    retired: null,
  };
}

/**
 * One enforced context, attributed to a template file.
 * @param context - The context string
 * @returns The enforced context
 */
function fromTemplate(context: string): EnforcedContext {
  return { context, ruleset: QUALITY_CHECKS, source: TEMPLATE };
}

/**
 * Owners for a fixed set of contexts.
 * @param entries - Context to declaration
 * @returns The owner map
 */
function owners(
  entries: Readonly<Record<string, ContextOwner["declaration"]>>
): ReadonlyMap<string, ContextOwner> {
  return new Map(
    Object.entries(entries).map(([context, declaration]) => [
      context,
      {
        gateId: `gate-for-${context}`,
        declaration,
        legalAtMerge: true,
        retired: null,
      },
    ])
  );
}

describe("classifyDeclarationDrift", () => {
  it("reports a required context no declaration asks for, naming the gate and the template", () => {
    const report = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: new Map([
        [
          SECURITY,
          {
            gateId: DEPENDENCY_VULNERABILITY,
            declaration: NOT_DECLARED,
            legalAtMerge: true,
            retired: null,
          },
        ],
      ]),
      enforced: [fromTemplate(SECURITY)],
    });
    const entry = report.entries[0];

    expect(entry?.verdict).toBe(ENFORCED_UNDECLARED);
    expect(entry?.gateId).toBe(DEPENDENCY_VULNERABILITY);
    expect(entry?.sources).toEqual([TEMPLATE]);
    expect(entry?.detail).toContain(DEPENDENCY_VULNERABILITY);
    expect(entry?.detail).toContain(TEMPLATE);
  });

  it("reports a declared requirement the enforcing surface omits as drift", () => {
    const report = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: owners({ [LINT]: REQUIRED }),
      enforced: [fromTemplate(SECURITY)],
    });

    expect(report.entries.find(entry => entry.context === LINT)?.verdict).toBe(
      "declared-not-enforced"
    );
    expect(report.contradictions).toBe(1);
  });

  it("separates an off declaration contradicted by protection from an undeclared one", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [LINT]: OFF, [SECURITY]: NOT_DECLARED }),
      enforced: [fromTemplate(LINT), fromTemplate(SECURITY)],
    });
    const verdicts = new Map(
      report.entries.map(entry => [entry.context, entry.verdict])
    );

    expect(verdicts.get(LINT)).toBe("enforced-declared-off");
    expect(verdicts.get(SECURITY)).toBe(ENFORCED_UNDECLARED);
    expect(report.contradictions).toBe(1);
    expect(report.gaps).toBe(1);
  });

  it("never offers a remedy that removes a live required context", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [LINT]: OFF, [SECURITY]: NOT_DECLARED }),
      enforced: [
        fromTemplate(LINT),
        fromTemplate(SECURITY),
        fromTemplate(CODERABBIT),
      ],
    });
    const remedies: readonly DriftRemedy[] = [
      "none",
      "declare-the-gate",
      "enforce-the-context",
      "resolve-the-contradiction",
      "decide-which-surface-wins",
    ];

    for (const entry of report.entries) {
      expect(remedies).toContain(entry.remedy);
      expect(entry.detail.toLowerCase()).not.toContain("remove this context");
    }
    expect(
      report.entries.find(entry => entry.context === SECURITY)?.remedy
    ).toBe("declare-the-gate");
  });

  it("reaches the removal remedy only from a registry-proved rename", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        ...owners({ [LINT]: OFF, [SECURITY]: NOT_DECLARED, [AST_GREP]: OFF }),
        [AST_GREP, retiredOwner(OFF)],
      ]),
      enforced: [
        fromTemplate(LINT),
        fromTemplate(SECURITY),
        fromTemplate(CODERABBIT),
        fromTemplate(AST_GREP),
      ],
    });

    for (const entry of report.entries) {
      expect(entry.remedy === REMOVAL_REMEDY).toBe(
        entry.verdict === RETIRED_VERDICT
      );
    }
    expect(
      report.entries.filter(entry => entry.remedy === REMOVAL_REMEDY)
    ).toHaveLength(1);
  });

  it("keeps a third-party context out of the bucket that indicates a defect", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [SECURITY]: NOT_DECLARED }),
      enforced: [fromTemplate(CODERABBIT), fromTemplate(SECURITY)],
    });
    const verdicts = new Map(
      report.entries.map(entry => [entry.context, entry.verdict])
    );

    expect(verdicts.get(CODERABBIT)).toBe(NOT_LISA_OWNED);
    expect(verdicts.get(SECURITY)).toBe(ENFORCED_UNDECLARED);
    expect(report.gaps).toBe(1);
  });

  it("calls an optional declaration a disagreement rather than a match", () => {
    const report = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: owners({ [SECURITY]: "optional" }),
      enforced: [fromTemplate(SECURITY)],
    });

    expect(report.entries[0]?.verdict).toBe("enforced-declared-optional");
    expect(report.entries[0]?.remedy).toBe("decide-which-surface-wins");
    expect(report.counts.matched).toBe(0);
  });

  it("states a zero for every verdict, so an absent count is never an absent key", () => {
    const report = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: owners({ [LINT]: REQUIRED }),
      enforced: [fromTemplate(LINT)],
    });

    expect(report.counts).toEqual({
      matched: 1,
      "declared-not-enforced": 0,
      "enforced-declared-optional": 0,
      "enforced-declared-off": 0,
      "enforced-undeclared": 0,
      "enforced-not-lisa-owned": 0,
      "enforced-context-retired": 0,
    });
  });

  it("groups every ruleset and source that required one context", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [LINT]: REQUIRED }),
      enforced: [
        { context: LINT, ruleset: QUALITY_CHECKS, source: TEMPLATE },
        {
          context: LINT,
          ruleset: "base",
          source: "all/github-rulesets/base.json",
        },
      ],
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.rulesets).toEqual(["base", "quality checks"]);
  });

  it("orders entries identically for the same inputs in any order", () => {
    const first = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: owners({ [LINT]: REQUIRED, [SECURITY]: OFF }),
      enforced: [fromTemplate(SECURITY), fromTemplate(LINT)],
    });
    const second = classifyDeclarationDrift({
      surface: TEMPLATES_SURFACE,
      owners: owners({ [SECURITY]: OFF, [LINT]: REQUIRED }),
      enforced: [fromTemplate(LINT), fromTemplate(SECURITY)],
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

/** A registry with two gates and a resolver that honours the gates block. */
const REGISTRY: MergeContextRegistry = {
  REGISTRY: {
    lint: { label: LINT_LABEL, moments: [PULL_REQUEST, "push"] },
    "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
  },
  resolveMoment: ({ gates }) =>
    Object.entries(gates).flatMap(([id, value]) => {
      const level = (value as Record<string, unknown>)["pull-request"];
      const awaits = (value as Record<string, unknown>)["await"];
      return typeof level === "string"
        ? [
            {
              id,
              level,
              mode: typeof awaits === "string" ? "await" : "run",
              awaits: typeof awaits === "string" ? awaits : null,
            },
          ]
        : [];
    }),
  momentFamily: moment => moment,
};

/** The same registry, with `lint` recorded as renamed away from `🧽 Lint`. */
const RENAMED_REGISTRY: MergeContextRegistry = {
  ...REGISTRY,
  REGISTRY: {
    lint: {
      label: LINT_LABEL,
      moments: [PULL_REQUEST, "push"],
      previousLabels: ["🧽 Lint"],
    },
    "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
  },
};

describe("a third-party app status against a Lisa job name", () => {
  // `GitGuardian Security Checks` is a REQUIRED context on this repository's
  // live ruleset, and it is the GitGuardian App's own status — not the
  // `secret_scanning` job, and not any registry gate's label. A comparator
  // that matched on a job name that merely resembled it would report the app
  // status as a Lisa gate: a false drift report when the gate is undeclared,
  // and — the worse direction — a false clean one when it is declared.
  const GITGUARDIAN = "GitGuardian Security Checks";
  const SECRET_SCANNING = `${WORKFLOW} / 🔒 Secret Scanning`;

  it("does not let a similarly named Lisa gate own the app's status", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        [
          SECRET_SCANNING,
          {
            gateId: "static-security",
            declaration: REQUIRED,
            legalAtMerge: true,
            retired: null,
          },
        ],
      ]),
      enforced: [fromTemplate(GITGUARDIAN)],
    });
    const entry = report.entries.find(one => one.context === GITGUARDIAN);

    expect(entry?.verdict).toBe(NOT_LISA_OWNED);
    expect(entry?.gateId).toBeNull();
    // And the Lisa gate is still reported as unenforced rather than quietly
    // satisfied by the app status standing near it.
    expect(
      report.entries.find(one => one.context === SECRET_SCANNING)?.verdict
    ).toBe("declared-not-enforced");
  });

  it("does not claim a matched context proves anything", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [LINT]: REQUIRED }),
      enforced: [fromTemplate(LINT)],
    });

    expect(report.entries[0]?.verdict).toBe("matched");
    expect(report.entries[0]?.detail).toContain("agree");
    expect(report.entries[0]?.detail).toContain("not evidence");
  });
});

describe("contextOwners", () => {
  it("owns a context for every registry gate, declared or not", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: {},
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)).toEqual({
      gateId: "lint",
      declaration: NOT_DECLARED,
      legalAtMerge: true,
      retired: null,
    });
    expect(map.get(`${WORKFLOW} / 🤖 Code Review`)?.declaration).toBe(
      NOT_DECLARED
    );
  });

  it("owns the awaited signal's own name for an await gate", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: {
        "code-review": { "pull-request": REQUIRED, await: "CodeRabbit" },
      },
      workflowName: WORKFLOW,
    });

    expect(map.get("CodeRabbit")).toEqual({
      gateId: "code-review",
      declaration: REQUIRED,
      legalAtMerge: true,
      retired: null,
    });
  });

  it("owns a retired label the registry records, alongside the current one", () => {
    const map = contextOwners({
      registry: RENAMED_REGISTRY,
      gates: { lint: { "pull-request": REQUIRED } },
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)?.retired).toBeNull();
    expect(map.get(`${WORKFLOW} / 🧽 Lint`)).toEqual({
      gateId: "lint",
      declaration: REQUIRED,
      legalAtMerge: true,
      retired: { label: "🧽 Lint", replacement: LINT },
    });
  });

  it("does not treat a retired label another gate now posts as retired", () => {
    // `🤖 Code Review` is `code-review`'s CURRENT label here, and also listed
    // as a label `lint` was renamed away from. Something posts that string
    // every run, so requiring it is not a permanent wait — flagging it would
    // tell an operator to delete a requirement that works.
    const reused: MergeContextRegistry = {
      ...RENAMED_REGISTRY,
      REGISTRY: {
        lint: {
          label: LINT_LABEL,
          moments: [PULL_REQUEST],
          previousLabels: [REVIEW_LABEL],
        },
        "code-review": { label: REVIEW_LABEL, moments: [PULL_REQUEST] },
      },
    };

    expect(
      contextOwners({
        registry: reused,
        gates: {},
        workflowName: WORKFLOW,
      }).get(`${WORKFLOW} / 🤖 Code Review`)?.retired
    ).toBeNull();
  });

  it("treats a level Lisa does not know as undeclared rather than as a claim", () => {
    const map = contextOwners({
      registry: REGISTRY,
      gates: { lint: { "pull-request": "mandatory" } },
      workflowName: WORKFLOW,
    });

    expect(map.get(LINT)?.declaration).toBe(NOT_DECLARED);
  });

  it("compares nothing rather than throwing when the gates block will not resolve", () => {
    const throwing: MergeContextRegistry = {
      ...REGISTRY,
      resolveMoment: () => {
        throw new Error("unknown moment key");
      },
    };

    expect(
      contextOwners({
        registry: throwing,
        gates: {},
        workflowName: WORKFLOW,
      }).get(LINT)?.declaration
    ).toBe(NOT_DECLARED);
  });
});

describe("declaredRequiredContexts", () => {
  it("lists only the contexts a required declaration promises", () => {
    expect(
      declaredRequiredContexts(
        owners({ [LINT]: REQUIRED, [SECURITY]: "optional" })
      )
    ).toEqual([LINT]);
  });

  it("never promises a retired name, whatever the gate is declared", () => {
    // Without this the check meant to find the permanent-pending trap would
    // create one: the old name would be listed as a promise, come back as
    // `declared-not-enforced`, and the remedy would read "start requiring a
    // context nothing posts".
    expect(
      declaredRequiredContexts(
        new Map([
          [LINT, plainOwner(REQUIRED)] as const,
          [AST_GREP, retiredOwner(REQUIRED)] as const,
        ])
      )
    ).toEqual([LINT]);
  });
});

describe("a required context Lisa itself renamed away", () => {
  // #3067. 4.x renamed the quality job `🔎 AST Grep Scan` to
  // `🔎 Structural Rules`. A repository whose hand-made ruleset still required
  // the old name was left with a check that CANNOT report: not red, absent.
  // GitHub holds it at "Expected — Waiting for status to be reported", so the
  // pull request sat MERGEABLE and BLOCKED with every check green and nothing
  // anywhere naming the cause.
  it("does not read the old name as satisfied by the gate still being required", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        [STRUCTURAL, plainOwner(REQUIRED)] as const,
        [AST_GREP, retiredOwner(REQUIRED)] as const,
      ]),
      enforced: [
        { context: AST_GREP, ruleset: HAND_MADE, source: LIVE_SOURCE },
        { context: STRUCTURAL, ruleset: QUALITY_CHECKS, source: LIVE_SOURCE },
      ],
    });
    const verdicts = new Map(
      report.entries.map(entry => [entry.context, entry.verdict])
    );

    // The declaration branch must not run first. The gate IS declared
    // required and DOES run on every pull request — it posts the new name, so
    // reading the declaration first would call the blocking context `matched`.
    expect(verdicts.get(AST_GREP)).toBe(RETIRED_VERDICT);
    expect(verdicts.get(STRUCTURAL)).toBe("matched");
    expect(report.unpostable).toBe(1);
  });

  it("treats an owner that predates the rename field as not retired", () => {
    // A consumer holding an older `ContextOwner` shape carries no `retired`
    // key at all. Reading that as `undefined !== null` would classify EVERY
    // required context as retired and tell the operator to delete their whole
    // required list — the failure this check exists to prevent, inverted.
    const legacy = {
      gateId: STRUCTURAL_RULES,
      declaration: REQUIRED,
      legalAtMerge: true,
    } as unknown as ContextOwner;
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([[STRUCTURAL, legacy] as const]),
      enforced: [
        { context: STRUCTURAL, ruleset: QUALITY_CHECKS, source: LIVE_SOURCE },
      ],
    });

    expect(report.entries[0]?.verdict).toBe("matched");
    expect(report.unpostable).toBe(0);
  });

  it("says the check can never report rather than that it failed", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([[AST_GREP, retiredOwner(REQUIRED)] as const]),
      enforced: [
        { context: AST_GREP, ruleset: HAND_MADE, source: LIVE_SOURCE },
      ],
    });
    const detail = report.entries[0]?.detail ?? "";

    expect(detail).toContain("NOTHING WILL EVER POST THIS");
    expect(detail).toContain("Waiting for status to be reported");
    expect(detail).toContain(STRUCTURAL);
    expect(detail).toContain(HAND_MADE);
    expect(detail).not.toContain("failed");
  });

  it("names the ruleset holding it and says Lisa will not edit it", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([[AST_GREP, retiredOwner(REQUIRED)] as const]),
      enforced: [
        { context: AST_GREP, ruleset: HAND_MADE, source: LIVE_SOURCE },
      ],
    });

    expect(report.entries[0]?.rulesets).toEqual([HAND_MADE]);
    expect(report.entries[0]?.detail).toContain("never edited automatically");
    expect(report.entries[0]?.remedy).toBe(REMOVAL_REMEDY);
  });

  it("counts it apart from a contradiction and from a gap", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        ...owners({ [SECURITY]: OFF }),
        [AST_GREP, retiredOwner(REQUIRED)] as const,
      ]),
      enforced: [
        { context: AST_GREP, ruleset: HAND_MADE, source: LIVE_SOURCE },
        fromTemplate(SECURITY),
      ],
    });

    expect(report.unpostable).toBe(1);
    expect(report.contradictions).toBe(1);
    expect(report.gaps).toBe(0);
  });

  // THE NEGATIVE CONTROL. A repository whose required contexts are all
  // produced — Lisa's current labels plus a third-party app status — must not
  // be flagged. A sweep that reported every externally-produced context would
  // be noise, and noise is what gets a control ignored.
  it("leaves a repository whose required contexts are all produced unflagged", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        ...owners({ [STRUCTURAL]: REQUIRED, [LINT]: REQUIRED }),
        [AST_GREP, retiredOwner(REQUIRED)] as const,
      ]),
      enforced: [
        { context: STRUCTURAL, ruleset: QUALITY_CHECKS, source: LIVE_SOURCE },
        { context: LINT, ruleset: QUALITY_CHECKS, source: LIVE_SOURCE },
        { context: CODERABBIT, ruleset: HAND_MADE, source: LIVE_SOURCE },
      ],
    });
    const verdicts = new Map(
      report.entries.map(entry => [entry.context, entry.verdict])
    );

    expect(report.unpostable).toBe(0);
    expect(report.counts[RETIRED_VERDICT]).toBe(0);
    // The third-party status is still reported as third-party, and its remedy
    // is still "none" — being unowned is not evidence that nothing posts it.
    expect(verdicts.get(CODERABBIT)).toBe(NOT_LISA_OWNED);
    expect(
      report.entries.find(entry => entry.context === CODERABBIT)?.remedy
    ).toBe("none");
  });
});
/* eslint-enable max-lines -- restore repository defaults */

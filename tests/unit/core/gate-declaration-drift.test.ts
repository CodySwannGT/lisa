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
      { gateId: `gate-for-${context}`, declaration, legalAtMerge: true },
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

  it("keeps a third-party context out of the bucket that indicates a defect", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: owners({ [SECURITY]: NOT_DECLARED }),
      enforced: [fromTemplate(CODERABBIT), fromTemplate(SECURITY)],
    });
    const verdicts = new Map(
      report.entries.map(entry => [entry.context, entry.verdict])
    );

    expect(verdicts.get(CODERABBIT)).toBe("enforced-not-lisa-owned");
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
    lint: { label: "🧹 Lint", moments: ["pull-request", "push"] },
    "code-review": { label: "🤖 Code Review", moments: ["pull-request"] },
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
    });
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
});

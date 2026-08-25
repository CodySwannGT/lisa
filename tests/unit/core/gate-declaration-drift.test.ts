/**
 * The comparator that holds a gates declaration against the ruleset enforcing
 * it.
 *
 * The assertions that matter are the ones about NOT collapsing states: `off`
 * must not read as undeclared, undeclared must not read as "not required", and
 * a third-party context must not sit in the same bucket as a Lisa gate that
 * fell out of the settings file. Each of those collapses would produce a
 * comparator that runs, reports, and proves nothing.
 *
 * The ownership map these verdicts are read against is built elsewhere and
 * tested in `tests/unit/core/gate-context-owners`, along the same seam the
 * source modules split on: that suite proves which gate owns a context, this
 * one proves what the comparator makes of an owner it is handed. The one
 * verdict #3067 added — a required context that can never report at all —
 * has its own file in `gate-declaration-drift-retirement`.
 * @module tests/unit/core/gate-declaration-drift
 */
import { describe, expect, it } from "vitest";

import {
  classifyDeclarationDrift,
  declaredRequiredContexts,
  type DriftRemedy,
} from "../../../src/core/gate-declaration-drift.js";
import {
  AST_GREP,
  CODERABBIT,
  DEPENDENCY_VULNERABILITY,
  ENFORCED_UNDECLARED,
  LINT,
  LIVE_SURFACE,
  NOT_DECLARED,
  NOT_LISA_OWNED,
  OFF,
  QUALITY_CHECKS,
  REMOVAL_REMEDY,
  REQUIRED,
  RETIRED_VERDICT,
  SECURITY,
  TEMPLATE,
  TEMPLATES_SURFACE,
  WORKFLOW,
  fromTemplate,
  owners,
  plainOwner,
  retiredOwner,
} from "./gate-declaration-drift-fixtures.js";

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

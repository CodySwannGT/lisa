/**
 * The one verdict that says a required check can never report at all.
 *
 * #3067. 4.x renamed the quality job `🔎 AST Grep Scan` to
 * `🔎 Structural Rules`, and a repository whose hand-made ruleset still
 * required the old name was left with a check that is not red but ABSENT:
 * GitHub holds it at "Expected — Waiting for status to be reported", so every
 * pull request sat MERGEABLE and BLOCKED, every check green, nothing anywhere
 * naming the cause.
 *
 * Its own file because the property under test is different in kind from the
 * rest of the verdict table. Everywhere else a verdict describes a
 * DISAGREEMENT between two surfaces that both speak; here both surfaces agree
 * and the check is simply gone, which is why it needed a verdict, a remedy and
 * a count of its own rather than a place in an existing bucket.
 * @module tests/unit/core/gate-declaration-drift-retirement
 */
import { describe, expect, it } from "vitest";

import { classifyDeclarationDrift } from "../../../src/core/gate-declaration-drift.js";
import {
  AST_GREP,
  CODERABBIT,
  HAND_MADE,
  LINT,
  LIVE_SOURCE,
  LIVE_SURFACE,
  NOT_LISA_OWNED,
  OFF,
  QUALITY_CHECKS,
  REMOVAL_REMEDY,
  REQUIRED,
  RETIRED_VERDICT,
  SECURITY,
  STRUCTURAL,
  STRUCTURAL_RULES,
  fromTemplate,
  owners,
  plainOwner,
  retiredOwner,
} from "./gate-declaration-drift-fixtures.js";

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

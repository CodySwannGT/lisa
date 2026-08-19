/**
 * Bite tests for the design-intake gate — the judgment rung of the
 * design-handoff policy.
 *
 * A skill that says "block when information is missing" and never blocks is a
 * decoration. So is one that blocks on everything: the first project to adopt
 * it turns it off, and the control is gone with nothing to notice. Both halves
 * are therefore asserted here, deliberately paired:
 *
 * - a typed axis with a hardcoded literal **blocks**
 * - the **identical** literal in an untyped axis does **not**
 * - aesthetic ambiguity with everything bound does **not**
 *
 * Verified by mutation rather than assumed. Against an always-PROCEED
 * implementation the four blocking tests fail; against an always-BLOCK
 * implementation the two non-blocking tests fail. Neither degenerate gate
 * passes this file.
 * @module tests/unit/strategies/design-intake-gate
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_CONDITIONS,
  CONDITION_OWNERS,
  ENGINEERING_VOCABULARY,
  evaluateDesignIntake,
} from "../../../plugins/src/base/scripts/design-intake-gate.mjs";

/** Fixture values reused across cases, hoisted so the literals live in one place. */
const ASSIGNEE = "design-owner-handle";
const LABEL = "needs-design";
const SOURCE = "design-library-ref";
const CARD = "Raised card";
const BRAND = "#3A7BD5";
const FRAME_BRAND = "#2F6BC0";
const SURFACE_TOKEN = "surface/raised";
const COLOR = "color";
const HARDCODED = "hardcoded-in-design";
const UNPUBLISHED = "unpublished-component";
const MEASURED_OVER_BINDING = "measured-over-binding";
const MISSING_STATE = "missing-state";
const MISSING_TOKEN = "missing-token";
const DISAGREEMENT = "source-disagreement";

/** A fully configured host. Individual tests strip what they are testing. */
const CONFIGURED = {
  design: {
    tokens: { source: SOURCE },
    escalation: { assignee: ASSIGNEE, label: LABEL },
  },
};

/** Colour is published; spacing is not. The common real-world regime. */
const MIXED_REGIME = { color: "typed", spacing: "untyped" };

/**
 * Assert a reason reads as something a non-technical operator can act on:
 * present, substantial, and free of factory vocabulary.
 * @param text - The reason or comment under test.
 */
const expectPlainLanguage = (text: unknown): void => {
  expect(typeof text).toBe("string");
  expect(String(text).trim().length).toBeGreaterThan(40);
  for (const word of ENGINEERING_VOCABULARY) {
    expect(String(text).toLowerCase()).not.toContain(word.toLowerCase());
  }
};

describe("design-intake gate", () => {
  it("blocks a hardcoded literal in a typed axis, naming an assignee and a plain-language reason", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        {
          kind: HARDCODED,
          axis: COLOR,
          component: CARD,
          value: BRAND,
        },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.condition).toBe(HARDCODED);
    expect(result.assignee).toBe(ASSIGNEE);
    expectPlainLanguage(result.blocks[0]?.reason);
    expectPlainLanguage(result.comment);
    // The comment has to be findable by a human: it names the artifact and the
    // specific value, not a node id.
    expect(result.comment).toContain(CARD);
    expect(result.comment).toContain(BRAND);
  });

  it("does not block the identical literal in an untyped axis, and records what was derived", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        {
          kind: HARDCODED,
          axis: "spacing",
          component: CARD,
          value: "24",
        },
      ],
    });

    expect(result.verdict).toBe("PROCEED");
    expect(result.blocks).toHaveLength(0);
    // Measuring is the legitimate source here — but the measurement is recorded,
    // so the gaps in the token system accumulate on their own.
    expect(result.derived).toHaveLength(1);
    expect(result.derived[0]).toMatchObject({
      axis: "spacing",
      component: CARD,
      value: "24",
    });
  });

  it("blocks when design.escalation.assignee is unset rather than silently proceeding", () => {
    const result = evaluateDesignIntake({
      config: {
        design: {
          tokens: { source: SOURCE },
          escalation: { label: LABEL },
        },
      },
      regime: MIXED_REGIME,
      findings: [
        { kind: "bound", axis: COLOR, component: CARD, token: SURFACE_TOKEN },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.assignee).toBeNull();
    expect(
      result.blocks.map((block: { condition: string }) => block.condition)
    ).toContain("escalation-target-unset");
    expectPlainLanguage(result.comment);
  });

  it("blocks an unpublished component", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [{ kind: UNPUBLISHED, component: CARD }],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.blocks[0]?.condition).toBe(UNPUBLISHED);
    expect(result.comment).toContain(CARD);
    expectPlainLanguage(result.comment);
  });

  it("blocks a token/frame disagreement without picking a side", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        {
          kind: DISAGREEMENT,
          axis: COLOR,
          component: CARD,
          token: "surface/raised",
          tokenValue: BRAND,
          frameValue: FRAME_BRAND,
        },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.blocks[0]?.condition).toBe(DISAGREEMENT);
    // Both values are surfaced and neither is chosen. A gate that resolved the
    // disagreement itself would be guessing at a design decision.
    expect(result.comment).toContain(BRAND);
    expect(result.comment).toContain(FRAME_BRAND);
    expect(result.blocks[0]?.resolvedValue).toBeUndefined();
    expectPlainLanguage(result.comment);
  });

  it("does not block aesthetic ambiguity when every value is bound", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        { kind: "bound", axis: COLOR, component: CARD, token: SURFACE_TOKEN },
        {
          kind: "aesthetic-concern",
          component: CARD,
          note: "the drop shadow reads heavier than the rest of the set",
        },
        {
          kind: "one-off",
          axis: COLOR,
          component: "Hero illustration",
          value: BRAND,
        },
      ],
    });

    expect(result.verdict).toBe("PROCEED");
    expect(result.blocks).toHaveLength(0);
    expect(result.comment).toBeNull();
  });
});

describe("design-intake gate — supporting contract", () => {
  it("pins the blocking condition set itself, not just its members' behavior", () => {
    // Classifying a finding is not a guard; *blocking the work item* because of
    // it is. With only per-condition behavior asserted, deleting a condition
    // from this set flips the verdict to PROCEED with the suite still green.
    expect([...BLOCK_CONDITIONS].sort((a, b) => a.localeCompare(b))).toEqual([
      "escalation-target-unset",
      "hardcoded-in-design",
      MEASURED_OVER_BINDING,
      MISSING_STATE,
      MISSING_TOKEN,
      "regime-unknown",
      DISAGREEMENT,
      "unpublished-component",
    ]);
  });

  it("blocks a value derived from pixels in an axis that has a binding", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        { kind: "measured", axis: COLOR, component: CARD, value: BRAND },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(result.blocks[0]?.condition).toBe(MEASURED_OVER_BINDING);
  });

  it("records — and never blocks — a value measured in an untyped axis", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        { kind: "measured", axis: "spacing", component: CARD, value: "24" },
      ],
    });

    expect(result.verdict).toBe("PROCEED");
    expect(result.derived).toHaveLength(1);
  });

  it("blocks an axis whose regime it could not determine, rather than assuming untyped", () => {
    // Defaulting an unresolved query to untyped converts every access problem
    // into silent permission to hardcode.
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: { color: "typed" },
      findings: [
        {
          kind: HARDCODED,
          axis: "radius",
          component: CARD,
          value: "12",
        },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(
      result.blocks.map((block: { condition: string }) => block.condition)
    ).toContain("regime-unknown");
  });

  it("blocks a missing token and a missing state", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        {
          kind: MISSING_TOKEN,
          axis: COLOR,
          component: CARD,
          token: "surface/sunken",
        },
        { kind: MISSING_STATE, component: CARD, state: "disabled" },
      ],
    });

    expect(result.verdict).toBe("BLOCK");
    expect(
      result.blocks
        .map((block: { condition: string }) => block.condition)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual([MISSING_STATE, MISSING_TOKEN]);
  });

  it("attributes every condition to an owner, and every condition has one", () => {
    // Three failures, two owners. Handing a stale-map failure to a designer is
    // the wrong person and the wrong work, and it teaches them to ignore the
    // next one.
    expect(
      Object.keys(CONDITION_OWNERS).sort((a, b) => a.localeCompare(b))
    ).toEqual([...BLOCK_CONDITIONS].sort((a, b) => a.localeCompare(b)));
    expect(new Set(Object.values(CONDITION_OWNERS))).toEqual(
      new Set(["design", "us"])
    );
  });

  it("owns an unbound value to design", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [
        { kind: HARDCODED, axis: COLOR, component: CARD, value: BRAND },
      ],
    });
    expect(result.owner).toBe("design");
  });

  it("owns an unresolvable regime to us, not to design", () => {
    const result = evaluateDesignIntake({
      config: CONFIGURED,
      regime: {},
      findings: [
        { kind: HARDCODED, axis: COLOR, component: CARD, value: BRAND },
      ],
    });
    expect(result.owner).toBe("us");
  });

  it("lets design win when both owners are present", () => {
    // An unbound value is what actually stops the build.
    const result = evaluateDesignIntake({
      config: { design: { tokens: { source: SOURCE }, escalation: {} } },
      regime: MIXED_REGIME,
      findings: [
        { kind: HARDCODED, axis: COLOR, component: CARD, value: BRAND },
      ],
    });
    expect(result.owner).toBe("design");
  });

  it("refuses a finding kind it does not recognise instead of guessing a verdict", () => {
    // Silently passing an unclassifiable finding is the gate inventing a
    // verdict for facts it did not understand.
    expect(() =>
      evaluateDesignIntake({
        config: CONFIGURED,
        regime: MIXED_REGIME,
        findings: [{ kind: "vibes", component: CARD }],
      })
    ).toThrow(/unrecognised finding kind 'vibes'/u);
  });

  it("carries the configured escalation label through without inventing one", () => {
    const blocked = evaluateDesignIntake({
      config: CONFIGURED,
      regime: MIXED_REGIME,
      findings: [{ kind: UNPUBLISHED, component: CARD }],
    });
    expect(blocked.label).toBe(LABEL);

    const unlabelled = evaluateDesignIntake({
      config: {
        design: {
          tokens: { source: SOURCE },
          escalation: { assignee: ASSIGNEE },
        },
      },
      regime: MIXED_REGIME,
      findings: [{ kind: UNPUBLISHED, component: CARD }],
    });
    expect(unlabelled.label).toBeNull();
    expect(unlabelled.verdict).toBe("BLOCK");
  });
});

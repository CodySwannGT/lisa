/**
 * Regression coverage for scoping-label drift detection (#3420).
 *
 * `/lisa:validate-tracker-mapping` audited LIFECYCLE roles only, because every
 * pair it compares comes from a `(role, configured-name)` mapping declared in
 * `.lisa.config.json`. The scoping vocabulary (`type:`, `priority:`, `points:`,
 * `component:`) is declared in no config key, so the audit had nothing to check
 * it with — while `lisa-github-write-issue` creates any label it needs on
 * demand, making that vocabulary unbounded and self-expanding.
 *
 * Acceptance-criteria scenario 1 ("component:ci 40 times, component:scripts
 * once → report scripts as a probable synonym") and scenario 3 ("a single-use
 * value with no near neighbour is NOT reported") cannot both hold: `scripts` is
 * six edits from `ci`, so no string-proximity rule reaches it while still
 * sparing `billing`. The owner ruling's wording — "used exactly once while a
 * NEAR-NEIGHBOUR is well established" — is what is implemented, and
 * scenario 1's shape (established value, single-use synonym) is covered below
 * with a pair that is actually near.
 *
 * The vocabulary-vs-skill contract lives in
 * `scoping-label-vocabulary-contract.test.ts`.
 *
 * @module tests/unit/strategies/scoping-label-drift
 */
import { describe, expect, it } from "vitest";

import {
  auditScopingLabels,
  editDistance,
  FIBONACCI_POINT_SCALE,
  parseScopingLabel,
} from "../../../plugins/src/base/scripts/scoping-label-audit.mjs";

const CI = "component:ci";
const CLI = "component:cli";
const PLUGINS = "component:plugins";
const PLUGIN = "component:plugin";
const DOCTOR = "component:doctor";
const CHORE = "type:Chore";
const SYNONYM = "probable-synonym";
const ADVISORY = "advisory";

/** The label set of a repository whose scoping vocabulary is in good order. */
const HEALTHY_LABELS = [
  { name: "type:Bug", count: 416 },
  { name: "type:Task", count: 91 },
  { name: "type:Story", count: 86 },
  { name: "type:Sub-task", count: 64 },
  { name: "type:Improvement", count: 54 },
  { name: "type:Epic", count: 16 },
  { name: "priority:high", count: 195 },
  { name: "priority:medium", count: 70 },
  { name: "priority:low", count: 28 },
  { name: "points:5", count: 184 },
  { name: "points:3", count: 157 },
  { name: "points:8", count: 51 },
  { name: "points:2", count: 48 },
  { name: "points:1", count: 19 },
  { name: CI, count: 238 },
  { name: "component:tests", count: 134 },
  { name: PLUGINS, count: 107 },
  { name: CLI, count: 103 },
  { name: "component:skills", count: 67 },
  { name: DOCTOR, count: 54 },
  { name: "component:docs", count: 20 },
];

/** Scenario 1's shape: an established value with a single-use near neighbour. */
const TYPO_BESIDE_ESTABLISHED = [
  { name: PLUGINS, count: 40 },
  { name: PLUGIN, count: 1 },
];

describe("scoping-label smells are reported, never gated (#3420)", () => {
  it("reports a single-use component value beside an established near neighbour", () => {
    const { findings } = auditScopingLabels({
      labels: TYPO_BESIDE_ESTABLISHED,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      family: "component",
      label: PLUGIN,
      kind: SYNONYM,
      neighbour: PLUGINS,
      neighbourUsage: 40,
      distance: 1,
      severity: ADVISORY,
    });
  });

  it("does not call an open-vocabulary member invalid", () => {
    const { findings } = auditScopingLabels({
      labels: TYPO_BESIDE_ESTABLISHED,
    });

    expect(findings[0].kind).not.toBe("outside-vocabulary");
    expect(findings[0].detail).toContain("open");
  });

  it("reports an issue type outside the closed set", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: "type:Story", count: 30 },
        { name: CHORE, count: 4 },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        family: "type",
        label: CHORE,
        kind: "outside-vocabulary",
        severity: ADVISORY,
      }),
    ]);
  });

  it("leaves a single-use value with no near neighbour alone", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: CI, count: 40 },
        { name: "component:billing", count: 1 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("reports nothing on a healthy repository", () => {
    expect(auditScopingLabels({ labels: HEALTHY_LABELS }).findings).toEqual([]);
  });

  it("marks every finding advisory so no caller can read it as a gate", () => {
    const result = auditScopingLabels({
      labels: [
        { name: CHORE, count: 3 },
        { name: "points:4", count: 2 },
        ...TYPO_BESIDE_ESTABLISHED,
      ],
    });

    expect(result.advisory).toBe(true);
    expect(result.findings.length).toBeGreaterThan(2);
    for (const finding of result.findings) {
      expect(finding.severity).toBe(ADVISORY);
    }
  });
});

describe("the proximity rule needs rarity too", () => {
  it("spares two established values one edit apart", () => {
    // Measured on this repository: component:ci (238) and component:cli (103)
    // are one edit apart and genuinely distinct. An ungated proximity rule
    // reports them on every run, forever.
    const { findings } = auditScopingLabels({
      labels: [
        { name: CI, count: 238 },
        { name: CLI, count: 103 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("spares a rare value whose neighbour is itself barely used", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: PLUGINS, count: 3 },
        { name: PLUGIN, count: 1 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("reports a declared-but-never-applied value beside an established one", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: DOCTOR, count: 54 },
        { name: "component:doctors", count: 0 },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].label).toBe("component:doctors");
  });

  it("reports nothing on a bootstrapped repository where nothing is established", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: CI, count: 0 },
        { name: CLI, count: 0 },
        { name: "component:docs", count: 0 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("does not match on proximity between values too short to carry a typo", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: CI, count: 200 },
        { name: "component:cd", count: 1 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("reports each rare value once, against its closest established neighbour", () => {
    const { findings } = auditScopingLabels({
      labels: [
        ...TYPO_BESIDE_ESTABLISHED,
        { name: "component:plugged", count: 60 },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].neighbour).toBe(PLUGINS);
  });
});

describe("points is checked against the Fibonacci scale", () => {
  it.each([4, 6, 7, 100])("reports points:%s as off-scale", value => {
    const { findings } = auditScopingLabels({
      labels: [{ name: `points:${value}`, count: 2 }],
    });

    expect(findings).toEqual([
      expect.objectContaining({ family: "points", kind: "off-scale" }),
    ]);
  });

  it.each(FIBONACCI_POINT_SCALE)("accepts points:%s", value => {
    const { findings } = auditScopingLabels({
      labels: [{ name: `points:${value}`, count: 2 }],
    });

    expect(findings).toEqual([]);
  });

  it("reports a non-numeric points value as off-scale", () => {
    const { findings } = auditScopingLabels({
      labels: [{ name: "points:xl", count: 2 }],
    });

    expect(findings[0]).toMatchObject({ family: "points", kind: "off-scale" });
  });
});

describe("label parsing stays inside the scoping families", () => {
  it.each([
    ["type:Bug", { family: "type", value: "Bug" }],
    [CI, { family: "component", value: "ci" }],
    ["points:5", { family: "points", value: "5" }],
    ["priority:high", { family: "priority", value: "high" }],
  ])("parses %s", (name, expected) => {
    expect(parseScopingLabel(name)).toEqual(expected);
  });

  it.each([
    "status:ready",
    "prd-ready",
    "human-needed",
    "component:",
    ":ci",
    "",
  ])("ignores %s", name => {
    expect(parseScopingLabel(name)).toBeNull();
  });

  it("leaves lifecycle labels out of the audit entirely", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: "status:ready", count: 1 },
        { name: "prd-blocked", count: 1 },
        { name: "human-needed", count: 1 },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("survives a missing, empty, or malformed label list", () => {
    expect(auditScopingLabels().findings).toEqual([]);
    expect(auditScopingLabels({}).findings).toEqual([]);
    expect(auditScopingLabels({ labels: [] }).findings).toEqual([]);
    expect(
      auditScopingLabels({
        labels: [null, 42, { count: 3 }, "type:Bug"],
      } as never).findings
    ).toEqual([]);
  });

  it("collapses a duplicated label to its highest observed usage", () => {
    const { findings } = auditScopingLabels({
      labels: [
        { name: PLUGINS, count: 40 },
        { name: PLUGIN },
        { name: PLUGIN, count: 1 },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].usage).toBe(1);
  });
});

describe("editDistance", () => {
  it.each([
    ["", "", 0],
    ["ci", "ci", 0],
    ["plugin", "plugins", 1],
    ["ci", "cli", 1],
    ["wiki", "wiki-cli", 4],
    ["", "abc", 3],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
  ])("distance(%s, %s) = %i", (left, right, expected) => {
    expect(editDistance(left, right)).toBe(expected);
  });
});

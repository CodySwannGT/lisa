/** Linear scanners preserve the previously accepted completion-proof grammar. */
import { describe, expect, it } from "vitest";

import { validateConformance } from "../../../all/copy-overwrite/scripts/lib/completion-proof-conformance.mjs";
import { validateTypedBytes } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import { topLevelLines } from "../../../all/copy-overwrite/scripts/lib/completion-proof-markdown.mjs";
import { usageSpecRemainder } from "../../../all/copy-overwrite/scripts/lib/completion-proof-projection.mjs";
import {
  declaredScope,
  sha256,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import {
  createLisaUsageRollup,
  renderLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

/** Exercise the real report reader while comparing the former extraction oracle. */
function conforms(criteria: string, scenarioNames: string[]): void {
  const requirements = [
    { requirement_id: "R1", operator: "all", claim_ids: ["C1"] },
  ];
  const report = Buffer.from(
    JSON.stringify({
      verdict: "CONFORMS",
      spec_sha256: "a".repeat(64),
      work_item: "example/project#1",
      requirements: [{ ...requirements[0], status: "pass" }],
      scenario_names: scenarioNames,
    })
  );
  validateConformance(
    {
      spec_sha256: "a".repeat(64),
      requirements,
      obligations: {
        conformance: {
          report: { asset_id: 1, sha256: sha256(report), bytes: report.length },
        },
      },
    },
    { ref: "example/project#1" },
    { body: `## Acceptance Criteria\n${criteria}` },
    { asset: () => ({ bytes: report }) }
  );
}

describe("linear completion grammar compatibility", () => {
  it.each([
    "Scenario: normal title",
    "  Scenario Outline: outline title\r\nExamples: fixture",
    "Scenario:\n  title on the following line\nScenario: second",
    "\u00a0\u2003Scenario:\u00a0Unicode whitespace\u2028Scenario: next",
    "Scenario:   \n   ",
    "scenario: wrong case\nScenario  Outline: unsupported spacing",
    "Scenario:\r\n\t\r\n",
  ])("preserves the old Scenario oracle for %j", criteria => {
    const expected = [
      ...criteria.trim().matchAll(/^\s*Scenario(?: Outline)?:\s*(.+)$/gm),
    ].map(match => match[1]!.trim());
    expect(() => conforms(criteria, expected)).not.toThrow();
    for (const name of new Set(expected))
      expect(() =>
        conforms(
          criteria,
          expected.filter(other => other !== name)
        )
      ).toThrow(/omits/);
  });

  it.each([
    "prefix00012\u00a0passedSuffix > named test",
    "FAIL named > refusal\n3 failed | 1 passed",
    "# pass 12\nPASS named",
    "# fail 2\nFAIL > named",
    "00000 passed > named",
    "100 missing-summary > named",
    "12\npassing > named",
  ])("preserves the old count-substring oracle for %j", text => {
    const expected =
      /(?:[1-9]\d*\s+(?:passed|passing|failed|failing)|# (?:pass|fail) [1-9]\d*)/i.test(
        text
      );
    const inspect = (): void =>
      validateTypedBytes("test-run-log", Buffer.from(text), "count-control");
    if (expected) expect(inspect).not.toThrow();
    else expect(inspect).toThrow(/capture structure/);
  });

  it.each([
    "```",
    "    ```",
    "````info",
    "~~~info",
    "```bad`info",
    "```bad\u2028info",
    "~~~\rbroken",
  ])("preserves maximal fence and dot-suffix semantics for %j", fence => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(fence);
    const opens = !!match && !(match[1]![0] === "`" && match[2]!.includes("`"));
    const body = `${fence}\n## hidden\n${"~".repeat(5)}\n${"`".repeat(5)}\n## visible`;
    const headings = topLevelLines(body)
      .filter((row: { heading: boolean }) => row.heading)
      .map((row: { text: string }) => row.text);
    expect(headings.includes("## hidden")).toBe(!opens);
  });

  it.each([
    "production — first — later",
    "production\u2003-\u00a0suffix",
    "production-name — suffix",
    "production-name",
    "production     ",
  ])("preserves the first environment separator for %j", declaration => {
    const expected = declaration.split(/\s+[—-]\s+/)[0]!.trim();
    expect(
      declaredScope(`## Target Backend Environment\n${declaration}`, expected)
    ).toEqual({ runtime: true, reason: null });
    expect(() =>
      declaredScope(`## Target Backend Environment\n${declaration}`, "other")
    ).toThrow();
  });

  it("normalizes only actual canonical pipe rows and retains unknown prose", () => {
    const usage = renderLisaUsageSection({
      entries: [],
      rollup: createLisaUsageRollup([]),
    });
    const spaced = usage
      .split("\n")
      .map(line =>
        line.includes("|") ? line.replaceAll("|", "\u00a0|\u2003") : line
      )
      .join("\n");
    expect(usageSpecRemainder(spaced)).toBe(usageSpecRemainder(usage));
    expect(
      usageSpecRemainder(`${spaced}\n| new | delivery requirement |\n`)
    ).toContain("delivery requirement");
  });

  it("handles long nonmatching runs without changing inspection outcomes", () => {
    const long = " ".repeat(100_000);
    expect(() =>
      conforms(`${long}\nScenario:\n${long}long title`, ["long title"])
    ).not.toThrow();
    expect(() =>
      validateTypedBytes(
        "test-run-log",
        Buffer.from(`${"9".repeat(100_000)} missing > named`),
        "long-count"
      )
    ).toThrow();
    expect(
      topLevelLines(
        `${"`".repeat(100_000)}\n## hidden\n${"`".repeat(100_000)}\n## visible`
      ).filter((row: { heading: boolean }) => row.heading)
    ).toEqual([expect.objectContaining({ text: "## visible" })]);
    expect(
      declaredScope(
        `## Target Backend Environment\nproduction${long}— suffix`,
        "production"
      ).runtime
    ).toBe(true);
  });
});

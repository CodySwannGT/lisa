/** Linear scanners preserve the previously accepted completion-proof grammar. */
import { describe, expect, it } from "vitest";

import { validateConformance } from "../../../all/copy-overwrite/scripts/lib/completion-proof-conformance.mjs";
import { validateTypedBytes } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import { topLevelLines } from "../../../all/copy-overwrite/scripts/lib/completion-proof-markdown.mjs";
import { usageSpecRemainder } from "../../../all/copy-overwrite/scripts/lib/completion-proof-projection.mjs";
import {
  declaredScope,
  localMarkers,
  primarySpecProjection,
  sha256,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import {
  createLisaUsageRollup,
  renderLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
const CLI_OUTPUT = "cli-output";
const STATE_DUMP = "state-dump";

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
    {
      name: "visible marker on a standalone comment-closing line",
      body: "<!-- example\n--> [EVIDENCE: cli-output: actual]\n",
      expected: [{ kind: CLI_OUTPUT, name: "actual" }],
    },
    {
      name: "visible prefix and suffix around a multiline comment",
      body: "[EVIDENCE: cli-output: before] <!-- example\n--> [EVIDENCE: state-dump: after]\n",
      expected: [
        { kind: CLI_OUTPUT, name: "before" },
        { kind: STATE_DUMP, name: "after" },
      ],
    },
    {
      name: "fence-looking lines inside a standalone HTML comment",
      body: "<!-- example\n```\n~~~\n--> [EVIDENCE: cli-output: actual]\n",
      expected: [{ kind: CLI_OUTPUT, name: "actual" }],
    },
    {
      name: "literal unclosed HTML comment inside a fenced example",
      body: "```markdown\n<!-- example\n[EVIDENCE: unknown-type: example]\n```\n[EVIDENCE: cli-output: actual]\n",
      expected: [{ kind: CLI_OUTPUT, name: "actual" }],
    },
    {
      name: "literal unclosed HTML comment inside an indented example",
      body: "    <!-- example\n[EVIDENCE: cli-output: actual]\n",
      expected: [{ kind: CLI_OUTPUT, name: "actual" }],
    },
    {
      name: "inline-comment claiming policy with fence-looking content",
      body: "visible <!-- example\n```\n--> [EVIDENCE: cli-output: actual]\n[EVIDENCE: state-dump: later]\n",
      expected: [
        { kind: CLI_OUTPUT, name: "actual" },
        { kind: STATE_DUMP, name: "later" },
      ],
    },
  ])("preserves claiming text for $name", ({ body, expected }) => {
    // This tests the local claiming projection, not an external renderer.
    expect(localMarkers(body)).toEqual(expected);
    expect(primarySpecProjection(body)).toBe(body);
  });

  it.each([
    "```markdown\n[EVIDENCE: unknown-type: example]\n```",
    "~~~markdown\n[EVIDENCE: unknown-type: example]\n~~~",
    "    [EVIDENCE: unknown-type: example]",
    "\t[EVIDENCE: unknown-type: example]",
    "<!-- [EVIDENCE: unknown-type: example] -->",
    "<!-- example\n[EVIDENCE: unknown-type: example]\n-->",
    "visible <!-- [EVIDENCE: unknown-type: example] --> prose",
    "visible <!-- example\n[EVIDENCE: unknown-type: example]\n--> prose",
  ])("does not claim example evidence in %j", example => {
    const body = `## Validation Journey\n${example}\n1. Capture real output. [EVIDENCE: cli-output: actual]\n`;
    expect(localMarkers(body)).toEqual([{ kind: CLI_OUTPUT, name: "actual" }]);
    expect(primarySpecProjection(body)).toBe(body);
  });

  it("keeps visible evidence around inline comments and legacy screenshots", () => {
    expect(
      localMarkers(
        "[EVIDENCE: cli-output: before] <!-- example --> [EVIDENCE: state-dump: after]\n[SCREENSHOT: legacy]\n"
      )
    ).toEqual([
      { kind: CLI_OUTPUT, name: "before" },
      { kind: STATE_DUMP, name: "after" },
      { kind: "screenshot", name: "legacy" },
    ]);
  });

  it.each([
    "[EVIDENCE: cli-output: broken name]",
    "[EVIDENCE: unknown-type: actual]",
    "[EVIDENCE: cli-output: actual]\n[EVIDENCE: state-dump: actual]",
  ])("still rejects a visible invalid declaration %j", body => {
    expect(() => localMarkers(body)).toThrow();
  });

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
    expect(
      localMarkers(
        `${fence}\n[EVIDENCE: cli-output: actual]\n${"~".repeat(5)}\n${"`".repeat(5)}\n`
      ).some((row: { name: string }) => row.name === "actual")
    ).toBe(!opens);
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
      localMarkers(
        `${"`".repeat(100_000)}\n[EVIDENCE: unknown-type: example]\n${"`".repeat(100_000)}\n[EVIDENCE: cli-output: actual]\n`
      )
    ).toEqual([{ kind: CLI_OUTPUT, name: "actual" }]);
    expect(
      declaredScope(
        `## Target Backend Environment\nproduction${long}— suffix`,
        "production"
      ).runtime
    ).toBe(true);
  });
});

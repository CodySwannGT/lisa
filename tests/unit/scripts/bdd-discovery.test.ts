/**
 * The other direction: tests the gate DISCOVERS, rather than tests the map
 * declares.
 *
 * Validating declarations can only ever find defects in the declarations. A
 * spec file nobody declared is invisible to that check — which is how six
 * undeclared end-to-end specs came to sit on a fleet default branch under a
 * green gate. Every case here proves the gate now walks the project's own
 * declared roots and refuses a test the contract never mentions.
 */
import { describe, expect, it } from "vitest";

import {
  HEALTHY_FILES,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_FEATURE_FILE,
  HOME_ID,
  HOME_SPEC,
  MAESTRO,
  PLAYWRIGHT,
  PLAYWRIGHT_DISCOVERY,
  RATIFIED,
  WEB,
  codes,
  commitAll,
  featureSource,
  healthyProject,
  makeProject,
  messages,
  runGate,
  runReport,
} from "./bdd/support";

const UNDISCLOSED = "spec-undisclosed";
const EXCLUSION_STALE = "exclusion-stale";
const EXCLUSION_METADATA = "exclusion-metadata";
const DISCOVERY_INVALID = "discovery-invalid";
const DISCOVERY_MISSING = "discovery-missing";
const STRAY_SPEC = "e2e/stray.spec.ts";
const STRAY_TITLE = "a test nobody declared";
const STRAY_SOURCE = `test("${STRAY_TITLE}", async () => {});\n`;
const SMOKE_REASON = "starter template kept as a runner smoke check";
const DYNAMIC_REASON = "error-path smoke check with a computed title";

describe("a discovered spec must be declared or excluded", () => {
  it("fails on a spec no mapping and no exclusion names", () => {
    // The fleet's actual bug: six undeclared Playwright specs sat invisible on
    // a default branch because the gate only ever read what the map DECLARED.
    const run = runGate(
      healthyProject({}, { files: { [STRAY_SPEC]: STRAY_SOURCE } })
    );
    expect(run.status).toBe(1);
    expect(messages(run, UNDISCLOSED)[0]).toContain(STRAY_TITLE);
    expect(messages(run, UNDISCLOSED)[0]).toContain(PLAYWRIGHT);
  });

  it("blocks on it rather than grading it amber", () => {
    // This used to exit 0 with the finding graded `warning`, because
    // `spec-undisclosed` was on the allowlist a `bootstrap` run could
    // downgrade. An undeclared test is the exact thing this check exists to
    // surface, and a check that surfaces it in amber is one nobody acts on.
    const run = runGate(
      healthyProject(
        { coverageFloor: { [WEB]: 0 } },
        { files: { [STRAY_SPEC]: STRAY_SOURCE } }
      )
    );
    expect(run.status).toBe(1);
    expect(codes(run)).toContain(UNDISCLOSED);
  });

  it("only credits the titles a mapping actually names", () => {
    // A second test added to an already-mapped file is the common way an
    // undeclared behavior arrives; the mapping's evidence names one title.
    const run = runGate(
      healthyProject(
        {},
        {
          files: {
            [HOME_SPEC]:
              `test("${HOME_EVIDENCE}", async () => {});\n` +
              `test("${STRAY_TITLE}", async () => {});\n`,
          },
        }
      )
    );
    expect(messages(run, UNDISCLOSED)).toHaveLength(1);
    expect(messages(run, UNDISCLOSED)[0]).toContain(STRAY_TITLE);
  });

  it("ignores suite and helper titles while retaining test modifiers", () => {
    const skippedTitle = "a deliberately skipped behavior";
    const expectedFailureTitle = "an expected test failure";
    const aliasExpectedFailureTitle = "an expected alias failure";
    const parameterizedTitle = "a parameterized test";
    const aliasParameterizedTitle = "a parameterized alias test";
    const root = healthyProject(
      {
        exclusions: [
          {
            file: STRAY_SPEC,
            evidence: skippedTitle,
            reason:
              "Known skipped behavior retained as explicit runner inventory",
          },
          {
            file: STRAY_SPEC,
            evidence: expectedFailureTitle,
            reason:
              "Known expected failure retained as explicit runner inventory",
          },
          {
            file: STRAY_SPEC,
            evidence: aliasExpectedFailureTitle,
            reason:
              "Known expected alias failure retained as explicit runner inventory",
          },
          {
            file: STRAY_SPEC,
            evidence: parameterizedTitle,
            reason:
              "Known parameterized behavior retained as explicit runner inventory",
          },
          {
            file: STRAY_SPEC,
            evidence: aliasParameterizedTitle,
            reason:
              "Known parameterized alias behavior retained as explicit runner inventory",
          },
        ],
        testDiscovery: {
          [PLAYWRIGHT]: {
            ...PLAYWRIGHT_DISCOVERY,
            evidence: {
              kind: "call-title",
              functions: ["test", "it"],
            },
          },
        },
      },
      {
        files: {
          [STRAY_SPEC]:
            `test.describe("grouping title", () => {});\n` +
            `test.step("diagnostic step", async () => {});\n` +
            `test.skip("${skippedTitle}", async () => {});\n` +
            `test.fails("${expectedFailureTitle}", async () => {});\n` +
            `it.fails("${aliasExpectedFailureTitle}", async () => {});\n` +
            `test.each([[buildRow(1)]])("${parameterizedTitle}", async () => {});\n` +
            `it.each\`value | expected\n1 | 1\`("${aliasParameterizedTitle}", async () => {});\n` +
            'test.each("table input, not a test title");\n',
        },
      }
    );
    const run = runGate(root);
    expect(codes(run)).not.toContain(UNDISCLOSED);
    expect(codes(run)).not.toContain(EXCLUSION_STALE);
  });

  it("ignores call-shaped prose inside line and block comments", () => {
    const behaviorTitle = "a real behavior with // inside its title";
    const root = healthyProject(
      {
        exclusions: [
          {
            file: STRAY_SPEC,
            evidence: behaviorTitle,
            reason: "fixture behavior used to isolate comment discovery",
          },
        ],
      },
      {
        files: {
          [STRAY_SPEC]:
            "// the service-layer unit test (`comment-only`) covers this branch\n" +
            '/* test("also comment-only", async () => {}) */\n' +
            `test("${behaviorTitle}", async () => {});\n`,
        },
      }
    );

    const run = runGate(root);

    expect(codes(run)).not.toContain(UNDISCLOSED);
    expect(codes(run)).not.toContain(EXCLUSION_STALE);
  });

  it("passes once an exclusion names it with a reason", () => {
    // Committed, because enforced mode also requires a base revision for its
    // non-regression checks and this case asserts a fully clean run.
    const root = healthyProject(
      {
        exclusions: [
          {
            file: STRAY_SPEC,
            evidence: STRAY_TITLE,
            reason: SMOKE_REASON,
          },
        ],
      },
      { files: { [STRAY_SPEC]: STRAY_SOURCE } }
    );
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(codes(run)).not.toContain(UNDISCLOSED);
    expect(run.status).toBe(0);
  });

  it("treats an exclusion with no evidence as covering the whole file", () => {
    const root = healthyProject(
      {
        exclusions: [
          {
            file: STRAY_SPEC,
            reason: "vendor smoke suite, not product behavior",
          },
        ],
      },
      {
        files: {
          [STRAY_SPEC]: `${STRAY_SOURCE}test("and another", async () => {});\n`,
        },
      }
    );
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(run.status).toBe(0);
  });

  it("refuses an exclusion with no reason", () => {
    const run = runGate(
      healthyProject(
        { exclusions: [{ file: STRAY_SPEC, evidence: STRAY_TITLE }] },
        { files: { [STRAY_SPEC]: STRAY_SOURCE } }
      )
    );
    expect(messages(run, EXCLUSION_METADATA)[0]).toContain("reason");
  });
});

describe("discovery configuration is contract data, not a source constant", () => {
  it("refuses a malformed discovery block", () => {
    // Same reasoning as a quoted coverage floor: one edit here would silently
    // switch discovery off, and a switched-off discovery finds nothing.
    const run = runGate(
      healthyProject({
        coverageFloor: { [WEB]: 0 },
        testDiscovery: {
          [PLAYWRIGHT]: { ...PLAYWRIGHT_DISCOVERY, roots: "e2e" },
        },
      })
    );
    expect(run.status).toBe(1);
    expect(codes(run)).toContain(DISCOVERY_INVALID);
  });

  it("refuses an unknown evidence kind rather than skipping the runner", () => {
    const run = runGate(
      healthyProject({
        testDiscovery: {
          [PLAYWRIGHT]: {
            ...PLAYWRIGHT_DISCOVERY,
            evidence: { kind: "guess-from-filename" },
          },
        },
      })
    );
    expect(codes(run)).toContain(DISCOVERY_INVALID);
  });

  it("requires a discovery block for every declared runner", () => {
    const run = runGate(healthyProject({ testDiscovery: undefined }));
    expect(run.status).toBe(1);
    expect(messages(run, DISCOVERY_MISSING)[0]).toContain(PLAYWRIGHT);
  });

  it("walks every declared root, including the subflow directory", () => {
    // Hardcoded roots downstream made `.maestro/subflows` structurally
    // invisible. Roots are per-runner configuration precisely so a project can
    // say where its tests live.
    const map = {
      ...HEALTHY_MAP,
      runnerPlatforms: { [PLAYWRIGHT]: [WEB], [MAESTRO]: ["ios"] },
      coverageFloor: { [WEB]: 100, ios: 0 },
      testDiscovery: {
        [PLAYWRIGHT]: PLAYWRIGHT_DISCOVERY,
        [MAESTRO]: {
          roots: [".maestro/flows", ".maestro/subflows"],
          extensions: [".yaml"],
          evidence: { kind: "line-field", field: "name" },
        },
      },
    };
    const run = runGate(
      makeProject({
        map,
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED] },
          ]),
        },
        files: {
          ...HEALTHY_FILES,
          ".maestro/subflows/login.yaml": "appId: com.example\nname: Log in\n",
        },
      })
    );
    expect(messages(run, UNDISCLOSED)[0]).toContain(
      ".maestro/subflows/login.yaml"
    );
    expect(messages(run, UNDISCLOSED)[0]).toContain("Log in");
  });
});

describe("a template-literal title is used verbatim, never mangled", () => {
  const DYNAMIC_SPEC = "e2e/dynamic.spec.ts";
  const DYNAMIC_TITLE = "handles ${error.name} failures";
  const DYNAMIC_SOURCE = `test(\`${DYNAMIC_TITLE}\`, async () => {});\n`;

  it("keeps escaped backticks inside the discovered title", () => {
    const escapedTitle = "shows \\`details\\`";
    const run = runGate(
      healthyProject(
        {},
        {
          files: {
            [DYNAMIC_SPEC]: `test(\`${escapedTitle}\`, async () => {});\n`,
          },
        }
      )
    );

    expect(run.status).toBe(1);
    expect(messages(run, UNDISCLOSED)).toHaveLength(1);
    expect(messages(run, UNDISCLOSED)[0]).toContain(
      JSON.stringify(escapedTitle)
    );
  });

  it("discloses it against the source text exactly as written", () => {
    const root = healthyProject(
      {
        exclusions: [
          {
            file: DYNAMIC_SPEC,
            evidence: DYNAMIC_TITLE,
            reason: DYNAMIC_REASON,
          },
        ],
      },
      { files: { [DYNAMIC_SPEC]: DYNAMIC_SOURCE } }
    );
    const run = runGate(root, {
      BDD_BASE_SHA: commitAll(root),
    });
    expect(codes(run)).not.toContain(UNDISCLOSED);
    expect(codes(run)).not.toContain(EXCLUSION_STALE);
    expect(run.status).toBe(0);
  });

  it("counts it as a dynamic title so the limitation is visible", () => {
    const report = runReport(
      healthyProject(
        {
          exclusions: [
            {
              file: DYNAMIC_SPEC,
              evidence: DYNAMIC_TITLE,
              reason: DYNAMIC_REASON,
            },
          ],
        },
        { files: { [DYNAMIC_SPEC]: DYNAMIC_SOURCE } }
      )
    );
    expect(report.testInventory.dynamicTitles).toBe(1);
  });
});

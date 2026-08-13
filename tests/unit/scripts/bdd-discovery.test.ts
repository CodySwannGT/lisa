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
  BOOTSTRAP,
  COMPLETED,
  ENFORCED,
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
const LIVE_BOOTSTRAP = {
  state: BOOTSTRAP,
  owner: "o@example.test",
  expiresAt: "2099-01-01",
};

describe("a discovered spec must be declared or excluded", () => {
  it("fails enforced on a spec no mapping and no exclusion names", () => {
    // The fleet's actual bug: six undeclared Playwright specs sat invisible on
    // a default branch because the gate only ever read what the map DECLARED.
    const run = runGate(
      healthyProject({}, { files: { [STRAY_SPEC]: STRAY_SOURCE } }),
      { BDD_MODE: ENFORCED }
    );
    expect(run.status).toBe(1);
    expect(messages(run, UNDISCLOSED)[0]).toContain(STRAY_TITLE);
    expect(messages(run, UNDISCLOSED)[0]).toContain(PLAYWRIGHT);
  });

  it("reports it as a visible warning in bootstrap rather than a blocker", () => {
    const run = runGate(
      healthyProject(
        {
          adoption: LIVE_BOOTSTRAP,
          coverageFloor: { [WEB]: 0 },
        },
        { files: { [STRAY_SPEC]: STRAY_SOURCE } }
      ),
      { BDD_MODE: BOOTSTRAP }
    );
    expect(run.status).toBe(0);
    expect(run.envelope.status).toBe(COMPLETED);
    expect(
      run.envelope.findings.find(item => item.code === UNDISCLOSED)?.severity
    ).toBe("warning");
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
      ),
      { BDD_MODE: ENFORCED }
    );
    expect(messages(run, UNDISCLOSED)).toHaveLength(1);
    expect(messages(run, UNDISCLOSED)[0]).toContain(STRAY_TITLE);
  });

  it("passes once an exclusion names it with a reason", () => {
    const run = runGate(
      healthyProject(
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
      ),
      { BDD_MODE: ENFORCED }
    );
    expect(codes(run)).not.toContain(UNDISCLOSED);
    expect(run.status).toBe(0);
  });

  it("treats an exclusion with no evidence as covering the whole file", () => {
    const run = runGate(
      healthyProject(
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
      ),
      { BDD_MODE: ENFORCED }
    );
    expect(run.status).toBe(0);
  });

  it("refuses an exclusion with no reason", () => {
    const run = runGate(
      healthyProject(
        { exclusions: [{ file: STRAY_SPEC, evidence: STRAY_TITLE }] },
        { files: { [STRAY_SPEC]: STRAY_SOURCE } }
      ),
      { BDD_MODE: ENFORCED }
    );
    expect(messages(run, EXCLUSION_METADATA)[0]).toContain("reason");
  });
});

describe("discovery configuration is contract data, not a source constant", () => {
  it("refuses a malformed discovery block in bootstrap too", () => {
    // Same reasoning as a quoted coverage floor: one edit here would silently
    // switch discovery off, and a switched-off discovery finds nothing.
    const run = runGate(
      healthyProject({
        adoption: LIVE_BOOTSTRAP,
        coverageFloor: { [WEB]: 0 },
        testDiscovery: {
          [PLAYWRIGHT]: { ...PLAYWRIGHT_DISCOVERY, roots: "e2e" },
        },
      }),
      { BDD_MODE: BOOTSTRAP }
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
      }),
      { BDD_MODE: ENFORCED }
    );
    expect(codes(run)).toContain(DISCOVERY_INVALID);
  });

  it("requires a discovery block for every declared runner in enforced mode", () => {
    const run = runGate(healthyProject({ testDiscovery: undefined }), {
      BDD_MODE: ENFORCED,
    });
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
      }),
      { BDD_MODE: ENFORCED }
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

  it("discloses it against the source text exactly as written", () => {
    const run = runGate(
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
      ),
      { BDD_MODE: ENFORCED }
    );
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
      ),
      { BDD_MODE: ENFORCED }
    );
    expect(report.testInventory.dynamicTitles).toBe(1);
  });
});

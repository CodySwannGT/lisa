/**
 * Deterministic Health regressions: ruleset findings name every unenforced
 * required check, for drifted and for missing rulesets alike.
 * @module tests/unit/health/deterministic-regressions-ruleset-findings.test
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareRulesets,
  rulesetFinding,
  type HealthRuleset,
} from "../../../src/health/ruleset-inspection.js";
import {
  ACTIONS_INTEGRATION_ID,
  CI_WORKFLOW_CONTENT,
  CI_WORKFLOW_PATH,
  write,
} from "./deterministic-regressions-fixtures.js";

/** Lisa's quality-checks ruleset name. */
const QUALITY_CHECKS = "quality checks";
/** A Lisa-required check the host ruleset keeps enforcing. */
const LINT_CHECK = "🔍 Quality Checks / 🧹 Lint";
/** Tracker configuration shared by every finding case. */
const GITHUB_CONFIG = { github: { org: "acme", repo: "app" } };

const temporaryRoots: string[] = [];

/**
 * Create a canonical temporary root that the suite removes after each test.
 * @param prefix - Directory name prefix
 * @returns Canonical (symlink-resolved) temporary root
 */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("deterministic health governance regressions", () => {
  it("names unenforced required checks and tolerates host-added checks", async () => {
    const expected: HealthRuleset = {
      name: QUALITY_CHECKS,
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              {
                context: LINT_CHECK,
                integration_id: ACTIONS_INTEGRATION_ID,
              },
              {
                context: "🔍 Quality Checks / 🔗 Work-Item Traceability",
                integration_id: ACTIONS_INTEGRATION_ID,
              },
            ],
          },
        },
      ],
    };
    const actualWithHostAddition: HealthRuleset = {
      ...expected,
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              {
                context: LINT_CHECK,
                integration_id: ACTIONS_INTEGRATION_ID,
              },
              {
                context: "🧭 E2E Route Coverage",
                integration_id: ACTIONS_INTEGRATION_ID,
              },
            ],
          },
        },
      ],
    };

    expect(compareRulesets([expected], [actualWithHostAddition])).toEqual({
      missing: [],
      drifted: [QUALITY_CHECKS],
    });

    const lisaRoot = await temporaryRoot("lisa-health-ruleset-names-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-names-host-");
    await write(
      lisaRoot,
      "typescript/github-rulesets/quality-checks.json",
      `${JSON.stringify(expected)}\n`
    );
    await write(projectRoot, CI_WORKFLOW_PATH, CI_WORKFLOW_CONTENT);

    const finding = await rulesetFinding(
      lisaRoot,
      projectRoot,
      ["typescript"],
      GITHUB_CONFIG,
      async () => [actualWithHostAddition],
      1_000,
      new AbortController().signal
    );
    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("quality checks drifted");
    expect(finding.reason).toContain("runs without blocking");
    expect(finding.reason).toContain(
      "🔍 Quality Checks / 🔗 Work-Item Traceability"
    );
    expect(finding.reason).not.toContain("🧭 E2E Route Coverage");
  });

  it("reports missing rulesets with their unenforced required checks", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-ruleset-missing-source-");
    const projectRoot = await temporaryRoot(
      "lisa-health-ruleset-missing-host-"
    );
    await write(
      lisaRoot,
      "expo/github-rulesets/nightly-e2e-health.json",
      `${JSON.stringify({
        name: "nightly e2e health",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                {
                  context: "🌙 Nightly E2E Health / 🌙 Gate",
                  integration_id: ACTIONS_INTEGRATION_ID,
                },
              ],
            },
          },
        ],
      })}\n`
    );
    await write(projectRoot, CI_WORKFLOW_PATH, CI_WORKFLOW_CONTENT);

    const finding = await rulesetFinding(
      lisaRoot,
      projectRoot,
      ["expo"],
      GITHUB_CONFIG,
      async () => [],
      1_000,
      new AbortController().signal
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("nightly e2e health missing");
    expect(finding.reason).toContain("🌙 Nightly E2E Health / 🌙 Gate");
    expect(finding.reason).toContain("runs without blocking");
  });
});

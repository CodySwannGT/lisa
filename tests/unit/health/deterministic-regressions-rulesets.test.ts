/**
 * Deterministic Health regressions: material ruleset comparison and the
 * expected-ruleset normalization (dropped, per-repo added, and run-gate checks).
 * @module tests/unit/health/deterministic-regressions-rulesets.test
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareRulesets,
  expectedRulesets,
  type HealthRuleset,
} from "../../../src/health/ruleset-inspection.js";
import {
  ACTIONS_INTEGRATION_ID,
  CI_WORKFLOW_CONTENT,
  CI_WORKFLOW_PATH,
  write,
} from "./deterministic-regressions-fixtures.js";

/**
 * Reads one field off an untyped JSON value.
 *
 * `HealthRuleset.rules` is `unknown` by contract, so rule fields are read by
 * key rather than cast to a shape.
 *
 * @param value - Any parsed JSON value
 * @param key - Object key or array index
 * @returns The field, or undefined when the value has none
 */
function field(value: unknown, key: string | number): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/**
 * The `required_status_checks` of a ruleset's first rule.
 *
 * @param ruleset - An expected ruleset, if one was produced
 * @returns The first rule's required checks, or undefined
 */
function firstRuleChecks(ruleset: HealthRuleset | undefined): unknown {
  return field(
    field(field(ruleset?.rules, 0), "parameters"),
    "required_status_checks"
  );
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
/** The Lisa ruleset template every fixture source in this suite declares. */
const BASE_RULESET_TEMPLATE = "all/github-rulesets/base.json";
/** The single Lisa-required check every base fixture ruleset starts with. */
const CI_CHECK = { context: "CI", integration_id: ACTIONS_INTEGRATION_ID };
/** Level that makes a configured gate a required status check. */
const REQUIRED = "required";
/** External check the credential-leakage gate awaits on the base ruleset. */
const VENDOR_SECURITY_CHECK = "Vendor Security";

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
  it("compares material ruleset state and normalizes dropped checks", async () => {
    const base: HealthRuleset = {
      name: "base",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [{ type: "deletion" }],
    };
    expect(
      compareRulesets([base], [{ ...base, enforcement: "disabled" }])
    ).toEqual({ missing: [], drifted: ["base"] });
    expect(
      compareRulesets(
        [base],
        [{ ...base, conditions: { ref_name: { include: ["main"] } } }]
      )
    ).toEqual({ missing: [], drifted: ["base"] });

    const reviewRule: HealthRuleset = {
      ...base,
      rules: [
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
      ],
    };
    expect(
      compareRulesets(
        [reviewRule],
        [
          {
            ...reviewRule,
            rules: [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: 1,
                  required_reviewers: [],
                },
              },
            ],
          },
        ]
      )
    ).toEqual({ missing: [], drifted: [] });
    expect(
      compareRulesets(
        [reviewRule],
        [
          {
            ...reviewRule,
            rules: [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: 1,
                  required_reviewers: [{ type: "Team", id: 7 }],
                },
              },
            ],
          },
        ]
      )
    ).toEqual({ missing: [], drifted: ["base"] });

    const lisaRoot = await temporaryRoot("lisa-health-ruleset-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-host-");
    await write(
      lisaRoot,
      BASE_RULESET_TEMPLATE,
      `${JSON.stringify({
        ...base,
        rules: [
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                CI_CHECK,
                { context: "Optional", integration_id: 1 },
              ],
            },
          },
        ],
      })}\n`
    );
    const [normalized] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: { rulesets: { dropRequiredChecks: ["Optional"] } },
    });
    expect(normalized?.rules).toEqual([{ type: "deletion" }]);
  });

  // #2485: a repository-specific required check is declared per repo rather
  // than in a shared template. The health inspector has to honor the same
  // opt-in the applier does, or it reports the ruleset it just wrote as
  // "drifted" — a false red that teaches operators to ignore the check.
  it("expects per-repo addRequiredChecks the way the applier writes them", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-ruleset-add-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-add-host-");
    await write(
      lisaRoot,
      BASE_RULESET_TEMPLATE,
      `${JSON.stringify({
        name: "base",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [CI_CHECK],
            },
          },
        ],
      })}\n`
    );
    await write(projectRoot, CI_WORKFLOW_PATH, CI_WORKFLOW_CONTENT);

    const [withAddition] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: {
        rulesets: {
          addRequiredChecks: {
            base: [
              {
                context: "🧩 Repo Only",
                integration_id: ACTIONS_INTEGRATION_ID,
              },
            ],
          },
        },
      },
    });
    expect(firstRuleChecks(withAddition)).toEqual([
      CI_CHECK,
      { context: "🧩 Repo Only", integration_id: ACTIONS_INTEGRATION_ID },
    ]);

    // Named for a different ruleset, it must not leak into this one.
    const [unrelated] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: {
        rulesets: {
          addRequiredChecks: {
            "quality checks": [{ context: "🧩 Elsewhere" }],
          },
        },
      },
    });
    expect(firstRuleChecks(unrelated)).toEqual([CI_CHECK]);
  });

  it("expects required run gates in the quality ruleset", async () => {
    const projectRoot = await temporaryRoot("lisa-health-run-gates-host-");
    await write(projectRoot, CI_WORKFLOW_PATH, CI_WORKFLOW_CONTENT);

    const rulesets = await expectedRulesets(
      REPO_ROOT,
      projectRoot,
      ["typescript"],
      {
        gates: {
          "environment-reset": { "pull-request": REQUIRED },
          "environment-reseed": { "pull-request": REQUIRED },
          "credential-leakage": {
            "pull-request": {
              level: REQUIRED,
              await: VENDOR_SECURITY_CHECK,
              posted_by: 123,
            },
          },
        },
      }
    );
    const quality = rulesets.find(item => item.name === "quality checks");
    const base = rulesets.find(item => item.name === "base");
    const contexts = (ruleset: HealthRuleset | undefined): unknown[] => {
      const rules = ruleset?.rules;
      return (Array.isArray(rules) ? rules : []).flatMap((rule: unknown) => {
        if (field(rule, "type") !== "required_status_checks") return [];
        const checks = field(
          field(rule, "parameters"),
          "required_status_checks"
        );
        return Array.isArray(checks)
          ? checks.map((check: unknown) => field(check, "context"))
          : [];
      });
    };

    expect(contexts(quality)).toEqual(
      expect.arrayContaining([
        "🔍 Quality Checks / ♻️ Environment Reset Guard",
        "🔍 Quality Checks / 🌱 Environment Reseed Guard",
      ])
    );
    expect(contexts(quality)).not.toContain(VENDOR_SECURITY_CHECK);
    expect(contexts(base)).toContain(VENDOR_SECURITY_CHECK);
  });
});

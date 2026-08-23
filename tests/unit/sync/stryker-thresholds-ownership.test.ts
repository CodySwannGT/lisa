/**
 * `stryker.conf.json` is the one file where editing 17 of its 18 keys is
 * correct and editing the 18th — `thresholds` — is silently wrong, because
 * that key is owned by `.lisa.config.json`. A comment saying so is the rung
 * this repository measures at roughly zero adherence, so the statement is
 * executable: these tests are what fails when `thresholds` is hand-edited out
 * of step with the config that owns it.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MUTATION_FLOOR_ARTIFACT_FILE,
  MUTATION_FLOOR_CONFIG_KEY,
  MUTATION_FLOOR_DIVERGENCE_FIELD,
  MUTATION_FLOOR_OWNER_FIELD,
  checkMutationFloorOwnership,
} from "../../../src/sync/stryker-thresholds-ownership.js";
import { getAtPath } from "../../../src/sync/json-path.js";
import { readJson } from "../../../src/utils/index.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const OWNER_STATEMENT =
  "Owned by .lisa.config.json quality.mutation.strykerThresholds.";

/**
 * Build a minimal in-step stryker.conf.json shape.
 * @param overrides - Keys layered over the in-step baseline
 * @returns Parsed-config-shaped object
 */
function conf(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    testRunner: "vitest",
    [MUTATION_FLOOR_OWNER_FIELD]: OWNER_STATEMENT,
    thresholds: { high: 80, low: 60, break: 60 },
    ...overrides,
  };
}

const IN_STEP = { high: 80, low: 60, break: 60 };
const DEFERRED = "deferred until the true aggregate score is measured";

describe("checkMutationFloorOwnership", () => {
  it("passes when the floors match and ownership is stated", () => {
    expect(checkMutationFloorOwnership(conf(), IN_STEP)).toEqual([]);
  });

  it("fails when the ownership statement is missing", () => {
    const problems = checkMutationFloorOwnership(
      conf({ [MUTATION_FLOOR_OWNER_FIELD]: undefined }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(MUTATION_FLOOR_OWNER_FIELD);
    expect(problems[0]).toContain("thresholds");
  });

  it("fails when the ownership statement does not name the owning config key", () => {
    const problems = checkMutationFloorOwnership(
      conf({ [MUTATION_FLOOR_OWNER_FIELD]: "do not edit" }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(MUTATION_FLOOR_CONFIG_KEY);
  });

  it("fails naming the key when thresholds is hand-edited out of step", () => {
    const problems = checkMutationFloorOwnership(
      conf({ thresholds: { high: 80, low: 40, break: 32 } }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("thresholds");
    expect(problems[0]).toContain(MUTATION_FLOOR_ARTIFACT_FILE);
    expect(problems[0]).toContain('"break":32');
    expect(problems[0]).toContain('"break":60');
    expect(problems[0]).toContain(MUTATION_FLOOR_DIVERGENCE_FIELD);
  });

  it("accepts a divergence that is declared in full", () => {
    const problems = checkMutationFloorOwnership(
      conf({
        thresholds: { high: 80, low: 40, break: 32 },
        [MUTATION_FLOOR_DIVERGENCE_FIELD]: {
          reason: DEFERRED,
          enforced: { high: 80, low: 40, break: 32 },
          declared: IN_STEP,
        },
      }),
      IN_STEP
    );

    expect(problems).toEqual([]);
  });

  it("fails when a declared divergence no longer records the enforced value", () => {
    const problems = checkMutationFloorOwnership(
      conf({
        thresholds: { high: 80, low: 40, break: 45 },
        [MUTATION_FLOOR_DIVERGENCE_FIELD]: {
          reason: DEFERRED,
          enforced: { high: 80, low: 40, break: 32 },
          declared: IN_STEP,
        },
      }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("enforced");
    expect(problems[0]).toContain('"break":45');
  });

  it("fails when a declared divergence no longer records the declared value", () => {
    const problems = checkMutationFloorOwnership(
      conf({
        thresholds: { high: 80, low: 40, break: 32 },
        [MUTATION_FLOOR_DIVERGENCE_FIELD]: {
          reason: DEFERRED,
          enforced: { high: 80, low: 40, break: 32 },
          declared: { high: 80, low: 60, break: 60 },
        },
      }),
      { high: 80, low: 60, break: 55 }
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("declared");
  });

  it("fails when a declared divergence carries no reason", () => {
    const problems = checkMutationFloorOwnership(
      conf({
        thresholds: { high: 80, low: 40, break: 32 },
        [MUTATION_FLOOR_DIVERGENCE_FIELD]: {
          enforced: { high: 80, low: 40, break: 32 },
          declared: IN_STEP,
        },
      }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("reason");
  });

  it("fails when a stale divergence declaration outlives the divergence", () => {
    const problems = checkMutationFloorOwnership(
      conf({
        [MUTATION_FLOOR_DIVERGENCE_FIELD]: {
          reason: DEFERRED,
          enforced: IN_STEP,
          declared: IN_STEP,
        },
      }),
      IN_STEP
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(MUTATION_FLOOR_DIVERGENCE_FIELD);
  });
});

describe("this repository's own stryker.conf.json", () => {
  it("declares that thresholds is config-owned and is not out of step", async () => {
    const strykerConf = await readJson<Record<string, unknown>>(
      path.join(REPO_ROOT, MUTATION_FLOOR_ARTIFACT_FILE)
    );
    const lisaConfig = await readJson<Record<string, unknown>>(
      path.join(REPO_ROOT, ".lisa.config.json")
    );

    expect(
      checkMutationFloorOwnership(
        strykerConf,
        getAtPath(lisaConfig, MUTATION_FLOOR_CONFIG_KEY)
      )
    ).toEqual([]);
  });
});

describe("the shipped stryker.conf.json template", () => {
  it("carries the same ownership statement", async () => {
    const template = await readJson<Record<string, unknown>>(
      path.join(REPO_ROOT, "typescript/create-only/stryker.conf.json")
    );

    expect(checkMutationFloorOwnership(template, template.thresholds)).toEqual(
      []
    );
  });
});

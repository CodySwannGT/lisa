import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import * as health from "../../../src/health/index.js";

const VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-contract-built.mjs";
const HEALTH_EXPORT = "./dist/health/index.js";
const DETERMINISTIC_VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-deterministic-built.mjs";
const AGENTIC_VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-agentic-built.mjs";
const CONSUMER_VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-consumer-built.mjs";

describe("Health v1 package surfaces", () => {
  it("exports the two-phase consumer and canonical serializers", () => {
    expect(health.prepareHealthEvaluation).toBeTypeOf("function");
    expect(health.serializeHealthEvaluationRequest).toBeTypeOf("function");
    expect(health.runPersistedHealth).toBeTypeOf("function");
    expect(health.serializeHealthResult).toBeTypeOf("function");
    expect(health.HEALTH_EVALUATION_PROTOCOL_VERSION).toBe(1);
  });

  it("keeps the source package and forced package template synchronized", async () => {
    const source = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
      exports: Record<string, string>;
    };
    const template = JSON.parse(
      await readFile("package.lisa.json", "utf8")
    ) as {
      force: {
        scripts: Record<string, string>;
        exports: Record<string, string>;
      };
    };

    expect(source.scripts["verify:health-contract"]).toBe(VERIFY_SCRIPT);
    expect(template.force.scripts["verify:health-contract"]).toBe(
      VERIFY_SCRIPT
    );
    expect(source.exports["./health"]).toBe(HEALTH_EXPORT);
    expect(template.force.exports["./health"]).toBe(HEALTH_EXPORT);
    expect(source.scripts["verify:health-deterministic"]).toBe(
      DETERMINISTIC_VERIFY_SCRIPT
    );
    expect(template.force.scripts["verify:health-deterministic"]).toBe(
      DETERMINISTIC_VERIFY_SCRIPT
    );
    expect(source.scripts["verify:health-agentic"]).toBe(AGENTIC_VERIFY_SCRIPT);
    expect(template.force.scripts["verify:health-agentic"]).toBe(
      AGENTIC_VERIFY_SCRIPT
    );
    expect(source.scripts["verify:health-consumer"]).toBe(
      CONSUMER_VERIFY_SCRIPT
    );
    expect(template.force.scripts["verify:health-consumer"]).toBe(
      CONSUMER_VERIFY_SCRIPT
    );
  });
});

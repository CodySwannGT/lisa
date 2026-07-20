import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-contract-built.mjs";
const HEALTH_EXPORT = "./dist/health/index.js";
const DETERMINISTIC_VERIFY_SCRIPT =
  "bun run build:dist && node scripts/verify-health-deterministic-built.mjs";

describe("Health v1 package surfaces", () => {
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
  });
});

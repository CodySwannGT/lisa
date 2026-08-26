/** Structural guard that managed test entrypoints cannot bypass lisa-test-run. */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const MANIFESTS = [
  "package.json",
  "typescript/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
] as const;
const DIRECT_VITEST_SPAWNS = [
  "tests/unit/config/cdk-scratch-lifecycle.test.ts",
  "tests/unit/config/scratch-leak-guard.test.ts",
  "tests/unit/config/scratch-run-root-teardown.test.ts",
  "tests/unit/helpers/io-latency-budget.test.ts",
] as const;

/**
 * Read one JSON manifest's force/root scripts.
 * @param file - Repository-relative manifest path
 * @returns Governed scripts
 */
function scriptsIn(file: string): Readonly<Record<string, string>> {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
  ) as {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly force?: {
      readonly scripts?: Readonly<Record<string, string>>;
    };
  };
  return parsed.scripts ?? parsed.force?.scripts ?? {};
}

/**
 * Whether one managed script invokes a supervised test surface.
 * @param key - Script key
 * @param command - Script command
 * @returns Whether supervision is required
 */
function isManagedTestScript(key: string, command: string): boolean {
  return (
    (/^(?:test(?::|$)|check:shell-guard-refusals$)/u.test(key) &&
      /\b(?:vitest|lisa-mutation|check-shell-guard-refusal-coverage)\b/u.test(
        command
      )) ||
    key === "test:watch"
  );
}

describe("managed test supervision wiring", () => {
  it.each(MANIFESTS)("routes every managed test command in %s", file => {
    const bypasses = Object.entries(scriptsIn(file))
      .filter(([key, command]) => isManagedTestScript(key, command))
      .filter(
        ([, command]) =>
          !/\blisa-test-run (?:--profile\s+[a-z][a-z0-9-]*\s+)?--\s/u.test(
            command
          )
      );

    expect(bypasses).toEqual([]);
  });

  it.each(DIRECT_VITEST_SPAWNS)(
    "routes the internal Vitest spawn in %s",
    file => {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

      expect(source).toContain("lisa-test-run.ts");
      expect(source).toContain('"--import"');
      expect(source).toContain('"tsx"');
      expect(source).toContain('"--profile"');
      expect(source).toContain('"--"');
      expect(source).not.toContain("dist/cli/lisa-test-run.js");
    }
  );
});

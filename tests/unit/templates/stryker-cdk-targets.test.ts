/**
 * CDK projects inherit the TypeScript stack, but their deployable code
 * conventionally lives under `lib/` and `bin/`. The child stack must own its
 * Stryker config or the inherited `src/**`-only template becomes an inert gate.
 * @module tests/unit/templates/stryker-cdk-targets
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CDK_CONFIG = path.join(ROOT, "cdk", "create-only", "stryker.conf.json");
const TYPESCRIPT_CONFIG = path.join(
  ROOT,
  "typescript",
  "create-only",
  "stryker.conf.json"
);

/** Fields this contract reads from a shipped Stryker configuration. */
type StrykerConfig = Readonly<{
  testRunner: string;
  timeoutMS: number;
  dryRunTimeoutMinutes: number;
  mutate: readonly string[];
}>;

const readConfig = (file: string): StrykerConfig =>
  JSON.parse(fs.readFileSync(file, "utf8")) as StrykerConfig;

const isSelected = (patterns: readonly string[], candidate: string): boolean =>
  patterns
    .filter(pattern => !pattern.startsWith("!"))
    .some(pattern => minimatch(candidate, pattern)) &&
  !patterns
    .filter(pattern => pattern.startsWith("!"))
    .some(pattern => minimatch(candidate, pattern.slice(1)));

describe("CDK Stryker template targets", () => {
  it("ships a child-stack override instead of inheriting src-only targets", () => {
    expect(fs.existsSync(CDK_CONFIG)).toBe(true);

    const cdk = readConfig(CDK_CONFIG);
    const typescript = readConfig(TYPESCRIPT_CONFIG);

    expect(cdk.mutate).not.toEqual(typescript.mutate);
    expect(cdk.testRunner).toBe("vitest");
    expect(cdk.timeoutMS).toBe(typescript.timeoutMS);
    expect(cdk.dryRunTimeoutMinutes).toBe(typescript.dryRunTimeoutMinutes);
  });

  it.each([
    "lib/stacks/application-stack.ts",
    "bin/application.ts",
    "src/support/hybrid-helper.ts",
    "src/support/hybrid-view.tsx",
  ])("selects representative CDK source %s", candidate => {
    expect(isSelected(readConfig(CDK_CONFIG).mutate, candidate)).toBe(true);
  });

  it.each([
    "lib/stacks/application-stack.test.ts",
    "lib/stacks/application-stack.spec.ts",
    "lib/types/generated.d.ts",
    "bin/application.test.ts",
    "src/support/hybrid-view.stories.tsx",
  ])("excludes non-production CDK source %s", candidate => {
    expect(isSelected(readConfig(CDK_CONFIG).mutate, candidate)).toBe(false);
  });
});

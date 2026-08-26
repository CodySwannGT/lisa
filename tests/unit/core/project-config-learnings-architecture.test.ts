/**
 * Structural guardrails for the validated learnings-config ownership split.
 * Runtime tests prove behavior; these checks keep the raw-reader escape hatch
 * and the project-config line-cap regression from returning unnoticed.
 * @module tests/unit/core/project-config-learnings-architecture
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CORE = path.join(ROOT, "src", "core");

describe("validated learnings-config architecture", () => {
  it("removes the independent raw config reader", () => {
    expect(
      existsSync(path.join(CORE, "learnings-merge-driver-config.ts"))
    ).toBe(false);
    for (const relative of [
      "src/migrations/ensure-learnings-gitattributes.ts",
      "src/migrations/ensure-learnings-merge-driver.ts",
      "src/cli/doctor-merge-drivers.ts",
    ]) {
      expect(readFileSync(path.join(ROOT, relative), "utf8")).not.toContain(
        "learnings-merge-driver-config"
      );
    }
  });

  it("keeps project-config below its unsuppressed 300 counted-line budget", () => {
    const source = readFileSync(path.join(CORE, "project-config.ts"), "utf8");
    expect(source).not.toMatch(/eslint-disable.*max-lines/u);
    const countedLines = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .filter(
        line => line.trim().length > 0 && !line.trimStart().startsWith("//")
      ).length;
    expect(countedLines).toBeLessThan(300);
  });

  it("keeps every project-config JSDoc block attached to a declaration", () => {
    const source = readFileSync(path.join(CORE, "project-config.ts"), "utf8");
    expect(source).not.toMatch(/\*\/\s*\/\*\*/u);
  });

  it("reads one validated snapshot in each migration method", () => {
    for (const [relative, expectedReads] of [
      ["src/migrations/ensure-learnings-gitattributes.ts", 1],
      ["src/migrations/ensure-learnings-merge-driver.ts", 2],
    ] as const) {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      expect(source).toContain("readProjectConfig(ctx.projectDir)");
      expect(source).toContain("resolveLearningsSettings");
      expect(source).not.toMatch(/readFile\([^)]*PROJECT_CONFIG/iu);
      expect(
        source.match(/readProjectConfig\(ctx\.projectDir\)/gu)?.length
      ).toBe(expectedReads);
    }
  });
});

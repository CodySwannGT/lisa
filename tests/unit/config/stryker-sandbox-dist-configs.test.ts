/**
 * The mutation sandbox keeps the repository's own built vitest config
 * (CodySwannGT/lisa#4910).
 *
 * `vitest.config.ts` imports `@codyswann/lisa/vitest/typescript`, which the
 * package's own `exports` map to `dist/configs/vitest/typescript.js`. Stryker
 * copies the tree into a sandbox and leaves `dist/` out. Without
 * `dist/configs`, that import resolved to the published copy under
 * `node_modules` instead, and a fresh install's copy still wired a retired
 * leak guard that failed every dry run on unrelated suites.
 * @module tests/unit/config/stryker-sandbox-dist-configs
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Read a JSON file at the repository root.
 * @param name - File name
 * @returns The parsed value
 */
function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, name), "utf8"));
}

describe("the Stryker sandbox and the built vitest config", () => {
  const patterns = readJson("stryker.conf.json").ignorePatterns as string[];

  it("lets dist/configs back in after leaving dist out", () => {
    const excluded = patterns.indexOf("dist/*");
    const restored = patterns.indexOf("!dist/configs");
    expect(excluded).toBeGreaterThanOrEqual(0);
    expect(restored).toBeGreaterThan(excluded);
  });

  it("never excludes dist/configs again after restoring it", () => {
    const restored = patterns.indexOf("!dist/configs");
    const later = patterns.slice(restored + 1);
    expect(later.filter(pattern => pattern.startsWith("dist/configs"))).toEqual(
      []
    );
  });

  it("is where the vitest config's import resolves", () => {
    const exports = readJson("package.json").exports as Record<string, unknown>;
    expect(String(exports["./vitest/typescript"])).toMatch(
      /^\.\/dist\/configs\//u
    );
  });
});

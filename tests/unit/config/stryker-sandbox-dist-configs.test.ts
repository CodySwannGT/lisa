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
import { readFileSync, readdirSync } from "node:fs";
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

/**
 * Every source file under `src/configs`, recursively.
 * @param dir - Folder to walk, relative to the repository root
 * @returns Repository-relative paths of its `.ts` files
 */
function configSources(dir = "src/configs"): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    entry => {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return configSources(child);
      return entry.name.endsWith(".ts") ? [child] : [];
    }
  );
}

/**
 * The built files a config module imports from `dist/` outside `dist/configs`.
 * The built config is loaded inside the sandbox, so each of these has to be
 * in the sandbox as well.
 * @returns Paths such as `dist/utils/process-environment.js`, deduplicated
 */
function builtImportsOutsideConfigs(): string[] {
  const found = configSources().flatMap(file =>
    [
      ...readFileSync(path.join(ROOT, file), "utf8").matchAll(
        /from\s+"(\.\.\/[^"]+\.js)"/gu
      ),
    ]
      .map(match =>
        path.posix.normalize(
          path.posix.join(path.posix.dirname(file), match[1] ?? "")
        )
      )
      .filter(
        target =>
          target.startsWith("src/") && !target.startsWith("src/configs/")
      )
      .map(target => target.replace(/^src\//u, "dist/"))
  );
  return [...new Set(found)].sort((a, b) => a.localeCompare(b));
}

/**
 * Whether the sandbox keeps a path, by the ignore list's own rule: the last
 * pattern that matches the path or one of its folders decides.
 * @param patterns - `ignorePatterns` from `stryker.conf.json`
 * @param target - Repository-relative path
 * @returns True when the path is copied into the sandbox
 */
function keptInSandbox(patterns: readonly string[], target: string): boolean {
  const parts = target.split("/");
  const prefixes = parts.map((_part, index) =>
    parts.slice(0, index + 1).join("/")
  );
  return prefixes.every(prefix => {
    const deciding = [...patterns].reverse().find(pattern => {
      const body = pattern.replace(/^!/u, "");
      return body.endsWith("/*")
        ? path.posix.dirname(prefix) === body.slice(0, -2)
        : body === prefix;
    });
    return deciding === undefined || deciding.startsWith("!");
  });
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

  it("keeps every built file the config imports from outside dist/configs", () => {
    // The built config is loaded INSIDE the sandbox. When it gained an import
    // of dist/utils/process-environment.js and the sandbox did not, every
    // mutation run died on ERR_MODULE_NOT_FOUND before a mutant was tried.
    const needed = builtImportsOutsideConfigs();

    expect(needed).toContain("dist/utils/process-environment.js");
    expect(needed.filter(target => !keptInSandbox(patterns, target))).toEqual(
      []
    );
  });

  it("still leaves the rest of dist out", () => {
    expect(keptInSandbox(patterns, "dist/index.js")).toBe(false);
    expect(keptInSandbox(patterns, "dist/utils/fibonacci.js")).toBe(false);
    expect(keptInSandbox(patterns, "dist/core/config.js")).toBe(false);
    expect(keptInSandbox(patterns, "dist/core/lisa-release-pin.js")).toBe(true);
    expect(keptInSandbox(patterns, "dist/configs/vitest/base.js")).toBe(true);
  });

  it("is where the vitest config's import resolves", () => {
    const exports = readJson("package.json").exports as Record<string, unknown>;
    expect(String(exports["./vitest/typescript"])).toMatch(
      /^\.\/dist\/configs\//u
    );
  });
});

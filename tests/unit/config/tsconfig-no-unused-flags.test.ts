/**
 * Unit tests that guard against reintroducing TypeScript's blunt unused-vars
 * compile-time enforcement into Lisa's tsconfig templates.
 *
 * Background: `noUnusedLocals` and `noUnusedParameters` in tsconfig have no
 * escape hatch for intentional unused values. Projects that use the standard
 * `_foo` convention for intentional unused destructured vars or stack
 * references end up failing `tsc` with TS6133 despite being lint-clean. Lisa
 * relies on ESLint's `@typescript-eslint/no-unused-vars` with `^_`-ignore
 * patterns instead, which honors the long-established community convention.
 *
 * See companion tests in `eslint-no-unused-vars.test.ts` that pin the ESLint
 * rule configuration.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Load a JSON file from disk and return its parsed contents.
 * @param relativePath - Path relative to the Lisa repo root
 * @returns Parsed JSON (unknown shape; tests narrow as needed)
 */
function readTemplateJson(relativePath: string): unknown {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolute, "utf-8"));
}

/**
 * Minimal shape of a tsconfig JSON file for the assertions in this test suite.
 */
interface TsconfigShape {
  readonly compilerOptions?: {
    readonly noUnusedLocals?: boolean;
    readonly noUnusedParameters?: boolean;
  };
}

describe("tsconfig templates do not enforce TypeScript-native unused-vars checks", () => {
  it.each([
    ["tsconfig/typescript.json"],
    ["tsconfig/base.json"],
    ["tsconfig/cdk.json"],
    ["cdk/copy-overwrite/tsconfig.cdk.json"],
  ])("%s does not set noUnusedLocals", relPath => {
    const tsconfig = readTemplateJson(relPath) as TsconfigShape;
    // noUnusedLocals has no `_`-prefix escape hatch and breaks projects that
    // follow the standard `_foo` convention for intentional unused vars.
    // Enforcement lives in ESLint's @typescript-eslint/no-unused-vars rule.
    expect(tsconfig.compilerOptions?.noUnusedLocals).toBeUndefined();
  });

  it.each([
    ["tsconfig/typescript.json"],
    ["tsconfig/base.json"],
    ["tsconfig/cdk.json"],
    ["cdk/copy-overwrite/tsconfig.cdk.json"],
  ])("%s does not set noUnusedParameters", relPath => {
    const tsconfig = readTemplateJson(relPath) as TsconfigShape;
    // noUnusedParameters has the same issue as noUnusedLocals. ESLint's rule
    // with `argsIgnorePattern: "^_"` handles this gracefully.
    expect(tsconfig.compilerOptions?.noUnusedParameters).toBeUndefined();
  });
});

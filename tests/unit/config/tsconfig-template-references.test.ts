/**
 * Unit tests that guard against broken `extends` references in the stack
 * tsconfig templates shipped by Lisa.
 *
 * Background: downstream CDK/Nest/Expo projects used to get a
 * `tsconfig.<stack>.json` whose `extends` pointed at `./tsconfig.base.json`
 * — a file Lisa never copies into the project. The broken reference was
 * invisible unless someone actually ran `tsc --project tsconfig.cdk.json`,
 * at which point TS5083 fires and the project fails to type-check.
 *
 * These tests pin the fix so future edits to the templates can't silently
 * reintroduce the broken reference.
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
 * Coerce the `extends` field into an array regardless of its on-disk shape.
 * tsconfig JSON permits `extends` as a string or array of strings.
 * @param value - Value of the `extends` field (string, array, or absent)
 * @returns Array form (possibly empty) for uniform assertions
 */
function asExtendsArray(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Minimal shape of a tsconfig JSON file for the assertions in this test suite.
 * Only `extends` is required; other fields are ignored.
 */
interface TsconfigShape {
  readonly extends?: string | readonly string[];
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>;
  };
}

describe("stack tsconfig templates extend resolvable references", () => {
  it.each([
    ["cdk/copy-overwrite/tsconfig.cdk.json"],
    ["nestjs/copy-overwrite/tsconfig.nestjs.json"],
    ["expo/copy-overwrite/tsconfig.expo.json"],
  ])("%s does not reference the missing ./tsconfig.base.json", relPath => {
    const tsconfig = readTemplateJson(relPath) as TsconfigShape;
    const extendsList = asExtendsArray(tsconfig.extends);
    // The file ./tsconfig.base.json is never copied into downstream projects,
    // so any template that extends it produces a TS5083 "Cannot read file"
    // error when the downstream project runs tsc against that config.
    expect(extendsList).not.toContain("./tsconfig.base.json");
  });

  it("cdk/tsconfig.cdk.json extends the published @codyswann/lisa/tsconfig/base", () => {
    const tsconfig = readTemplateJson(
      "cdk/copy-overwrite/tsconfig.cdk.json"
    ) as TsconfigShape;
    const extendsList = asExtendsArray(tsconfig.extends);
    expect(extendsList).toContain("@codyswann/lisa/tsconfig/base");
  });

  it("expo/tsconfig.expo.json delegates path aliases to the project-owned tsconfig.local.json", () => {
    // Regression: the copy-overwrite tsconfig.expo.json used to hardcode
    // ROOT-layout path aliases (`@/*` -> `./*`, `@/graphql/*` -> `./generated/*`)
    // and unconditionally overwrite them on every `lisa` run. That clobbered
    // every src/-layout project (`@/*` -> `./src/*`), breaking ~1928 imports in
    // geminisportsai/frontend-v2. The fix removes layout-specific `paths` from
    // the overwritten file and delegates them to `./tsconfig.local.json`, which
    // is create-only (project-owned) and therefore survives updates — so a
    // src/-layout project keeps its `./src/*` mappings.
    const tsconfig = readTemplateJson(
      "expo/copy-overwrite/tsconfig.expo.json"
    ) as TsconfigShape;
    const extendsList = asExtendsArray(tsconfig.extends);
    // It must inherit the project-owned local that carries the path aliases.
    expect(extendsList).toContain("./tsconfig.local.json");
    // It must NOT carry hardcoded path aliases that would clobber the project's
    // layout-specific mappings on every overwrite.
    expect(tsconfig.compilerOptions?.paths).toBeUndefined();
  });

  it("expo/tsconfig.local.json is create-only so layout-specific paths survive updates", () => {
    // The path aliases live in tsconfig.local.json, which Lisa ships under
    // create-only/ (written once, never overwritten). A project that has
    // migrated to the src/ layout edits this file to `./src/*` and that change
    // must persist across `lisa` updates.
    const createOnly = path.join(
      REPO_ROOT,
      "expo",
      "create-only",
      "tsconfig.local.json"
    );
    expect(fs.existsSync(createOnly)).toBe(true);
    // The overwritten tsconfig.expo.json must NOT also ship under copy-overwrite
    // as a tsconfig.local.json (which would re-clobber the project's paths).
    const copyOverwriteLocal = path.join(
      REPO_ROOT,
      "expo",
      "copy-overwrite",
      "tsconfig.local.json"
    );
    expect(fs.existsSync(copyOverwriteLocal)).toBe(false);
  });

  it("@codyswann/lisa/tsconfig/base is exported from package.json", () => {
    const pkg = readTemplateJson("package.json") as {
      readonly exports?: Record<string, string>;
    };
    expect(pkg.exports?.["./tsconfig/base"]).toBe("./tsconfig/base.json");
    // The target file must actually exist for the export to resolve.
    expect(fs.existsSync(path.join(REPO_ROOT, "tsconfig", "base.json"))).toBe(
      true
    );
  });
});

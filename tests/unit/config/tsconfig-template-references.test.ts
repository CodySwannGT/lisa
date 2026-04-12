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

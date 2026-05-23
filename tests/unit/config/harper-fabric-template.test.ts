/**
 * Regression guards for Harper/Fabric stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Read a JSON template from the Lisa repository.
 * @param relativePath - Repo-relative JSON path
 * @returns Parsed template content
 */
function readJson(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
  );
}

describe("Harper/Fabric templates", () => {
  it("delete inherited Jest local config from the TypeScript parent stack", () => {
    const deletions = readJson("harper-fabric/deletions.json") as {
      readonly paths?: readonly string[];
    };

    expect(deletions.paths).toContain("jest.config.local.ts");
  });

  it("ignore hook-invoked binaries in Knip", () => {
    const knip = readJson("harper-fabric/copy-overwrite/knip.json") as {
      readonly ignoreBinaries?: readonly string[];
    };

    expect(knip.ignoreBinaries).toEqual(
      expect.arrayContaining(["audit", "knip"])
    );
  });

  it("includes slow lint config but not Jest config in the ESLint project", () => {
    const tsconfig = readJson(
      "harper-fabric/copy-overwrite/tsconfig.eslint.json"
    ) as {
      readonly include?: readonly string[];
    };

    expect(tsconfig.include).toContain("eslint.slow.config.ts");
    expect(tsconfig.include).not.toContain("jest.config.local.ts");
  });
});

/**
 * Regression guards for Harper/Fabric stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HARPER_FABRIC_KNIP_TEMPLATE = "harper-fabric/copy-overwrite/knip.json";

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

/**
 * Read a text template from the Lisa repository.
 * @param relativePath - Repo-relative text path
 * @returns Template content
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

describe("Harper/Fabric templates", () => {
  it("delete inherited Jest local config from the TypeScript parent stack", () => {
    const deletions = readJson("harper-fabric/deletions.json") as {
      readonly paths?: readonly string[];
    };

    expect(deletions.paths).toContain("jest.config.local.ts");
  });

  it("ignore hook-invoked binaries in Knip", () => {
    const knip = readJson(HARPER_FABRIC_KNIP_TEMPLATE) as {
      readonly ignoreBinaries?: readonly string[];
    };

    expect(knip.ignoreBinaries).toEqual(
      expect.arrayContaining(["audit", "knip"])
    );
  });

  it("suppresses generated Harper schema row types in Knip", () => {
    const knip = readJson(HARPER_FABRIC_KNIP_TEMPLATE) as {
      readonly ignoreIssues?: Readonly<Record<string, readonly string[]>>;
    };

    expect(knip.ignoreIssues?.["src/types/harper-schema.ts"]).toContain(
      "types"
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

  it("keeps generated web and scraped research captures out of Prettier", () => {
    const prettierIgnore = readText(
      "harper-fabric/copy-contents/.prettierignore"
    );

    expect(prettierIgnore).toContain("harper-app/web/");
    expect(prettierIgnore).toContain("research/articles/");
  });

  it("ignores per-resource generated Harper deploy artifacts everywhere", () => {
    // The Harper build emits one `harper-app/resource-<name>.js` per resource
    // alongside the `harper-app/resources.js` barrel. Every ignore surface must
    // cover the per-resource glob or lint/knip/oxlint break after a Lisa update.
    const oxlint = readJson("oxlint/harper-fabric.json") as {
      readonly ignorePatterns?: readonly string[];
    };
    const oxlintMerge = readJson("harper-fabric/merge/.oxlintrc.json") as {
      readonly ignorePatterns?: readonly string[];
    };
    const knip = readJson(HARPER_FABRIC_KNIP_TEMPLATE) as {
      readonly ignore?: readonly string[];
    };
    const tsconfigEslint = readJson(
      "harper-fabric/copy-overwrite/tsconfig.eslint.json"
    ) as { readonly exclude?: readonly string[] };
    const gitignore = readText("harper-fabric/copy-contents/.gitignore");
    const eslintConfigSource = readText("src/configs/eslint/harper-fabric.ts");
    const perResourceGlob = "harper-app/resource-*.js";

    expect(oxlint.ignorePatterns).toContain(perResourceGlob);
    expect(oxlintMerge.ignorePatterns).toContain(perResourceGlob);
    expect(knip.ignore).toContain(perResourceGlob);
    expect(tsconfigEslint.exclude).toContain(perResourceGlob);
    expect(gitignore).toContain(perResourceGlob);
    expect(eslintConfigSource).toContain(`"${perResourceGlob}"`);
  });

  it("keeps the generated Codex distribution mirror out of Prettier", () => {
    // Lisa regenerates `.codex/` on every run with generated YAML/markdown that
    // does not satisfy the project's Prettier config. It must be excluded from
    // format gates in the TypeScript base inherited by every stack.
    const prettierIgnore = readText(
      "typescript/copy-overwrite/.prettierignore"
    );

    expect(prettierIgnore).toContain(".codex");
  });
});

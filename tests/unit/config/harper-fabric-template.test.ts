/**
 * Regression guards for Harper/Fabric stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HARPER_FABRIC_KNIP_TEMPLATE = "harper-fabric/copy-overwrite/knip.json";
const HARPER_FABRIC_TSCONFIG_ESLINT_TEMPLATE =
  "harper-fabric/copy-overwrite/tsconfig.eslint.json";
const HARPER_FABRIC_PRETTIERIGNORE_TEMPLATE =
  "harper-fabric/copy-contents/.prettierignore";
const GENERATED_ARTIFACT_GLOBS_TEMPLATE =
  "plugins/src/harper-fabric/generated-artifact-globs.txt";

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

/**
 * Read the source-of-truth generated Harper artifact glob list.
 * @returns Non-empty generated artifact glob entries
 */
function readGeneratedArtifactGlobs(): readonly string[] {
  return readText(GENERATED_ARTIFACT_GLOBS_TEMPLATE)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));
}

/**
 * Assert that one ignore surface contains every generated artifact glob.
 * @param surfaceName - Human-readable surface name for assertion messages
 * @param values - Ignore values from the surface
 * @param expectedGlobs - Required generated artifact glob values
 */
function expectContainsAllGlobs(
  surfaceName: string,
  values: readonly string[],
  expectedGlobs: readonly string[]
): void {
  for (const glob of expectedGlobs) {
    expect(values, `${surfaceName} is missing ${glob}`).toContain(glob);
  }
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
    const tsconfig = readJson(HARPER_FABRIC_TSCONFIG_ESLINT_TEMPLATE) as {
      readonly include?: readonly string[];
    };

    expect(tsconfig.include).toContain("eslint.slow.config.ts");
    expect(tsconfig.include).not.toContain("jest.config.local.ts");
  });

  it("keeps generated web and scraped research captures out of Prettier", () => {
    const prettierIgnore = readText(HARPER_FABRIC_PRETTIERIGNORE_TEMPLATE);

    expect(prettierIgnore).toContain("harper-app/web/**");
    expect(prettierIgnore).toContain("research/articles/");
  });

  it("keeps generated Harper deploy artifacts ignored across every surface", () => {
    const generatedArtifactGlobs = readGeneratedArtifactGlobs();
    const oxlint = readJson("oxlint/harper-fabric.json") as {
      readonly ignorePatterns?: readonly string[];
    };
    const oxlintMerge = readJson("harper-fabric/merge/.oxlintrc.json") as {
      readonly ignorePatterns?: readonly string[];
    };
    const knip = readJson(HARPER_FABRIC_KNIP_TEMPLATE) as {
      readonly ignore?: readonly string[];
    };
    const tsconfigEslint = readJson(HARPER_FABRIC_TSCONFIG_ESLINT_TEMPLATE) as {
      readonly exclude?: readonly string[];
    };
    const gitignore = readText("harper-fabric/copy-contents/.gitignore")
      .split(/\r?\n/)
      .map(line => line.trim());
    const prettierIgnore = readText(HARPER_FABRIC_PRETTIERIGNORE_TEMPLATE)
      .split(/\r?\n/)
      .map(line => line.trim());
    const eslintConfigSource = readText("src/configs/eslint/harper-fabric.ts");

    expectContainsAllGlobs(
      "oxlint/harper-fabric.json",
      oxlint.ignorePatterns ?? [],
      generatedArtifactGlobs
    );
    expectContainsAllGlobs(
      "harper-fabric/merge/.oxlintrc.json",
      oxlintMerge.ignorePatterns ?? [],
      generatedArtifactGlobs
    );
    expectContainsAllGlobs(
      HARPER_FABRIC_KNIP_TEMPLATE,
      knip.ignore ?? [],
      generatedArtifactGlobs
    );
    expectContainsAllGlobs(
      HARPER_FABRIC_TSCONFIG_ESLINT_TEMPLATE,
      tsconfigEslint.exclude ?? [],
      generatedArtifactGlobs
    );
    expectContainsAllGlobs(
      "harper-fabric/copy-contents/.gitignore",
      gitignore,
      generatedArtifactGlobs
    );
    expectContainsAllGlobs(
      HARPER_FABRIC_PRETTIERIGNORE_TEMPLATE,
      prettierIgnore,
      generatedArtifactGlobs
    );

    for (const glob of generatedArtifactGlobs) {
      expect(
        eslintConfigSource,
        `src/configs/eslint/harper-fabric.ts is missing ${glob}`
      ).toContain(`"${glob}"`);
    }
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

import * as fs from "fs-extra";
import * as path from "node:path";
import * as os from "node:os";

const PACKAGE_JSON = "package.json";
const TSCONFIG_JSON = "tsconfig.json";
const APP_JSON = "app.json";
const NEST_CLI_JSON = "nest-cli.json";
const CDK_JSON = "cdk.json";
const BIN_RAILS = "bin/rails";
const CONFIG_APPLICATION_RB = "config/application.rb";
const GEMFILE = "Gemfile";
const COPY_OVERWRITE = "copy-overwrite";
const COPY_CONTENTS = "copy-contents";
const CREATE_ONLY = "create-only";
const LISA_TEST_PREFIX = "lisa-test-";

/**
 * Create a temporary directory for testing
 * @returns Promise resolving to path of created temporary directory
 */
export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), LISA_TEST_PREFIX));
}

/**
 * Clean up a temporary directory
 * @param dir - Directory path to remove
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  if (dir && (await fs.pathExists(dir))) {
    await fs.remove(dir);
  }
}

/**
 * Create a minimal project structure with package.json
 * @param dir - Directory to create project structure in
 */
export async function createMinimalProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, PACKAGE_JSON), {});
}

/**
 * Create a TypeScript project structure with tsconfig.json
 * @param dir - Directory to create project structure in
 */
export async function createTypeScriptProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, PACKAGE_JSON), {
    dependencies: { typescript: "^5.0.0" },
  });
  await fs.writeJson(path.join(dir, TSCONFIG_JSON), {});
}

/**
 * Create an Expo project structure with app.json
 * @param dir - Directory to create project structure in
 */
export async function createExpoProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, PACKAGE_JSON), {
    dependencies: { expo: "^50.0.0" },
  });
  await fs.writeJson(path.join(dir, APP_JSON), {
    expo: { name: "test-app" },
  });
}

/**
 * Create a NestJS project structure with nest-cli.json
 * @param dir - Directory to create project structure in
 */
export async function createNestJSProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, PACKAGE_JSON), {
    dependencies: { "@nestjs/core": "^10.0.0" },
  });
  await fs.writeJson(path.join(dir, NEST_CLI_JSON), {});
}

/**
 * Create a CDK project structure with cdk.json
 * @param dir - Directory to create project structure in
 */
export async function createCDKProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, PACKAGE_JSON), {
    dependencies: { "aws-cdk-lib": "^2.0.0" },
  });
  await fs.writeJson(path.join(dir, CDK_JSON), {});
}

/**
 * Create a Rails project structure with bin/rails and config/application.rb
 * @param dir - Directory to create project structure in
 */
export async function createRailsProject(dir: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.ensureDir(path.join(dir, "bin"));
  await fs.ensureDir(path.join(dir, "config"));
  await fs.writeFile(path.join(dir, BIN_RAILS), "#!/usr/bin/env ruby\n");
  await fs.writeFile(
    path.join(dir, CONFIG_APPLICATION_RB),
    'require_relative "boot"\n'
  );
  await fs.writeFile(
    path.join(dir, GEMFILE),
    'source "https://rubygems.org"\ngem "rails"\n'
  );
}

/**
 * Create a mock Lisa config directory structure with all strategies
 * @param dir - Directory to create Lisa structure in
 */
export async function createMockLisaDir(dir: string): Promise<void> {
  // Create all/ directory with test files
  const allCopyOverwrite = path.join(dir, "all", COPY_OVERWRITE);
  const allCopyContents = path.join(dir, "all", COPY_CONTENTS);
  const allCreateOnly = path.join(dir, "all", CREATE_ONLY);
  const allMerge = path.join(dir, "all", "merge");

  await fs.ensureDir(allCopyOverwrite);
  await fs.ensureDir(allCopyContents);
  await fs.ensureDir(allCreateOnly);
  await fs.ensureDir(allMerge);

  await fs.writeFile(path.join(allCopyOverwrite, "test.txt"), "test content\n");
  await fs.writeFile(
    path.join(allCopyContents, ".gitignore"),
    "node_modules\n.env\n"
  );
  await fs.writeFile(path.join(allCreateOnly, "README.md"), "# Test\n");
  await fs.writeJson(path.join(allMerge, PACKAGE_JSON), {
    scripts: { test: "echo test" },
  });

  // Create typescript/ directory
  const tsCopyOverwrite = path.join(dir, "typescript", COPY_OVERWRITE);
  await fs.ensureDir(tsCopyOverwrite);
  await fs.writeFile(path.join(tsCopyOverwrite, "tsconfig.base.json"), "{}");

  // Create rails/ directory with Rails-specific files
  const railsCopyOverwrite = path.join(dir, "rails", COPY_OVERWRITE);
  const railsCopyContents = path.join(dir, "rails", COPY_CONTENTS);
  const railsCreateOnly = path.join(dir, "rails", CREATE_ONLY);

  await fs.ensureDir(railsCopyOverwrite);
  await fs.ensureDir(railsCopyContents);
  await fs.ensureDir(railsCreateOnly);

  await fs.writeFile(
    path.join(railsCopyOverwrite, "CLAUDE.md"),
    "Rails governance rules\n"
  );
  await fs.writeFile(
    path.join(railsCopyOverwrite, ".rubocop.yml"),
    "AllCops:\n  NewCops: enable\n"
  );
  await fs.writeFile(
    path.join(railsCopyOverwrite, "lefthook.yml"),
    "pre-commit:\n  commands:\n    rubocop:\n      run: bundle exec rubocop\n"
  );
  await fs.writeFile(
    path.join(railsCopyOverwrite, "Gemfile.lisa"),
    'gem "strong_migrations", "~> 2.5"\n'
  );
  await fs.writeFile(
    path.join(railsCopyContents, "Gemfile"),
    "# BEGIN: AI GUARDRAILS\neval_gemfile 'Gemfile.lisa'\n# END: AI GUARDRAILS\n"
  );
  await fs.writeFile(
    path.join(railsCreateOnly, ".rubocop.local.yml"),
    "# Project-specific overrides\n"
  );
  await fs.writeFile(
    path.join(railsCreateOnly, ".mise.toml"),
    '[tools]\nruby = "3.4.8"\n'
  );
  await fs.ensureDir(path.join(railsCreateOnly, ".github", "workflows"));
  await fs.writeFile(
    path.join(railsCreateOnly, ".github", "workflows", "ci.yml"),
    "name: CI\n\non:\n  pull_request:\n  workflow_dispatch:\n\njobs:\n  quality:\n    name: Quality Checks\n    uses: ./.github/workflows/quality.yml\n    secrets: inherit\n"
  );
  await fs.writeFile(
    path.join(railsCreateOnly, ".github", "workflows", "quality.yml"),
    "name: Quality\n\non:\n  workflow_call:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n"
  );

  // Create rails/deletions.json
  await fs.writeJson(path.join(dir, "rails", "deletions.json"), {
    paths: [".overcommit.yml"],
  });
}

/**
 * Count files in a directory recursively
 * @param dir - Directory to count files in
 * @returns Promise resolving to total file count
 */
export async function countFiles(dir: string): Promise<number> {
  /**
   * Recursively walk directory tree and sum file counts
   * @param currentDir - Current directory being walked
   * @returns Promise resolving to file count in this subtree
   */
  async function walk(currentDir: string): Promise<number> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const counts = await Promise.all(
      entries.map(async entry => {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          return walk(fullPath);
        }
        return entry.isFile() ? 1 : 0;
      })
    );
    return counts.reduce((sum, c) => sum + c, 0);
  }

  return (await fs.pathExists(dir)) ? walk(dir) : 0;
}

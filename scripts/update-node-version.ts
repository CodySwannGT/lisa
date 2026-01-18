#!/usr/bin/env npx tsx
/**
 * Updates Node.js version across all configuration files in the Lisa project.
 *
 * Reads the version from .nvmrc and updates:
 * - GitHub workflow files (node_version, node-version inputs)
 * - package.json engine constraints
 *
 * @example
 * ```bash
 * # Run from project root
 * npx tsx scripts/update-node-version.ts
 *
 * # Or with bun
 * bun scripts/update-node-version.ts
 * ```
 */
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Patterns to match and replace in workflow files
 */
interface ReplacementPattern {
  /** Regex pattern to match */
  readonly pattern: RegExp;
  /** Replacement string (use $1, $2 for capture groups, {{version}} for the new version) */
  readonly replacement: string;
}

const WORKFLOW_PATTERNS: readonly ReplacementPattern[] = [
  // node_version: '22.21.1' (workflow input defaults)
  {
    pattern: /(node_version:\s*['"])[\d.]+(['"])/g,
    replacement: "$1{{version}}$2",
  },
  // node-version: '22.21.1' (actions/setup-node)
  {
    pattern: /(node-version:\s*['"])[\d.]+(['"])/g,
    replacement: "$1{{version}}$2",
  },
  // node-version: '22.x' (major version pattern)
  {
    pattern: /(node-version:\s*['"])\d+\.x(['"])/g,
    replacement: "$1{{major}}.x$2",
  },
];

const PACKAGE_JSON_PATTERN: ReplacementPattern = {
  pattern: /("node":\s*["'])[\d.]+(["'])/g,
  replacement: "$1{{version}}$2",
};

/**
 * Files to update (relative to project root)
 */
const FILES_TO_UPDATE: readonly string[] = [
  // This project's workflows
  ".github/workflows/ci.yml",
  ".github/workflows/quality.yml",
  ".github/workflows/publish-to-npm.yml",

  // TypeScript template workflows
  "typescript/copy-overwrite/.github/workflows/quality.yml",
  "typescript/copy-overwrite/.github/workflows/release.yml",
  "typescript/copy-overwrite/.github/workflows/create-github-issue-on-failure.yml",
  "typescript/copy-overwrite/.github/workflows/create-jira-issue-on-failure.yml",
  "typescript/copy-overwrite/.github/workflows/create-sentry-issue-on-failure.yml",
  "typescript/merge/package.json",

  // Expo template workflows
  "expo/copy-overwrite/.github/workflows/ci.yml",
  "expo/copy-overwrite/.github/workflows/deploy.yml",
  "expo/copy-overwrite/.github/workflows/build.yml",
  "expo/copy-overwrite/.github/workflows/lighthouse.yml",

  // NestJS template workflows
  "nestjs/copy-overwrite/.github/workflows/ci.yml",
  "nestjs/copy-overwrite/.github/workflows/deploy.yml",

  // CDK template workflows
  "cdk/copy-overwrite/workflows/ci.yml",

  // npm-package template workflows
  "npm-package/copy-overwrite/.github/workflows/publish-to-npm.yml",
];

/**
 * Reads the Node.js version from .nvmrc
 */
function readNvmrcVersion(): string {
  const nvmrcPath = path.join(PROJECT_ROOT, ".nvmrc");
  const content = fs.readFileSync(nvmrcPath, "utf-8").trim();

  if (!/^\d+\.\d+\.\d+$/.test(content)) {
    throw new Error(
      `Invalid version format in .nvmrc: "${content}". Expected semver (e.g., 22.21.1)`
    );
  }

  return content;
}

/**
 * Extracts the major version from a semver string
 */
function getMajorVersion(version: string): string {
  return version.split(".")[0];
}

/**
 * Updates a file with the new Node version
 */
function updateFile(
  filePath: string,
  version: string,
  majorVersion: string
): { updated: boolean; changes: number } {
  const fullPath = path.join(PROJECT_ROOT, filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`  [SKIP] ${filePath} (file not found)`);
    return { updated: false, changes: 0 };
  }

  const originalContent = fs.readFileSync(fullPath, "utf-8");
  let content = originalContent;
  let totalChanges = 0;

  const patterns = filePath.endsWith(".json")
    ? [PACKAGE_JSON_PATTERN]
    : WORKFLOW_PATTERNS;

  patterns.forEach(({ pattern, replacement }) => {
    const resolvedReplacement = replacement
      .replace("{{version}}", version)
      .replace("{{major}}", majorVersion);

    const matches = content.match(pattern);
    if (matches) {
      totalChanges += matches.length;
    }

    content = content.replace(pattern, resolvedReplacement);
  });

  if (content !== originalContent) {
    fs.writeFileSync(fullPath, content, "utf-8");
    console.log(`  [OK] ${filePath} (${totalChanges} replacements)`);
    return { updated: true, changes: totalChanges };
  }

  console.log(`  [SKIP] ${filePath} (no changes needed)`);
  return { updated: false, changes: 0 };
}

/**
 * Main entry point
 */
function main(): void {
  console.log("Node Version Updater");
  console.log("====================\n");

  const version = readNvmrcVersion();
  const majorVersion = getMajorVersion(version);

  console.log(`Source: .nvmrc`);
  console.log(`Version: ${version}`);
  console.log(`Major: ${majorVersion}.x\n`);

  console.log("Updating files...\n");

  let filesUpdated = 0;
  let totalChanges = 0;

  FILES_TO_UPDATE.forEach(file => {
    const result = updateFile(file, version, majorVersion);
    if (result.updated) {
      filesUpdated++;
      totalChanges += result.changes;
    }
  });

  console.log("\n====================");
  console.log(`Files updated: ${filesUpdated}`);
  console.log(`Total replacements: ${totalChanges}`);

  if (filesUpdated > 0) {
    console.log(
      "\nRemember to commit these changes and regenerate package-lock.json if needed."
    );
  }
}

main();

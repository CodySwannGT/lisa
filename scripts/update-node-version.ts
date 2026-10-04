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
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Literals named once — each was repeated enough times that a typo in one
// copy would diverge silently.
const VERSION_REPLACEMENT = "$1{{version}}$2";

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
  // Include reusable-workflow defaults and expression fallbacks as well as
  // ordinary callers. Only Node-shaped keys are rewritten.
  {
    pattern: /((?:node_version|node-version):\s*['"]?)\d+\.\d+\.\d+(['"]?)/g,
    replacement: VERSION_REPLACEMENT,
  },
  {
    pattern:
      /(node_version:\n(?: +(?:description|type|required):[^\n]*\n)* +default: *['"])\d+\.\d+\.\d+(['"])/g,
    replacement: VERSION_REPLACEMENT,
  },
  {
    pattern: /(node-version:.*?\|\|\s*['"])\d+\.\d+\.\d+(['"])/g,
    replacement: VERSION_REPLACEMENT,
  },
  {
    pattern: /(node-version:\s*['"])\d+\.x(['"])/g,
    replacement: "$1{{major}}.x$2",
  },
];

const PACKAGE_JSON_PATTERN: ReplacementPattern = {
  pattern: /("node":\s*["'](?:>=\s*)?)\d+\.\d+\.\d+(["'])/g,
  replacement: VERSION_REPLACEMENT,
};

/**
 * Current tracked runtime surfaces, rather than the removed merge/workflow
 * paths used by the original updater. Historical plans and test fixtures are
 * deliberately excluded. Adding a shipped stack workflow needs no list edit.
 * @returns Existing repository-relative files governed by shared Node policy
 */
function filesToUpdate(): readonly string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter(
      file =>
        [
          "package.json",
          "package.lisa.json",
          "typescript/copy-overwrite/.nvmrc",
          "expo/create-only/eas.json",
        ].includes(file) ||
        /^(?:typescript|cdk|nestjs|npm-package|phaser|harper-fabric)\/package-lisa\/package\.lisa\.json$/.test(
          file
        ) ||
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file) ||
        /^(?:all|typescript|cdk|expo|nestjs|npm-package|phaser|harper-fabric)\/(?:copy-overwrite|create-only)\/\.github\/workflows\/[^/]+\.ya?ml$/.test(
          file
        )
    );
}

/**
 * Reads the Node.js version from .nvmrc
 */
function readNvmrcVersion(): string {
  const nvmrcPath = path.join(PROJECT_ROOT, ".nvmrc");
  const content = fs.readFileSync(nvmrcPath, "utf-8").trim();

  if (!/^\d+\.\d+\.\d+$/.test(content)) {
    throw new Error(
      `Invalid version format in .nvmrc: "${content}". Expected semver (e.g., 22.23.3)`
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

  if (filePath.endsWith(".nvmrc")) {
    content = `${version}\n`;
    totalChanges = Number(content !== originalContent);
  }

  const patterns = filePath.endsWith(".nvmrc")
    ? []
    : filePath.endsWith(".json")
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

  filesToUpdate().forEach(file => {
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
      "\nRemember to commit these changes and refresh the repository lockfile if needed."
    );
  }
}

main();

/**
 * Cross-agent skill/command frontmatter contract.
 *
 * Every coding agent Lisa distributes to must be able to load every skill and
 * command. The strictest loader in the fleet (GitHub Copilot CLI) enforces:
 *   - SKILL.md files must begin with a parseable YAML frontmatter block
 *   - `description` must be at most 1024 characters (Claude documents the
 *     same cap for skill descriptions)
 * A YAML value containing an unquoted `: ` (colon + space) breaks strict
 * parsers with "mapping values are not allowed in this context" even though
 * lenient loaders accept it, so parseability is asserted with a real YAML
 * parser rather than a regex.
 *
 * Scans the source trees (`plugins/src`, root `.claude`, `.agents`) and the
 * generated plugin artifacts (`plugins/lisa*`) so both hand-edited sources and
 * generator output are covered.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");

const MAX_DESCRIPTION_LENGTH = 1024;

const SCAN_ROOTS = [".agents", ".claude", "plugins"] as const;

const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules", "worktrees"]);

/** A skill or command markdown file discovered during the repository scan. */
interface ScannedFile {
  readonly isSkill: boolean;
  readonly relativePath: string;
}

/**
 * Recursively collects SKILL.md and command markdown files under a directory.
 * @param directory Absolute path of the directory to walk.
 * @param collected Accumulator the discovered files are pushed onto.
 */
function collectMarkdownFiles(
  directory: string,
  collected: ScannedFile[]
): void {
  const entries = readdirSync(directory);
  for (const entry of entries) {
    if (SKIPPED_DIRECTORY_NAMES.has(entry)) {
      continue;
    }
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      collectMarkdownFiles(absolutePath, collected);
      continue;
    }
    const isSkill = entry === "SKILL.md";
    const isCommand =
      absolutePath.includes("/commands/") && entry.endsWith(".md");
    if (isSkill || isCommand) {
      collected.push({
        isSkill,
        relativePath: absolutePath.slice(REPO_ROOT.length + 1),
      });
    }
  }
}

/**
 * Scans every configured root for skill and command markdown files.
 * @returns The discovered files, with repo-relative paths.
 */
function scanRepository(): readonly ScannedFile[] {
  const collected: ScannedFile[] = [];
  for (const root of SCAN_ROOTS) {
    collectMarkdownFiles(join(REPO_ROOT, root), collected);
  }
  return collected;
}

/** A single contract violation found in a scanned file. */
interface Violation {
  readonly detail: string;
  readonly relativePath: string;
}

/**
 * Extracts the leading YAML frontmatter block with a strict parser.
 * @param text Full markdown file contents.
 * @returns The parsed frontmatter mapping, a parse error, or neither when the
 * file has no frontmatter block at all.
 */
function parseFrontmatter(text: string): {
  readonly error?: string;
  readonly frontmatter?: Record<string, unknown>;
} {
  if (!text.startsWith("---\n")) {
    return {};
  }
  const closingIndex = text.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { error: "unterminated frontmatter block" };
  }
  try {
    const parsed = loadYaml(text.slice(4, closingIndex + 1));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { error: "frontmatter is not a YAML mapping" };
    }
    return { frontmatter: parsed as Record<string, unknown> };
  } catch (parseError) {
    const message =
      parseError instanceof Error
        ? parseError.message.split("\n")[0]
        : String(parseError);
    return { error: `frontmatter is not strict YAML: ${message}` };
  }
}

/**
 * Applies the loader contract to each file and reports every violation.
 * @param files Scanned skill and command files to validate.
 * @returns One entry per violated rule, empty when everything loads.
 */
function findViolations(files: readonly ScannedFile[]): readonly Violation[] {
  return files.flatMap(file => {
    const text = readFileSync(join(REPO_ROOT, file.relativePath), "utf8");
    const { error, frontmatter } = parseFrontmatter(text);
    if (error !== undefined) {
      return [{ detail: error, relativePath: file.relativePath }];
    }
    if (frontmatter === undefined) {
      return file.isSkill
        ? [
            {
              detail: "missing YAML frontmatter",
              relativePath: file.relativePath,
            },
          ]
        : [];
    }
    const violations: Violation[] = [];
    const description = frontmatter["description"];
    if (file.isSkill && typeof description !== "string") {
      violations.push({
        detail: "frontmatter is missing a string `description`",
        relativePath: file.relativePath,
      });
    }
    if (
      typeof description === "string" &&
      description.length > MAX_DESCRIPTION_LENGTH
    ) {
      violations.push({
        detail: `description is ${String(description.length)} characters (max ${String(MAX_DESCRIPTION_LENGTH)})`,
        relativePath: file.relativePath,
      });
    }
    return violations;
  });
}

describe("skill and command frontmatter contract", () => {
  const files = scanRepository();

  it("finds skill and command files to validate", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("every skill and command loads under the strictest agent loader", () => {
    const violations = findViolations(files);
    const report = violations
      .map(violation => `${violation.relativePath}: ${violation.detail}`)
      .join("\n");

    expect(report).toBe("");
  });
});

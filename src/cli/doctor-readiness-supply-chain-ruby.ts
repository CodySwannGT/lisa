/**
 * Ruby/Bundler scanning for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 * @module cli/doctor-readiness-supply-chain-ruby
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { readFileOrNull } from "./doctor-readiness-shared.js";

/** Dependabot ecosystem spelling for Ruby/Bundler dependency updates. */
const RUBY_ECOSYSTEM_PATTERN = /package-ecosystem:\s*["']?bundler\b/i;

/** Commands and scanners that audit Ruby/Bundler dependencies. */
const RUBY_AUDIT_GATE_PATTERN =
  /\b(bundle\s+audit|bundler-audit|ruby-advisory-db)\b/i;

/** Renovate manager spelling for Ruby/Bundler dependencies. */
const RENOVATE_BUNDLER_PATTERN = /\bbundler\b/i;

/** Gemfile directive that delegates dependency declarations into a gemspec. */
const GEMSPEC_DIRECTIVE_PATTERN = /^\s*gemspec\b/u;

/** Files that may declare an audit gate in their text. */
const GATE_DIRECTORIES: readonly string[] = [
  path.join(".github", "workflows"),
  ".husky",
];

/** Single-file gate declarations checked by text match. */
const GATE_FILES: readonly string[] = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
];

/** Update bots whose mere presence is a standing confidence model. */
const UPDATE_BOT_FILES: readonly string[] = [
  path.join(".github", "dependabot.yml"),
  path.join(".github", "dependabot.yaml"),
  path.join(".github", "renovate.json"),
  "renovate.json",
  ".renovaterc",
  ".renovaterc.json",
];

/** One Ruby gem declaration flattened from a Gemfile. */
export interface RubyDependencySpec {
  readonly manifestPath: "Gemfile";
  readonly name: string;
  readonly spec: string | null;
}

/** What reading a Ruby/Bundler manifest established. */
export type RubyManifestOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "unassessable"; readonly reason: string }
  | {
      readonly kind: "ok";
      readonly manifestPath: "Gemfile";
      readonly specs: readonly RubyDependencySpec[];
    };

/**
 * Whether a repository-relative path exists.
 * @param root - Repository root
 * @param relativePath - Repo-relative path
 * @returns True when the file could be read
 */
async function fileExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  return (await readFileOrNull(root, relativePath)) !== null;
}

/**
 * List files directly inside a repository-relative directory.
 * @param root - Repository root
 * @param relativeDir - Repo-relative directory
 * @returns Repo-relative file paths
 */
async function listDirectory(
  root: string,
  relativeDir: string
): Promise<readonly string[]> {
  try {
    const entries = await readdir(path.join(root, relativeDir), {
      withFileTypes: true,
    });
    return entries
      .filter(entry => entry.isFile())
      .map(entry => path.join(relativeDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Remove one layer of YAML quoting from a command scalar.
 * @param value - Potentially quoted YAML scalar text
 * @returns The command text without balanced outer quotes
 */
function unquoteCommand(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? trimmed.slice(1, -1)
    : trimmed;
}

/**
 * Strip a leading YAML list marker from a possibly indented step line.
 * @param trimmed - A source line after outer whitespace was removed
 * @returns The line without a leading `- ` marker
 */
function stripYamlListMarker(trimmed: string): string {
  return trimmed.startsWith("- ") ? trimmed.slice(2).trimStart() : trimmed;
}

/**
 * Extract a command-shaped line from CI/hook text.
 * @param line - One source line
 * @returns The executable command candidate, or null
 */
function executableCommandCandidate(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return null;
  }
  const commandish = stripYamlListMarker(trimmed);
  if (commandish.toLowerCase().startsWith("run:")) {
    const command = unquoteCommand(commandish.slice("run:".length));
    return command === "|" || command === ">" ? null : command;
  }
  return commandish;
}

/**
 * Whether CI/hook text contains a real Ruby dependency audit command.
 * @param source - File text
 * @returns True when an executable command audits Bundler dependencies
 */
function hasRubyAuditCommand(source: string): boolean {
  return source.split(/\r?\n/).some(line => {
    const command = executableCommandCandidate(line);
    return command !== null && RUBY_AUDIT_GATE_PATTERN.test(command);
  });
}

/**
 * Read the Ruby/Bundler dependency manifest when no JavaScript manifest exists.
 * @param root - Repository root
 * @returns Parsed Gemfile specs, or absent when this is not a Bundler project
 */
export async function readRubyManifest(
  root: string
): Promise<RubyManifestOutcome> {
  const source = await readFileOrNull(root, "Gemfile");
  if (source === null) {
    return { kind: "absent" };
  }
  const hasGemspecDirective = source
    .split(/\r?\n/)
    .some(line => GEMSPEC_DIRECTIVE_PATTERN.test(line.trim()));
  const specs = source.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return [];
    }
    const match =
      /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/u.exec(line);
    if (match === null || match[1] === undefined) {
      return [];
    }
    return [
      {
        manifestPath: "Gemfile" as const,
        name: match[1],
        spec: match[2] ?? null,
      },
    ];
  });
  if (hasGemspecDirective) {
    return {
      kind: "unassessable",
      reason:
        "`Gemfile` delegates dependency declarations through `gemspec`; " +
        "Ruby supply-chain confidence is not established because this " +
        "offline pass does not parse gemspec dependency declarations yet",
    };
  }
  return { kind: "ok", manifestPath: "Gemfile", specs };
}

/**
 * Find the committed Ruby/Bundler lockfile.
 * @param root - Repository root
 * @returns The lockfile path, or null when none is committed
 */
export async function findRubyLockfile(root: string): Promise<string | null> {
  return (await fileExists(root, "Gemfile.lock")) ? "Gemfile.lock" : null;
}

/**
 * Whether an update-bot config watches Ruby/Bundler dependencies.
 * @param botFile - Repo-relative bot config path
 * @param source - The config's text
 * @returns True when the bot covers Bundler dependencies
 */
function coversRubyTree(botFile: string, source: string): boolean {
  return botFile.includes("dependabot")
    ? RUBY_ECOSYSTEM_PATTERN.test(source)
    : RENOVATE_BUNDLER_PATTERN.test(source);
}

/**
 * Find where the repository audits its Ruby/Bundler dependency tree.
 * @param root - Repository root
 * @returns The repo-relative path of the first Ruby audit gate found, or null
 */
export async function findRubyAuditGate(root: string): Promise<string | null> {
  for (const botFile of UPDATE_BOT_FILES) {
    const source = await readFileOrNull(root, botFile);
    if (source !== null && coversRubyTree(botFile, source)) {
      return botFile.split(path.sep).join("/");
    }
  }
  const scanned = [
    ...(
      await Promise.all(GATE_DIRECTORIES.map(dir => listDirectory(root, dir)))
    ).flat(),
    ...GATE_FILES,
  ];
  for (const file of scanned) {
    const source = await readFileOrNull(root, file);
    if (source !== null && hasRubyAuditCommand(source)) {
      return file.split(path.sep).join("/");
    }
  }
  return null;
}

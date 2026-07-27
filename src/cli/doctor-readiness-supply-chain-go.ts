/**
 * Go module scanning for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 * @module cli/doctor-readiness-supply-chain-go
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { readFileOrNull } from "./doctor-readiness-shared.js";

/** Dependabot ecosystem spelling for Go module dependency updates. */
const GO_ECOSYSTEM_PATTERN = /package-ecosystem:\s*["']?gomod\b/i;

/** Commands and scanners that audit Go module dependencies. */
const GO_AUDIT_GATE_PATTERN = /\b(govulncheck|osv-scanner|snyk|trivy|grype)\b/i;

/** Renovate manager spelling for Go module dependencies. */
const RENOVATE_GO_PATTERN = /\b(gomod|golang|go_modules?)\b/i;

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

/** Go module specs that do not pin a version or pseudo-version. */
const FLOATING_SPECS: ReadonlySet<string> = new Set([
  "",
  "latest",
  "main",
  "master",
  "HEAD",
]);

/** One Go module requirement flattened from `go.mod`. */
export interface GoDependencySpec {
  readonly manifestPath: "go.mod";
  readonly name: string;
  readonly spec: string | null;
}

/** What reading a Go module manifest established. */
export type GoManifestOutcome =
  | { readonly kind: "absent" }
  | {
      readonly kind: "ok";
      readonly manifestPath: "go.mod";
      readonly specs: readonly GoDependencySpec[];
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
 * Remove a trailing line comment from go.mod syntax.
 * @param line - Raw go.mod line
 * @returns The uncommented prefix
 */
function stripGoComment(line: string): string {
  const commentStart = line.indexOf("//");
  return (commentStart === -1 ? line : line.slice(0, commentStart)).trim();
}

/**
 * Parse one module/version pair from a `require` line.
 * @param line - Raw line without the leading `require` keyword
 * @returns A dependency spec, or null for unparsable lines
 */
function parseRequireSpec(line: string): GoDependencySpec | null {
  const parts = stripGoComment(line).split(/\s+/u).filter(Boolean);
  const [name, spec] = parts;
  if (name === undefined) {
    return null;
  }
  return {
    manifestPath: "go.mod",
    name,
    spec: spec ?? null,
  };
}

/** Parser state while walking go.mod lines. */
interface GoRequireParseState {
  readonly inRequireBlock: boolean;
  readonly specs: readonly GoDependencySpec[];
}

/**
 * Whether a trimmed go.mod line starts a require block.
 * @param line - Trimmed go.mod line
 * @returns True when the line is `require (`
 */
function startsRequireBlock(line: string): boolean {
  return line === "require (" || line === "require(";
}

/**
 * Append a parsed requirement if the line contains one.
 * @param specs - Existing specs
 * @param line - Raw requirement text
 * @returns Specs with the parsed requirement appended when present
 */
function appendRequireSpec(
  specs: readonly GoDependencySpec[],
  line: string
): readonly GoDependencySpec[] {
  const spec = parseRequireSpec(line);
  return spec === null ? specs : [...specs, spec];
}

/**
 * Parse one go.mod line while tracking whether we are inside a require block.
 * @param state - Current parser state
 * @param rawLine - Raw go.mod line
 * @returns Updated parser state
 */
function collectGoSpecLine(
  state: GoRequireParseState,
  rawLine: string
): GoRequireParseState {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("//")) {
    return state;
  }
  if (state.inRequireBlock) {
    return line === ")"
      ? { inRequireBlock: false, specs: state.specs }
      : {
          inRequireBlock: true,
          specs: appendRequireSpec(state.specs, line),
        };
  }
  if (startsRequireBlock(line)) {
    return { inRequireBlock: true, specs: state.specs };
  }
  if (line.startsWith("require ")) {
    return {
      inRequireBlock: false,
      specs: appendRequireSpec(state.specs, line.slice("require ".length)),
    };
  }
  return state;
}

/**
 * Flatten Go module requirements from go.mod.
 * @param source - go.mod source
 * @returns Parsed module requirements
 */
function collectGoSpecs(source: string): readonly GoDependencySpec[] {
  return source
    .split(/\r?\n/u)
    .reduce<GoRequireParseState>(
      (state, line) => collectGoSpecLine(state, line),
      { inRequireBlock: false, specs: [] }
    ).specs;
}

/**
 * Read the Go module dependency manifest when no JavaScript manifest exists.
 * @param root - Repository root
 * @returns Parsed Go module specs, or absent when this is not a Go module
 */
export async function readGoManifest(root: string): Promise<GoManifestOutcome> {
  const source = await readFileOrNull(root, "go.mod");
  if (source === null) {
    return { kind: "absent" };
  }
  return { kind: "ok", manifestPath: "go.mod", specs: collectGoSpecs(source) };
}

/**
 * Find the committed Go module checksum file.
 * @param root - Repository root
 * @returns The checksum file path, or null when none is committed
 */
export async function findGoLockfile(root: string): Promise<string | null> {
  return (await fileExists(root, "go.sum")) ? "go.sum" : null;
}

/**
 * Whether an update-bot config watches Go module dependencies.
 * @param botFile - Repo-relative bot config path
 * @param source - The config's text
 * @returns True when the bot covers Go modules
 */
function coversGoTree(botFile: string, source: string): boolean {
  return botFile.includes("dependabot")
    ? GO_ECOSYSTEM_PATTERN.test(source)
    : RENOVATE_GO_PATTERN.test(source);
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
  const commandish = trimmed.startsWith("- ")
    ? trimmed.slice(2).trimStart()
    : trimmed;
  if (commandish.toLowerCase().startsWith("run:")) {
    const command = commandish.slice("run:".length).trim();
    return command === "|" || command === ">" ? null : command;
  }
  return commandish;
}

/**
 * Whether CI/hook text contains a real Go dependency audit command.
 * @param source - File text
 * @returns True when an executable command audits Go module dependencies
 */
function hasGoAuditCommand(source: string): boolean {
  return source.split(/\r?\n/u).some(line => {
    const command = executableCommandCandidate(line);
    return command !== null && GO_AUDIT_GATE_PATTERN.test(command);
  });
}

/**
 * Find where the repository audits its Go module dependency tree.
 * @param root - Repository root
 * @returns The repo-relative path of the first Go audit gate found, or null
 */
export async function findGoAuditGate(root: string): Promise<string | null> {
  for (const botFile of UPDATE_BOT_FILES) {
    const source = await readFileOrNull(root, botFile);
    if (source !== null && coversGoTree(botFile, source)) {
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
    if (source !== null && hasGoAuditCommand(source)) {
      return file.split(path.sep).join("/");
    }
  }
  return null;
}

/**
 * Check whether a Go module requirement spec floats.
 * @param spec - Version/pseudo-version from go.mod
 * @returns True when the spec is absent or branch-like rather than pinned
 */
export function isFloatingGoSpec(spec: string | null): boolean {
  return spec === null || FLOATING_SPECS.has(spec.trim());
}

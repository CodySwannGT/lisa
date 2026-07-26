/**
 * Python/Poetry scanning for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 * @module cli/doctor-readiness-supply-chain-python
 */
/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- typed scanner helpers are self-describing */
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { isRecord, readFileOrNull } from "./doctor-readiness-shared.js";

/** The Poetry project manifest this scanner reads. */
const PYPROJECT_TOML = "pyproject.toml";

/** The Poetry lockfile this scanner requires. */
const POETRY_LOCK = "poetry.lock";

/** Dependabot ecosystem spelling for Python dependency updates. */
const PYTHON_ECOSYSTEM_PATTERN = /package-ecosystem:\s*["']?pip\b/i;

/** Commands and scanners that audit Python dependencies. */
const PYTHON_AUDIT_GATE_PATTERN =
  /\b(pip-audit|safety\s+check|osv-scanner|snyk|trivy|grype)\b/i;

/** Renovate manager spellings for Python dependencies. */
const RENOVATE_PYTHON_PATTERN =
  /\b(poetry|pep621|pip_requirements|pip-compile|pipenv)\b/i;

/** Poetry spec strings that resolve to whatever is newest. */
const FLOATING_SPECS: ReadonlySet<string> = new Set(["", "*", "latest"]);

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

/** One Poetry dependency declaration flattened from `pyproject.toml`. */
export interface PythonDependencySpec {
  readonly manifestPath: "pyproject.toml";
  readonly name: string;
  readonly spec: string | null;
}

/** What reading a Python/Poetry manifest established. */
export type PythonManifestOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "unassessable"; readonly reason: string }
  | {
      readonly kind: "ok";
      readonly manifestPath: "pyproject.toml";
      readonly specs: readonly PythonDependencySpec[];
    };

/** Check whether a repo-relative file can be read. */
async function fileExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  return (await readFileOrNull(root, relativePath)) !== null;
}

/** List direct files under a repo-relative directory. */
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

/** Read a nested record by path. */
function nestedRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (keys.length === 0) {
    return isRecord(value) ? value : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const [key, ...rest] = keys;
  return key === undefined ? null : nestedRecord(value[key], rest);
}

/** Extract the version-bearing part of a Poetry dependency declaration. */
function poetrySpec(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.version === "string") {
    return value.version;
  }
  if (
    typeof value.path === "string" ||
    typeof value.file === "string" ||
    typeof value.url === "string"
  ) {
    return "local";
  }
  if (typeof value.git === "string") {
    return typeof value.rev === "string" || typeof value.tag === "string"
      ? "git-ref"
      : null;
  }
  return null;
}

/** Flatten one Poetry dependency table, excluding the Python runtime. */
function collectPoetrySpecs(
  table: Record<string, unknown> | null
): readonly PythonDependencySpec[] {
  if (table === null) {
    return [];
  }
  return Object.entries(table).flatMap(([name, value]) =>
    name.toLowerCase() === "python"
      ? []
      : [{ manifestPath: "pyproject.toml", name, spec: poetrySpec(value) }]
  );
}

/**
 * Read the Poetry dependency manifest when no JavaScript manifest exists.
 * @param root - Repository root
 * @returns Parsed Poetry specs, or absent when this is not a Poetry project
 */
export async function readPythonManifest(
  root: string
): Promise<PythonManifestOutcome> {
  const source = await readFileOrNull(root, PYPROJECT_TOML);
  if (source === null) {
    return { kind: "absent" };
  }
  try {
    const parsed = parseToml(source);
    const dependencies = nestedRecord(parsed, [
      "tool",
      "poetry",
      "dependencies",
    ]);
    const group = nestedRecord(parsed, ["tool", "poetry", "group"]);
    if (dependencies === null && group === null) {
      return {
        kind: "unassessable",
        reason:
          "`pyproject.toml` was found, but no Poetry dependency tables were " +
          "found; Python supply-chain confidence is not established because " +
          "this offline pass only assesses Poetry projects today",
      };
    }
    const groupSpecs =
      group === null
        ? []
        : Object.values(group).flatMap(entry =>
            collectPoetrySpecs(nestedRecord(entry, ["dependencies"]))
          );
    return {
      kind: "ok",
      manifestPath: PYPROJECT_TOML,
      specs: [...collectPoetrySpecs(dependencies), ...groupSpecs],
    };
  } catch (error) {
    return {
      kind: "unassessable",
      reason:
        "`pyproject.toml` could not be parsed, so Python dependency specs " +
        `were never read and nothing about them is established: ${
          error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

/**
 * Find the committed Python/Poetry lockfile.
 * @param root - Repository root
 * @returns The lockfile path, or null when none is committed
 */
export async function findPythonLockfile(root: string): Promise<string | null> {
  return (await fileExists(root, POETRY_LOCK)) ? POETRY_LOCK : null;
}

/** Check whether an update-bot config watches Python dependencies. */
function coversPythonTree(botFile: string, source: string): boolean {
  return botFile.includes("dependabot")
    ? PYTHON_ECOSYSTEM_PATTERN.test(source)
    : RENOVATE_PYTHON_PATTERN.test(source);
}

/** Extract an executable command-shaped line from CI/hook text. */
function executableCommandCandidate(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return null;
  }
  const commandish = trimmed.startsWith("- ")
    ? trimmed.slice(2).trim()
    : trimmed;
  if (!commandish.toLowerCase().startsWith("run:")) {
    return commandish;
  }
  const command = commandish.slice("run:".length).trim();
  return command === "|" || command === ">" ? null : command;
}

/**
 * Find where the repository audits its Python dependency tree.
 * @param root - Repository root
 * @returns The repo-relative path of the first Python audit gate found, or null
 */
export async function findPythonAuditGate(
  root: string
): Promise<string | null> {
  for (const botFile of UPDATE_BOT_FILES) {
    const source = await readFileOrNull(root, botFile);
    if (source !== null && coversPythonTree(botFile, source)) {
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
    if (
      source !== null &&
      source.split(/\r?\n/).some(line => {
        const command = executableCommandCandidate(line);
        return command !== null && PYTHON_AUDIT_GATE_PATTERN.test(command);
      })
    ) {
      return file.split(path.sep).join("/");
    }
  }
  return null;
}

/** Check whether a Poetry dependency spec floats. */
export function isFloatingPythonSpec(spec: string | null): boolean {
  return spec === null || FLOATING_SPECS.has(spec.trim().toLowerCase());
}

/* eslint-enable jsdoc/require-param, jsdoc/require-returns -- restore repository documentation defaults */

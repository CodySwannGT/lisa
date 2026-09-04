/**
 * Shell extraction and execution harness for the shipped classifier ladder.
 * @module tests/helpers/rollup-classifier-ladder-harness
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { ClassifierTree } from "./rollup-classifier-ladder-fixtures.js";

/** Name of the shell function owned by the canonical tracker-sync skill. */
export const LADDER_FUNCTION = "run_rollup_classifier";

/** Canonical authored tracker-sync skill. */
export const SOURCE_TRACKER_SYNC =
  "plugins/src/base/skills/lisa-tracker-sync/SKILL.md";

/** Authored GitHub rollup skill containing the real classifier call site. */
export const SOURCE_GITHUB_SYNC =
  "plugins/src/base/skills/lisa-github-sync/SKILL.md";

/** Every authored or generated tracker-sync skill surface. */
export const TRACKER_SYNC_SURFACES = Object.freeze([
  SOURCE_TRACKER_SYNC,
  "plugins/lisa/skills/lisa-tracker-sync/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-tracker-sync/SKILL.md",
  "plugins/lisa-agy/skills/lisa-tracker-sync/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-tracker-sync/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-tracker-sync/SKILL.md",
]);

/** Every authored or generated GitHub rollup caller surface. */
export const GITHUB_SYNC_SURFACES = Object.freeze([
  SOURCE_GITHUB_SYNC,
  "plugins/lisa/skills/lisa-github-sync/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-github-sync/SKILL.md",
  "plugins/lisa-agy/skills/lisa-github-sync/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-github-sync/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-github-sync/SKILL.md",
]);

/** Exact live-call guard binding graph input before every write transport. */
export const GITHUB_CLASSIFIER_GUARD = [
  'if ! CLASSIFIER_REPORT="$(run_rollup_classifier "<graph.json>")"; then',
  '  echo "Rollup classifier failed before any lifecycle ' +
    'or comment write." >&2',
  "  exit 1",
  "fi",
].join("\n");

/** Exact pre-fix expression that reintroduces checkout-relative execution. */
export const LEGACY_CLASSIFIER_EXPRESSION =
  "${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-plugins/lisa}}/scripts/" +
  "rollup-blocker-classification.mjs";

/** Trusted plugin-root environment values, in precedence order. */
export interface TrustedRootEnvironment {
  /** Claude/plugin cache root, when supplied by the runtime. */
  readonly CLAUDE_PLUGIN_ROOT?: string;
  /** Runtime-neutral plugin root, when supplied by the runtime. */
  readonly PLUGIN_ROOT?: string;
  /** Deliberately unrecognized root used by negative controls. */
  readonly UNTRUSTED_PLUGIN_ROOT?: string;
}

/** Observable result of one exact shipped-function execution. */
export interface ClassifierLadderRun {
  /** Child-process exit status. */
  readonly status: number | null;
  /** Signal when the bounded child did not exit normally. */
  readonly signal: NodeJS.Signals | null;
  /** Standard error emitted by the ladder. */
  readonly stderr: string;
  /** Standard output emitted by the chosen classifier. */
  readonly stdout: string;
}

/**
 * Read one repository-relative UTF-8 file.
 * @param relative - Repository-relative path to read.
 * @returns Complete UTF-8 file contents.
 */
export const readRepositoryFile = (relative: string): string =>
  readFileSync(path.resolve(relative), "utf8");

/**
 * Lift one top-level shell function from a Markdown code block.
 *
 * @param source - Complete Markdown source.
 * @param name - Exact shell function name.
 * @returns Function header through its column-zero closing brace.
 */
export const extractShellFunction = (source: string, name: string): string => {
  const header = new RegExp(`(?:^|\\n)${name}\\(\\) \\{\\n`, "u");
  const match = header.exec(source);
  if (match === null) throw new Error(`${name}() not found in tracker-sync`);
  const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
  const lines = source.slice(start).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line === "}");
  if (end < 0) throw new Error(`${name}() is not column-zero terminated`);
  return lines.slice(0, end + 1).join("\n");
};

/**
 * Execute the exact function currently shipped in the authored skill.
 *
 * @param tree - Disposable roots, graph, and recorders.
 * @param roots - Runtime-provided trusted-root variables.
 * @param cwd - Caller directory used for cwd-independence assertions.
 * @returns Bounded child status and output streams.
 */
export const runClassifierLadder = (
  tree: ClassifierTree,
  roots: TrustedRootEnvironment,
  cwd = tree.cwdA
): ClassifierLadderRun => {
  const block = extractShellFunction(
    readRepositoryFile(SOURCE_TRACKER_SYNC),
    LADDER_FUNCTION
  );
  const command = [
    "set -uo pipefail",
    block,
    `${LADDER_FUNCTION} "$GRAPH_PATH"`,
  ].join("\n");
  const child = spawnSync("/bin/bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: {
      ...roots,
      GRAPH_PATH: tree.graph,
      HOME: tree.root,
      LANG: "C",
      LC_ALL: "C",
      LISA_SECRET_SENTINEL: "secret-env-value",
      PATH: [tree.stubBin, "/usr/bin", "/bin"].join(path.delimiter),
      WRITE_LOG: tree.writeLog,
    },
    maxBuffer: 64 * 1024,
    timeout: 5000,
  });
  return {
    status: child.status,
    signal: child.signal,
    stderr: child.stderr,
    stdout: child.stdout,
  };
};

/**
 * Recursively enumerate repository-relative files below one root.
 * @param root - Repository-relative directory to traverse.
 * @returns Sorted regular-file paths below the directory.
 */
export const filesBelow = (root: string): readonly string[] =>
  readdirSync(root, { withFileTypes: true })
    .flatMap(entry => {
      const child = path.join(root, entry.name);
      if (entry.isDirectory()) return filesBelow(child);
      return entry.isFile() ? [child] : [];
    })
    .slice()
    .sort((left, right) => left.localeCompare(right));

/**
 * Count exact non-overlapping occurrences.
 * @param body - Complete body to search.
 * @param fragment - Exact nonempty fragment to count.
 * @returns Number of non-overlapping occurrences.
 */
export const occurrences = (body: string, fragment: string): number =>
  body.split(fragment).length - 1;

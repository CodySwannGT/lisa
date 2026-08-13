/**
 * Detection for a SECOND project-learnings ledger outside the configured path.
 *
 * Lisa 2.232.0 scaffolded the machine ledger into `.claude/rules/`. When the
 * ledger later moved to the cold `.lisa/` path, host projects that already had
 * both files kept writing captures into whichever one their tooling resolved —
 * and at one fleet project 19 captured learnings were destroyed by a merge that
 * resolved the rules-tree copy to empty. Nothing reported it, because nothing
 * looked for a ledger anywhere but the configured path.
 *
 * This module is that missing look: a bounded, read-only scan of the places a
 * ledger can plausibly be stranded — every auto-loaded rules tree, the legacy
 * project-rules sibling, the repo root, and the `.lisa/` default — reporting
 * each stray with the number of entries stranded in it so an operator can see
 * what is at risk before deleting anything.
 * @module core/learnings-stray-ledger
 */
import { type Dirent } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import {
  AUTO_LOADED_RULES_DIR_PREFIXES,
  PROJECT_LEARNINGS_FILENAME,
  readProjectConfig,
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
  type ProjectConfig,
} from "./project-config.js";
import { resolveLearningsOverflowFile } from "./learnings-overflow.js";

/** Ledger-shaped filenames the scan recognizes. */
const LEDGER_FILENAMES = new Set([
  PROJECT_LEARNINGS_FILENAME,
  resolveLearningsOverflowFile(PROJECT_LEARNINGS_FILENAME),
]);

/**
 * How deep to walk inside a rules tree. Rules directories are shallow by
 * convention; a bounded walk keeps doctor's cost fixed and cannot wander into
 * a large vendored tree that happens to sit under a rules directory.
 */
const MAX_TREE_DEPTH = 3;

/** Largest file the scan will read to count entries. */
const MAX_COUNTABLE_BYTES = 1_000_000;

/** One learnings ledger found somewhere other than the configured path. */
export interface StrayLearningsLedger {
  /** Project-relative posix path to the stray file. */
  readonly path: string;
  /**
   * Entries currently stranded in the stray, or undefined when the file is not
   * in the contract's format (so a count cannot be claimed honestly).
   */
  readonly entryCount: number | undefined;
}

/** Result of scanning one project for stray ledgers. */
export interface StrayLearningsScan {
  /** The configured (canonical) ledger path — never reported as a stray. */
  readonly canonicalFile: string;
  /** Every stray found, sorted by path for deterministic reporting. */
  readonly strays: readonly StrayLearningsLedger[];
}

/**
 * Scan a project for learnings ledgers outside its configured path.
 * @param projectRoot - Absolute path to the host project root
 * @returns The canonical path plus every stray ledger found
 */
export async function findStrayLearningsLedgers(
  projectRoot: string
): Promise<StrayLearningsScan> {
  const config = await readProjectConfig(projectRoot);
  const canonicalFile = toPosix(resolveProjectLearningsFile(config));
  const canonical = new Set([
    canonicalFile,
    toPosix(resolveLearningsOverflowFile(canonicalFile)),
  ]);
  const found = await Promise.all([
    ...AUTO_LOADED_RULES_DIR_PREFIXES.map(prefix =>
      collectLedgersInTree(projectRoot, prefix, MAX_TREE_DEPTH)
    ),
    ...flatDirectories(config).map(directory =>
      collectLedgersInTree(projectRoot, directory, 1)
    ),
  ]);
  const candidates = [...new Set(found.flat())]
    .filter(relative => !canonical.has(relative))
    .sort((left, right) => left.localeCompare(right));
  const strays = await Promise.all(
    candidates.map(async relative => ({
      path: relative,
      entryCount: await countLedgerEntries(path.join(projectRoot, relative)),
    }))
  );
  return { canonicalFile, strays };
}

/**
 * Non-recursive directories a ledger can be stranded in besides a rules tree:
 * the legacy project-rules sibling, the repository root, and the `.lisa/`
 * default (a stray when the project configured a different `learnings.file`).
 * @param config - Parsed project configuration
 * @returns Project-relative directories to scan one level deep
 */
function flatDirectories(config: ProjectConfig): readonly string[] {
  const legacyDirectory = path.posix.dirname(
    toPosix(resolveLegacyProjectLearningsFile(config))
  );
  return [...new Set([legacyDirectory, ".", ".lisa"])];
}

/**
 * Collect ledger-shaped files inside one directory, bounded by depth.
 *
 * Symlinked directories are not followed: a link is a way out of the project
 * and re-entering it under another name would double-report the same file.
 * @param projectRoot - Absolute project root
 * @param relativeDirectory - Project-relative directory to scan
 * @param depth - Remaining directory levels to descend
 * @returns Project-relative posix paths of ledger-shaped files
 */
async function collectLedgersInTree(
  projectRoot: string,
  relativeDirectory: string,
  depth: number
): Promise<readonly string[]> {
  const absolute = path.join(projectRoot, relativeDirectory);
  const entries = await readDirectoryEntries(absolute);
  const nested = await Promise.all(
    entries.map(async entry => {
      const childRelative = path.posix.join(
        toPosix(relativeDirectory),
        entry.name
      );
      if (entry.isFile() && LEDGER_FILENAMES.has(entry.name)) {
        return [normalizeRelative(childRelative)];
      }
      if (entry.isDirectory() && depth > 1) {
        return collectLedgersInTree(projectRoot, childRelative, depth - 1);
      }
      return [];
    })
  );
  return nested.flat();
}

/**
 * Read one directory, treating an absent or unreadable directory as empty.
 * @param absolute - Absolute directory path
 * @returns Directory entries, or none when the directory cannot be read
 */
async function readDirectoryEntries(
  absolute: string
): Promise<readonly Dirent[]> {
  try {
    if (!(await lstat(absolute)).isDirectory()) {
      return [];
    }
    return await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Count the entries stranded in a stray ledger.
 *
 * Deliberately tolerant: a stray is reported whether or not it parses, so this
 * counts JSONL rows inside the fenced block without revalidating them against
 * the current contract. An older or hand-edited ledger still has recoverable
 * content, and refusing to count it would hide exactly the file most at risk.
 * @param absolute - Absolute path to the stray ledger
 * @returns Row count, or undefined when the file is not in ledger format
 */
async function countLedgerEntries(
  absolute: string
): Promise<number | undefined> {
  try {
    if ((await stat(absolute)).size > MAX_COUNTABLE_BYTES) {
      return undefined;
    }
    const content = await readFile(absolute, "utf8");
    const payload = /```jsonl\n([\s\S]*?)```/u.exec(content)?.[1];
    if (payload === undefined) {
      return undefined;
    }
    return payload
      .split("\n")
      .filter(line => line.trim() !== "")
      .filter(line => isJsonObject(line)).length;
  } catch {
    return undefined;
  }
}

/**
 * Report whether one JSONL row is a JSON object.
 * @param line - Candidate row
 * @returns True when the row parses to a non-array object
 */
function isJsonObject(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

/**
 * Normalize a project-relative path to a stable posix form.
 * @param relative - Project-relative path in any form
 * @returns Normalized posix path without a leading `./`
 */
function normalizeRelative(relative: string): string {
  const normalized = path.posix.normalize(toPosix(relative));
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

/**
 * Convert platform separators to posix ones.
 * @param value - Path in platform form
 * @returns Path in posix form
 */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

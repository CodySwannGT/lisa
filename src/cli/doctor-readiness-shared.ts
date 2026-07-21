/**
 * Helpers shared by every readiness producer (PRD #1739, #1896).
 *
 * Three things were being re-implemented per producer: reading a repository file
 * without letting a missing file throw, asking whether a repository path exists,
 * and wrapping a non-blocking observation as a finding. The last one is the
 * load-bearing case — an observation finding must carry NO `blocker` key,
 * because the blocker engine stands a blocker up on any finding that names an id
 * and carries evidence regardless of the finding's status. One definition means
 * that rule cannot drift apart across producers.
 * @module cli/doctor-readiness-shared
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Read a repository-relative file, returning null when it cannot be read.
 *
 * Reading is best-effort by design: a file that cannot be read establishes
 * nothing, and a readiness producer must never turn "could not look" into
 * either a violation or a clean bill of health.
 * @param root - Repository root
 * @param relativePath - Repo-relative path (forward slashes)
 * @returns File contents, or null
 */
export async function readFileOrNull(
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await readFile(path.join(root, ...relativePath.split("/")), "utf8");
  } catch {
    return null;
  }
}

/**
 * Whether a repository-relative directory exists.
 * @param root - Repository root
 * @param relativePath - Repo-relative directory path
 * @returns True when the directory could be listed
 */
export async function directoryExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  try {
    await readdir(path.join(root, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a repository-relative path exists, as a file or a directory.
 * @param root - Repository root
 * @param relativePath - Repo-relative path
 * @returns True when something is present at that path
 */
export async function pathExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  return (
    (await readFileOrNull(root, relativePath)) !== null ||
    (await directoryExists(root, relativePath))
  );
}

/**
 * Strip leading and trailing slashes from a repo-relative path fragment.
 * Written without a regex quantifier so it cannot backtrack on hostile input.
 * @param value - The path fragment
 * @returns The fragment with empty segments removed
 */
export function trimSlashes(value: string): string {
  return value
    .split("/")
    .filter(segment => segment !== "")
    .join("/");
}

/**
 * Whether a value is a plain JSON object.
 * @param value - Candidate value
 * @returns True when the value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wrap non-blocking observations as findings. They deliberately carry no
 * `blocker` key: naming one would stand a blocker up — and flip the whole
 * repository to `NOT_READY` — on an observation that was never decidable.
 * @param notes - Informational lines
 * @returns Findings, one per note
 */
export function informationalFindings(
  notes: readonly string[]
): readonly Record<string, unknown>[] {
  return notes.map(note => ({ observation: note, blocking: false }));
}

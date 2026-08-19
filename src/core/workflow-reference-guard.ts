import * as fse from "fs-extra";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Repo-relative directory GitHub Actions reads workflow definitions from.
 * Only files sitting directly in here are workflows, so the scan is flat.
 */
const WORKFLOWS_DIR = ".github/workflows";

/** Extensions GitHub Actions accepts for a workflow definition. */
const WORKFLOW_EXTENSIONS = [".yml", ".yaml"];

/** YAML key whose value names the workflow or action a job calls. */
const USES_KEY = "uses:";

/**
 * Read the raw value of a line's `uses:` key, tolerating indentation and a
 * leading list dash. Parsed with string operations rather than a regular
 * expression so the scan stays linear in the length of the line.
 * @param line - One line of workflow YAML
 * @returns Text following `uses:`, or undefined when the line is not a `uses:` line
 */
function readUsesValue(line: string): string | undefined {
  const trimmed = line.trimStart();
  const withoutDash = trimmed.startsWith("-")
    ? trimmed.slice(1).trimStart()
    : trimmed;
  return withoutDash.startsWith(USES_KEY)
    ? withoutDash.slice(USES_KEY.length).trim()
    : undefined;
}

/**
 * Strip YAML quoting and any trailing comment from a raw `uses:` value.
 * @param rawValue - Text following `uses:` on a workflow line
 * @returns The bare reference the value denotes
 */
function parseUsesValue(rawValue: string): string {
  const quote = rawValue.startsWith('"')
    ? '"'
    : rawValue.startsWith("'")
      ? "'"
      : "";
  if (quote !== "") {
    const closingIndex = rawValue.indexOf(quote, 1);
    return closingIndex === -1
      ? rawValue.slice(1)
      : rawValue.slice(1, closingIndex);
  }
  const commentIndex = rawValue.indexOf("#");
  const withoutComment =
    commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex);
  return withoutComment.trim();
}

/**
 * Drop any trailing slashes so a directory path compares equal however it was
 * written.
 * @param value - Path that may end in one or more slashes
 * @returns The same path without trailing slashes
 */
function trimTrailingSlashes(value: string): string {
  return value.endsWith("/") ? trimTrailingSlashes(value.slice(0, -1)) : value;
}

/**
 * Normalize a path for comparison: POSIX separators, no leading `./`, no
 * trailing slash. Deletion manifests and `uses:` values spell the same target
 * differently, and the guard must not miss a reference over punctuation.
 * @param value - Raw path from a deletions manifest or a `uses:` value
 * @returns Comparable POSIX-style repo-relative path
 */
function normalizeRepoPath(value: string): string {
  const posix = value.split(path.sep).join("/");
  const withoutPrefix = posix.startsWith("./") ? posix.slice(2) : posix;
  return trimTrailingSlashes(withoutPrefix);
}

/**
 * Extract every local (`./`-prefixed) `uses:` target from a workflow file's
 * text. A remote reference (`owner/repo/path@ref`) never starts with `./`, so
 * it is excluded by construction.
 * @param content - Raw YAML text of a workflow file
 * @returns Normalized repo-relative paths the workflow calls locally
 */
function extractLocalUsesTargets(content: string): readonly string[] {
  return content
    .split("\n")
    .map(readUsesValue)
    .filter((rawValue): rawValue is string => rawValue !== undefined)
    .map(parseUsesValue)
    .filter(reference => reference.startsWith("./"))
    .map(normalizeRepoPath);
}

/**
 * True when deleting `deletionPath` would remove `usesTarget` — either because
 * they are the same path, or because the deletion is a directory containing it.
 * @param deletionPath - Normalized path a deletions manifest wants removed
 * @param usesTarget - Normalized target of a local `uses:` reference
 * @returns Whether the deletion would break that reference
 */
function deletionCoversTarget(
  deletionPath: string,
  usesTarget: string
): boolean {
  return (
    usesTarget === deletionPath || usesTarget.startsWith(`${deletionPath}/`)
  );
}

/**
 * Decide whether one workflow file keeps the deletion target alive.
 * @param workflowsDir - Absolute path to the consumer's workflow directory
 * @param fileName - Workflow file name inside that directory
 * @param deletionPath - Normalized path a deletions manifest wants removed
 * @returns The workflow's repo-relative path when it references the target, otherwise undefined
 */
async function referencingWorkflowPath(
  workflowsDir: string,
  fileName: string,
  deletionPath: string
): Promise<string | undefined> {
  const workflowRepoPath = `${WORKFLOWS_DIR}/${fileName}`;
  // A file that only references itself is not kept alive by that reference.
  if (deletionCoversTarget(deletionPath, workflowRepoPath)) {
    return undefined;
  }

  const content = await readFile(path.join(workflowsDir, fileName), "utf-8");
  const referenced = extractLocalUsesTargets(content).some(target =>
    deletionCoversTarget(deletionPath, target)
  );
  return referenced ? workflowRepoPath : undefined;
}

/**
 * Find the consumer's own workflows that call `relativePath` as a local
 * reusable workflow or composite action.
 *
 * A deletions manifest is authored upstream and cannot know a consumer's call
 * graph; `lisa apply` can, because it runs with the consumer's repository on
 * disk. An unresolvable local `uses:` is a **startup failure** — GitHub
 * validates the workflow graph before executing any job, so the whole run dies
 * and a job-level `if:` does not save it. Worse, the break surfaces the next
 * time the calling workflow runs, arbitrarily far from the apply that caused
 * it. So the reference is read at delete time and the deletion refused.
 * @param projectDir - Absolute path to the consumer repository root
 * @param relativePath - Repo-relative path a deletions manifest wants removed
 * @returns Repo-relative paths of the workflows referencing it, sorted; empty when unreferenced
 */
export async function findLocalWorkflowReferences(
  projectDir: string,
  relativePath: string
): Promise<readonly string[]> {
  const deletionPath = normalizeRepoPath(relativePath);
  if (deletionPath === "") {
    return [];
  }

  const workflowsDir = path.join(projectDir, ...WORKFLOWS_DIR.split("/"));
  if (!(await fse.pathExists(workflowsDir))) {
    return [];
  }

  const entries = await readdir(workflowsDir, { withFileTypes: true });
  const candidates = entries.filter(
    entry =>
      entry.isFile() && WORKFLOW_EXTENSIONS.includes(path.extname(entry.name))
  );

  const resolved = await Promise.all(
    candidates.map(entry =>
      referencingWorkflowPath(workflowsDir, entry.name, deletionPath)
    )
  );

  return resolved
    .filter((found): found is string => found !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

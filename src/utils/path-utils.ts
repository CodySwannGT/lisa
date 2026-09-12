import * as path from "node:path";

/**
 * Resolve a path to an absolute path
 * @param inputPath Path to resolve
 * @returns Absolute path
 */
export function toAbsolutePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(process.cwd(), inputPath);
}

/**
 * Get the relative path from base to target
 * @param basePath Base path
 * @param targetPath Target path
 * @returns Relative path from base to target
 */
export function getRelativePath(basePath: string, targetPath: string): string {
  return path.relative(basePath, targetPath);
}

/**
 * Join path segments
 * @param segments Path segments to join
 * @returns Joined path
 */
export function joinPaths(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Get the directory name of a path
 * @param filePath Path to get directory name from
 * @returns Directory name
 */
export function getDirname(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * Get the base name of a path
 * @param filePath Path to get base name from
 * @returns Base name
 */
export function getBasename(filePath: string): string {
  return path.basename(filePath);
}

/**
 * Whether one path is a root itself or lies beneath it, judged on a path
 * boundary rather than a string prefix.
 *
 * ## The defect this exists against
 *
 * `"/a/land3716-tmp/f".startsWith("/a/land3716")` is true, so a bare prefix
 * comparison reports a SIBLING as being inside the root (CodySwannGT/lisa#3808).
 * The convention agents follow makes that the common shape, not the exotic one:
 * a scratch worktree at `<TMPDIR>/<name>` and its scratch directory at
 * `<TMPDIR>/<name>-tmp` are siblings, and the second string-prefixes the first.
 *
 * ## What it decides, and what it does not
 *
 * It is **lexical**. Both arguments are resolved to absolute paths and `..`
 * segments are collapsed, so traversal and relative inputs are handled, and a
 * trailing separator is irrelevant. It does NOT follow symlinks: a link inside
 * the root whose target is outside it still reports as inside, because the path
 * as written is inside. A caller that must refuse such an escape has to resolve
 * the real paths itself and ask this question about those instead.
 *
 * It fails closed. An argument that cannot name a path — the empty string,
 * which `path.resolve` would silently turn into the working directory — reads
 * as NOT contained, because "inside" is the answer that grants access.
 * @param root Directory the candidate is tested against
 * @param candidate Path being tested
 * @returns True when `candidate` is `root` or lives beneath it
 */
export function isPathInside(root: string, candidate: string): boolean {
  if (root === "" || candidate === "") {
    return false;
  }
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "") {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

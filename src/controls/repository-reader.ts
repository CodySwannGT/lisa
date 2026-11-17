/**
 * Read-only questions about the repository a control document describes.
 *
 * A report points at files and folders by repository-relative path. Whether
 * those pointers lead anywhere is a question about the working tree, and this
 * is the only place the control code asks it. A path is answered only when it
 * stays inside the repository, both as written and after links are followed,
 * so a document cannot use a pointer to make Lisa read something else on the
 * machine.
 * @module controls/repository-reader
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** What a control document may ask about the repository it describes. */
export interface RepositoryReader {
  /**
   * Count the lines of a file.
   * @param relativePath - Repository-relative path, with `/` separators
   * @returns The number of lines, or `null` when no such file is in the
   *   repository
   */
  readonly lineCount: (relativePath: string) => number | null;
  /**
   * Tell whether a path is a folder of the repository.
   * @param relativePath - Repository-relative path; `.` is the root
   * @returns Whether a folder is there
   */
  readonly isFolder: (relativePath: string) => boolean;
}

/**
 * Resolve a repository-relative path to the real path it names.
 * @param root - Real, absolute path of the repository root
 * @param relativePath - Repository-relative path
 * @returns The real path, or `null` when it is missing or leaves the
 *   repository
 */
function confinedRealPath(root: string, relativePath: string): string | null {
  if (relativePath === "" || path.isAbsolute(relativePath)) return null;
  const lexical = path.resolve(root, relativePath);
  if (lexical !== root && !lexical.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  try {
    const real = realpathSync(lexical);
    return real === root || real.startsWith(`${root}${path.sep}`) ? real : null;
  } catch {
    return null;
  }
}

/**
 * Count the lines of a text: one per line break, plus a last line that has no
 * break after it.
 * @param text - File content
 * @returns The number of lines; none for an empty file
 */
function countLines(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/**
 * Open a repository for read-only questions.
 * @param repositoryRoot - Absolute path of the repository root
 * @returns The reader
 */
export function createRepositoryReader(
  repositoryRoot: string
): RepositoryReader {
  const root = realpathSync(repositoryRoot);
  return {
    lineCount: relativePath => {
      const file = confinedRealPath(root, relativePath);
      if (file === null || !statSync(file).isFile()) return null;
      return countLines(readFileSync(file, "utf8"));
    },
    isFolder: relativePath => {
      const folder = confinedRealPath(root, relativePath);
      return folder !== null && statSync(folder).isDirectory();
    },
  };
}

/**
 * Read-only questions about the repository a control document describes.
 *
 * A report points at files and folders by repository-relative path. Whether
 * those pointers lead anywhere is a question about the working tree, and this
 * is the only place the control code asks it. A path is answered only when it
 * stays inside the repository, both as written and after links are followed,
 * so a document cannot use a pointer to make Lisa read something else on the
 * machine.
 *
 * ## Places a pointer may not lead
 *
 * A pointer is how a report shows that something is in the repository. Three
 * places hold files that show nothing of the kind, and a pointer into one is
 * answered as if no file were there ({@link recordKeepingPlace}):
 *
 * - `.lisa/audit/`: the audit's own report. A report that points at itself
 *   has found only what it wrote.
 * - `.lisa/controls/`: what Lisa's own commands write about the repository
 *   (evidence, the verdict, proof patches). The one exception is the control
 *   register, `.lisa/controls/register.json`: it is the list of rules a
 *   requirement asks for, and `lisa controls reconcile` points at the line
 *   that lists a rule.
 * - `.git`: git's own data, which every repository has. The one exception
 *   is a hook installed in `.git/hooks/`, which is a check that really runs
 *   in this checkout; the samples git ships there are not.
 *
 * The rule is applied to the path as written and again to the real path
 * behind any link, so a link elsewhere in the tree does not get around it.
 * @module controls/repository-reader
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** The control register: the one file of Lisa's records a pointer may name. */
const POINTABLE_RECORD = ".lisa/controls/register.json";

/** The folder git keeps its own data in. */
const GIT_FOLDER = ".git";

/** The folder of `.git` that holds the hooks installed in this checkout. */
const GIT_HOOKS = `${GIT_FOLDER}/hooks/`;

/** What ends the name of a hook git ships as an example and never runs. */
const SAMPLE_HOOK = ".sample";

/** The folders Lisa keeps records in, with what each holds. */
const RECORD_FOLDERS: readonly (readonly [string, string])[] = [
  [
    ".lisa/audit/",
    "the audit's own report folder (.lisa/audit), which the audit itself writes",
  ],
  [
    ".lisa/controls/",
    `Lisa's own records (.lisa/controls), which its commands write; the one file there a pointer may name is the control register, ${POINTABLE_RECORD}`,
  ],
];

/** What a pointer into git's folder is told. */
const GIT_DATA = `git's own folder (${GIT_FOLDER}), which every repository has; the one thing there a pointer may name is a hook installed in ${GIT_HOOKS}`;

/**
 * Say which record-keeping place a repository-relative path leads into.
 *
 * Letter case is ignored, because on a file system that ignores it `.GIT`
 * names the same folder.
 * @param relativePath - Repository-relative path, with `/` separators
 * @returns What the place is, in words that complete "leads into …", or
 *   `null` when the path is part of what the repository itself holds
 */
export function recordKeepingPlace(relativePath: string): string | null {
  const normal = path.posix
    .normalize(relativePath.replaceAll("\\", "/"))
    .toLowerCase();
  const segments = normal.split("/");
  if (segments.includes(GIT_FOLDER)) {
    const installedHook =
      segments.length === 3 &&
      normal.startsWith(GIT_HOOKS) &&
      !normal.endsWith(SAMPLE_HOOK);
    return installedHook ? null : GIT_DATA;
  }
  if (normal === POINTABLE_RECORD) return null;
  const held = RECORD_FOLDERS.find(([folder]) =>
    `${normal}/`.startsWith(folder)
  );
  return held === undefined ? null : held[1];
}

/** What a control document may ask about the repository it describes. */
export interface RepositoryReader {
  /**
   * Count the lines of a file.
   * @param relativePath - Repository-relative path, with `/` separators
   * @returns The number of lines, or `null` when no such file is in the
   *   repository, or the file is in a place a pointer may not lead
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
      const real = path.relative(root, file).split(path.sep).join("/");
      const keepsRecords =
        recordKeepingPlace(relativePath) !== null ||
        recordKeepingPlace(real) !== null;
      return keepsRecords ? null : countLines(readFileSync(file, "utf8"));
    },
    isFolder: relativePath => {
      const folder = confinedRealPath(root, relativePath);
      return folder !== null && statSync(folder).isDirectory();
    },
  };
}

/**
 * The one definition of "this path is not there" for checks that must tell
 * absence apart from a probe that could not look.
 *
 * Doctor checks answer every filesystem question three ways: present, absent,
 * or undeterminable. The last must never render as the second, or a project
 * the check could not read reports `ok`. Each check used to carry a private
 * copy of the absent-errno set, and one copy was corrected while four kept
 * `ENAMETOOLONG` (CodySwannGT/lisa#4553, CodySwannGT/lisa#4629). One shared
 * definition is what keeps them from drifting apart again.
 * @module utils/fs-absence
 */

/**
 * Errno codes that ANSWER the question rather than refusing it: the path is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look.
 *
 * `ENAMETOOLONG` is deliberately NOT here. It describes the path the check
 * built, not the file: a project nested past the platform's path limit can
 * still hold every file the check looks for, and calling that "absent" would
 * pass a project nobody read.
 */
const DEFINITIVE_ABSENCE_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "ENOTDIR",
]);

/**
 * The errno code of a rejected filesystem call, when it carries one.
 * @param error - Value thrown by a filesystem call
 * @returns The errno code, or undefined when the value carries no string code
 */
export function errnoCode(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Whether a filesystem rejection proves the path is not there.
 * @param error - Value thrown by a filesystem call
 * @returns True only for `ENOENT` and `ENOTDIR`; false for every other code,
 *   and for a value that carries no code at all
 */
export function isDefinitiveAbsence(error: unknown): boolean {
  const code = errnoCode(error);
  return code !== undefined && DEFINITIVE_ABSENCE_CODES.has(code);
}

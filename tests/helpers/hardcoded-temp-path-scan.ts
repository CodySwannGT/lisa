/**
 * Detect test sources that escape the scratch redirection with a literal path.
 *
 * The redirection in `src/configs/vitest/scratch-setup.ts` moves every
 * `mkdtemp(os.tmpdir())` in the suite into a run root the process owns. A
 * source that names an absolute platform temp path instead walks straight past
 * it and writes into the shared directory the whole mechanism exists to
 * protect — the one measured at 24.8 MB and an 11-second `stat`.
 *
 * ## Why this is a module rather than two closures in a test
 *
 * CodySwannGT/lisa#2950. Both arms of the guard scanned the real `tests/` tree
 * and asserted the offender list was `[]`. That proves the scan RAN over a
 * clean tree. It does not prove the detector detects, and the second arm is
 * where that bites hardest, because its matcher is assembled at runtime from
 * six alternatives and three escaped roots. A typo anywhere in that
 * construction yields a regex matching nothing, an offender list that is `[]`
 * for the wrong reason, and a permanently green guard — the exact failure
 * shape this epic exists to eliminate, occurring inside a guard written to
 * prevent it.
 *
 * Pure over `(file, source)` so the detector can be pointed at inputs rather
 * than only at the live tree. A clean tree and a broken matcher then stop
 * looking identical.
 *
 * ## Why the offending path is reported, not just the file
 *
 * #2886's criterion asks the guard to fail "naming the file and the path". The
 * file was named; the path was described only as a class, in the message. A
 * reader given `tests/foo.test.ts` still has to search the file for whichever
 * of six creators and three roots tripped it.
 * @module tests/helpers/hardcoded-temp-path-scan
 */

/**
 * The macOS shared per-user temp root, assembled rather than written.
 *
 * Spelling it literally here would make this module the first offender its own
 * shared-root scan reports. Assembling it is not a trick to dodge the guard —
 * the guard's subject is a source that USES such a path, and this one only
 * describes it.
 */
const SHARED_ROOT = ["", "var", "folders", ""].join("/");

/** Absolute temp roots a fixture must never name directly. */
const ABSOLUTE_ROOTS: readonly string[] = [
  "/tmp",
  "/private/tmp",
  SHARED_ROOT.slice(0, -1),
];

/** Calls that bring a directory into existence at a path they are handed. */
const CREATORS = "mkdtemp|mkdtempSync|mkdir|mkdirSync|ensureDir|ensureDirSync";

/** One source naming a temp path it must not name. */
export interface TempPathOffence {
  /** Repository-relative path of the offending source. */
  readonly file: string;
  /** The offending text, so the reader does not have to go looking for it. */
  readonly literal: string;
}

/**
 * Render an offence as one diagnostic line.
 * @param offence - The offending file and text
 * @returns `file: literal`
 */
export function describeOffence(offence: TempPathOffence): string {
  return `${offence.file}: ${offence.literal}`;
}

/**
 * The macOS shared per-user temp root, for callers building their own message.
 * @returns The root, with its trailing separator
 */
export function sharedTempRoot(): string {
  return SHARED_ROOT;
}

/**
 * Find every mention of the macOS shared per-user temp root in one source.
 *
 * A mention rather than a creation call: naming that root at all means the
 * source has an opinion about a directory outside the run root, and there is
 * no legitimate reason for a test in this tree to hold one.
 * @param file - Repository-relative path, for the diagnostic
 * @param source - The file's text
 * @returns One offence per occurrence
 */
export function sharedRootOffences(
  file: string,
  source: string
): readonly TempPathOffence[] {
  const pattern = new RegExp(
    `${SHARED_ROOT.replaceAll("/", String.raw`\/`)}[^"'\`\\s]*`,
    "gu"
  );
  return [...source.matchAll(pattern)].map(match => ({
    file,
    literal: match[0],
  }));
}

/**
 * Find every directory creation at a hardcoded absolute temp path.
 *
 * Deliberately narrow: it matches only a creation call whose FIRST argument is
 * an absolute temp literal. A `/tmp/...` appearing in an expectation or a
 * message is fine, and a guard that flagged those would be turned off.
 * @param file - Repository-relative path, for the diagnostic
 * @param source - The file's text
 * @returns One offence per creation call
 */
export function creationOffences(
  file: string,
  source: string
): readonly TempPathOffence[] {
  const roots = ABSOLUTE_ROOTS.map(root =>
    root.replaceAll("/", String.raw`\/`)
  ).join("|");
  const pattern = new RegExp(
    `(?:${CREATORS})\\(\\s*["'\`]((?:${roots})[^"'\`]*)`,
    "gu"
  );
  return [...source.matchAll(pattern)].map(match => ({
    file,
    literal: match[1] ?? "",
  }));
}

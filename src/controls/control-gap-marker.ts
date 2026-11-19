/**
 * The marker a ticket for a missing capability carries.
 *
 * A requirement with nothing behind it becomes one ticket, and a later run
 * must find that ticket instead of filing a second. Titles are rewritten and
 * tickets are moved, so the ticket is found by a marker line in its
 * description:
 *
 *     [lisa-control-gap] criterion=AC8.2 scope=api key=9a486b704cd0
 *
 * ## What identifies the ticket
 *
 * The tag and the `key`, and nothing else. The key is a hash of the criterion
 * id and the folder, so it depends on what is missing and where, never on the
 * order the audit wrote its findings in. It is twelve lower-case hex
 * characters because that is text no tracker changes: trackers store a
 * description as rich text, and on the way in and out they may escape
 * brackets, drop HTML comments, turn `--` into a dash or `_word_` into
 * emphasis. `criterion=` and `scope=` are there for a person reading the
 * ticket; a search matches on the key.
 *
 * The key is computed here, by code, and never by the agent filing the ticket:
 * a key an agent works out itself can differ between two runs, and then the
 * second run files a duplicate.
 * @module controls/control-gap-marker
 */
import { createHash } from "node:crypto";

/** The word every control-gap marker starts with, between square brackets. */
export const CONTROL_GAP_TAG = "lisa-control-gap";

/** How many hex characters of the hash a key keeps. */
export const CONTROL_GAP_KEY_LENGTH = 12;

/** What a folder path may show as itself inside a marker. */
const PLAIN_SCOPE_CHARACTERS = /[A-Za-z0-9._/-]/u;

/**
 * Write a folder path the one way it is hashed and shown.
 *
 * A folder name with an accent can reach the audit as one character or as a
 * letter followed by a combining mark, depending on the file system. Both are
 * the same folder, so both are written the composed way.
 * @param scope - A report scope
 * @returns The scope in Unicode's composed form
 */
function canonicalScope(scope: string): string {
  return scope.normalize("NFC");
}

/**
 * The key that identifies one missing capability: a requirement in one part of
 * the repository.
 *
 * Reproducible outside this code with
 * `printf 'criterion=%s\nscope=%s' <id> <scope> | shasum -a 256 | cut -c1-12`.
 * @param criterion - Criterion id, exactly as the catalogue writes it
 * @param scope - The folder the finding is about; `.` is the whole repository
 * @returns Twelve lower-case hex characters
 */
export function controlGapKey(criterion: string, scope: string): string {
  return createHash("sha256")
    .update(`criterion=${criterion}\nscope=${canonicalScope(scope)}`, "utf8")
    .digest("hex")
    .slice(0, CONTROL_GAP_KEY_LENGTH);
}

/**
 * Write a folder path so it is one word of plain characters.
 *
 * Letters, digits, `.`, `_`, `/` and `-` stay as they are. Every other
 * character, a space included, becomes its UTF-8 bytes as `%XX`, so the marker
 * stays one line of four fields whatever the folder is called.
 * @param scope - A report scope
 * @returns The scope with nothing in it that a formatter treats specially
 */
export function encodeMarkerScope(scope: string): string {
  return [...canonicalScope(scope)]
    .map(character =>
      PLAIN_SCOPE_CHARACTERS.test(character)
        ? character
        : [...Buffer.from(character, "utf8")]
            .map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
            .join("")
    )
    .join("");
}

/**
 * The marker line for one missing capability.
 * @param criterion - Criterion id, exactly as the catalogue writes it
 * @param scope - The folder the finding is about; `.` is the whole repository
 * @returns The line a ticket carries, with no line break
 */
export function controlGapMarker(criterion: string, scope: string): string {
  return `[${CONTROL_GAP_TAG}] criterion=${criterion} scope=${encodeMarkerScope(scope)} key=${controlGapKey(criterion, scope)}`;
}

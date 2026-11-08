/**
 * The shape of the learnings merge driver's registered command, and how to
 * read one back (CodySwannGT/lisa#4640).
 *
 * ## Why the command names no absolute path
 *
 * `git config --local` writes `.git/config`, which every linked worktree of a
 * repository SHARES. The command used to be `'<runtime>' '<entry script>'` of
 * whichever checkout ran `lisa apply` — often a temporary worktree, such as
 * the one each host upgrade runs in. Once that worktree is removed, every
 * worktree's learnings merges run a command that no longer exists, and git
 * leaves the ledger as OUR side only, with no conflict markers. Staging that
 * file silently drops the other branch's learnings: the loss the driver exists
 * to prevent.
 *
 * Git runs a merge driver with its cwd at the top of the worktree being
 * merged, so a repo-relative entry resolves per worktree. That is the rule the
 * sibling `lisa-generated-artifact` driver already follows
 * (`scripts/install-generated-artifact-merge-driver.mjs`).
 *
 * ## Why it is a self-contained `sh -c` script
 *
 * The command has to stay correct in a worktree where Lisa is NOT installed,
 * and where Lisa is installed but cannot run (pruned dependencies, a runtime
 * too old for the build). Exiting non-zero in either case would reproduce the
 * markerless "ours" file, so the script writes a conflict-marked file holding
 * both sides into `%A` and only then exits non-zero. Lisa is therefore not
 * `exec`ed: the script snapshots `%A`, runs Lisa, and falls back when Lisa
 * failed WITHOUT reaching its own deliberate semantic-conflict verdict (which
 * it acknowledges by creating the `--conflict-ack` file) and left `%A`
 * unchanged. A Lisa too old to know that flag rejects it without touching
 * `%A`, so it, too, lands in the safe both-sides fallback.
 * Keeping the script in git config rather than in a tracked wrapper adds no
 * file to every host repository.
 *
 * ## One key per repository
 *
 * `merge.lisa-learnings.driver` is a single repository-wide key, so a
 * repository holding several Lisa projects at different depths registers the
 * entry of whichever project applied last — last writer wins. That was equally
 * true of the absolute form; this module does not make it worse.
 * @module core/learnings-merge-driver-command
 */
import * as path from "node:path";

import { LEARNINGS_MERGE_DRIVER_NAME } from "./learnings-merge-driver.js";

/** Lisa's entry script, relative to a host project's root. */
export const HOST_LISA_ENTRY = "node_modules/@codyswann/lisa/dist/index.js";

/** Lisa's entry script, relative to the Lisa repository's own root. */
export const SELF_LISA_ENTRY = "dist/index.js";

/** `$0` of the driver script; also how a portable command is recognised. */
const SCRIPT_NAME = "lisa-learnings-driver";

/**
 * The POSIX sh body run as `sh -c '<body>' lisa-learnings-driver <entry> %O %A %B %P`.
 *
 * It must contain no single quote (it is single-quoted) and no `%` (git
 * expands `%` sequences in the whole command). `$1` is the repo-relative entry;
 * after `shift`, `$1..$4` are git's base, ours, theirs and pathname.
 */
const DRIVER_SCRIPT = [
  `e="$1"; shift`,
  `if command -v node >/dev/null 2>&1; then r=node; else r=bun; fi`,
  `t="$2.lisa-conflict.$$"; k="$2.lisa-snapshot.$$"; a="$2.lisa-handled.$$"`,
  `side() { cat "$1"; [ -z "$(tail -c 1 "$1")" ] || echo; }`,
  `conflict() { { echo "<<<<<<< ours"; side "$1"; echo "======="; side "$2"; echo ">>>>>>> theirs"; } > "$t" && mv "$t" "$1"; }`,
  `if [ -f "$e" ] && command -v "$r" >/dev/null 2>&1; then cp "$2" "$k"; "$r" "$e" merge-learnings --base "$1" --ours "$2" --theirs "$3" --path "$4" --conflict-ack "$a"; s=$?; if [ "$s" -ne 0 ] && [ ! -f "$a" ] && cmp -s "$2" "$k"; then conflict "$2" "$3"; echo "${LEARNINGS_MERGE_DRIVER_NAME} merge driver: Lisa ($e) exited $s without merging $4, so it was left with conflict markers holding both sides." >&2; fi; rm -f "$k" "$a"; exit "$s"; fi`,
  `conflict "$2" "$3"`,
  `echo "${LEARNINGS_MERGE_DRIVER_NAME} merge driver: cannot run Lisa here ($e, or a node or bun runtime, is missing in this worktree), so $4 was left with conflict markers holding both sides. Install dependencies here, then run lisa install-merge-driver." >&2`,
  `exit 1`,
].join("; ");

/** What a registered command is, as far as doctor can tell. */
export type LearningsDriverCommandShape =
  | { readonly kind: "portable"; readonly entry: string }
  | { readonly kind: "absolute"; readonly paths: readonly string[] }
  | { readonly kind: "other" };

/**
 * Quote one value for the POSIX shell git runs a merge driver through.
 *
 * Single quotes, not double: inside double quotes `$`, a backtick and a
 * backslash stay special, and this repo shipped that bug class in #1982.
 * Inside single quotes every byte is literal, so only an embedded single quote
 * needs handling — closed, escaped, and reopened as `'\''`.
 * @param value - Raw value
 * @returns Shell-safe single-quoted token
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Build the worktree-portable driver command for one entry path.
 *
 * The `%O %A %B %P` placeholders stay bare positional arguments OUTSIDE the
 * quoted script: git substitutes them already shell-quoted, and quoting them
 * again is the RCE documented on `buildLearningsMergeDriverCommand`. A `%` in
 * the entry is doubled, because git expands `%` sequences before the shell
 * ever sees the string.
 * @param entry - Lisa entry script relative to the worktree top, e.g. `./dist/index.js`
 * @returns Driver command for `merge.lisa-learnings.driver`
 */
export function buildPortableLearningsMergeDriverCommand(
  entry: string
): string {
  const escapedEntry = shellQuote(entry).replaceAll("%", "%%");
  return `sh -c ${shellQuote(DRIVER_SCRIPT)} ${SCRIPT_NAME} ${escapedEntry} %O %A %B %P`;
}

/**
 * Every single-quoted token at the start of a shell fragment, unquoted.
 * @param fragment - Text made only of single-quoted tokens and spaces
 * @returns Unquoted tokens, or undefined when anything else is present
 */
function singleQuotedTokens(fragment: string): readonly string[] | undefined {
  const token = /'((?:[^']|'\\'')*?)'(?=\s|$)/gu;
  const tokens = [...fragment.matchAll(token)];
  const rest = fragment.replaceAll(token, "").trim();
  if (tokens.length === 0 || rest !== "") {
    return undefined;
  }
  return tokens.map(match => (match[1] ?? "").replaceAll("'\\''", "'"));
}

/**
 * Whether a token is an absolute path on POSIX or Windows.
 *
 * Checked explicitly for both, because doctor may run on one platform against
 * a registration written on the other (a Windows drive-letter path is not
 * absolute to `path.isAbsolute` on POSIX).
 * @param token - Unquoted command token
 * @returns True for `/…`, `C:\…` or `C:/…`
 */
function isAbsolutePath(token: string): boolean {
  return path.isAbsolute(token) || /^[A-Za-z]:[\\/]/u.test(token);
}

/**
 * Classify a registered `merge.lisa-learnings.driver` command.
 *
 * `absolute` is the pre-#4640 `'<runtime>' '<entry>' merge-learnings …`
 * form, whose paths belong to one checkout. Anything Lisa did not write — a
 * hand-registered `lisa merge-learnings`, a global wrapper — is `other`, which
 * doctor cannot verify and does not second-guess.
 * @param command - Registered command, as `git config --get` returns it
 * @returns Shape of the command
 */
export function classifyLearningsDriverCommand(
  command: string
): LearningsDriverCommandShape {
  const marker = ` ${SCRIPT_NAME} `;
  const markerAt = command.indexOf(marker);
  if (command.startsWith("sh -c '") && markerAt !== -1) {
    const tail = command.slice(markerAt + marker.length).split(" %O ")[0];
    const entry = singleQuotedTokens(tail ?? "")?.[0];
    return entry === undefined
      ? { kind: "other" }
      : { kind: "portable", entry: entry.replaceAll("%%", "%") };
  }
  const [head] = command.split(" merge-learnings ");
  const tokens =
    head === undefined || head === command
      ? undefined
      : singleQuotedTokens(head);
  const paths = (tokens ?? []).filter(isAbsolutePath);
  return paths.length === 0 ? { kind: "other" } : { kind: "absolute", paths };
}

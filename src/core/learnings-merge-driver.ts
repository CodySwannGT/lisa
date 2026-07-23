/**
 * Registration contract for the project-learnings union merge driver.
 *
 * A git merge driver has two halves that live in different places:
 *
 * 1. **The attribute** (`.gitattributes`) says WHICH driver a path uses. It is
 *    a committed file, so Lisa ships it to the repository and to every host
 *    project through the template pipeline.
 * 2. **The driver command** (`merge.<name>.driver`) says HOW to run it. Git
 *    deliberately keeps this in machine-local config and never reads it from
 *    the repository, because a committed driver command would let a cloned
 *    repository execute arbitrary code on `git merge`.
 *
 * So the attribute alone is inert. Until the command is registered, git falls
 * back to its built-in text merge — which is exactly today's behavior, so an
 * unregistered checkout is degraded, never broken. That fallback is asserted in
 * `tests/unit/core/learnings-merge-driver.test.ts`.
 *
 * Registration is AUTOMATIC, not operator-initiated. `EnsureLearningsMergeDriver`
 * runs on every `lisa apply`, and the TypeScript stack's `package.lisa.json`
 * wires `lisa apply` into `postinstall` — so an ordinary `npm install` in a host
 * project writes `merge.lisa-learnings.driver` into `.git/config` with no
 * separate human step, and against Lisa's own repository too.
 *
 * That is worth stating plainly because of what it implies: the registration
 * persists an executable hook in local git config that fires on ordinary git
 * operations, outside npm's lifecycle. It is not an escalation over `npm
 * install` itself (which already runs arbitrary code), but it does outlive it.
 * Hosts that would rather not carry that hook set `learnings.mergeDriver: false`
 * in `.lisa.config.json`; `lisa install-merge-driver` remains available to
 * register it by hand in a clone that apply has not touched.
 * @module core/learnings-merge-driver
 */

/** Git merge-driver name shared by `.gitattributes` and the local git config. */
export const LEARNINGS_MERGE_DRIVER_NAME = "lisa-learnings";

/** Human-readable driver name recorded alongside the command. */
export const LEARNINGS_MERGE_DRIVER_DESCRIPTION =
  "Union project learnings by entry id";

/** Marker opening the Lisa-managed block in a host `.gitattributes`. */
export const GITATTRIBUTES_BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";

/** Marker closing the Lisa-managed block in a host `.gitattributes`. */
export const GITATTRIBUTES_END_MARKER = "# END: AI GUARDRAILS";

/**
 * Build the `merge.<name>.driver` command string.
 *
 * Git expands `%O` (merge base), `%A` (our version, and the file the driver
 * MUST overwrite with the result), `%B` (their version), and `%P` (the real
 * pathname, used only for diagnostics). The driver reports success by exiting
 * zero; any non-zero exit tells git to record a conflict.
 *
 * ⚠️ DO NOT WRAP THE PLACEHOLDERS IN QUOTES. Git runs this string through
 * `sh -c` and substitutes `%O/%A/%B/%P` already shell-quoted (git's own
 * `sq_quote`), so bare `--path %P` is correct AND safe for a pathname
 * containing spaces or metacharacters. Adding quotes — `--path "%P"` — looks
 * like a fix for filenames with spaces and is a remote code execution hole: the
 * value arrives pre-quoted, so the added double quotes re-expose `$(...)`,
 * backticks and `$` inside a filename to the shell. A security review
 * demonstrated a working RCE for exactly that "fix". If a path with spaces
 * appears broken, the bug is elsewhere.
 *
 * The `invocation` argument is a different matter: it is OUR string, not git's,
 * so it must be shell-quoted by the caller before it gets here (see
 * `learnings-merge-driver-install.ts`).
 * @param invocation - How to invoke the Lisa CLI, already shell-quoted
 * @returns Fully expanded git driver command
 */
export function buildLearningsMergeDriverCommand(invocation: string): string {
  return `${invocation} merge-learnings --base %O --ours %A --theirs %B --path %P`;
}

/**
 * Build the `.gitattributes` line binding one ledger path to the driver.
 * @param ledgerPath - Project-relative learnings file path
 * @returns Single `.gitattributes` line, without a trailing newline
 */
export function buildLearningsAttributeLine(ledgerPath: string): string {
  return `${ledgerPath} merge=${LEARNINGS_MERGE_DRIVER_NAME}`;
}

/**
 * Render the complete Lisa-managed `.gitattributes` block.
 *
 * Wrapped in the same guardrail markers the `.gitignore` template uses, so the
 * `copy-contents` strategy replaces exactly this block on re-apply and leaves
 * every host-authored rule outside it untouched.
 * @param ledgerPath - Project-relative learnings file path
 * @returns Managed block, newline-terminated
 */
export function renderLearningsGitattributesBlock(ledgerPath: string): string {
  return [
    GITATTRIBUTES_BEGIN_MARKER,
    "",
    "# The project learnings ledger is written by concurrent learner passes that",
    "# each run on their own branch. Git's default line merge corrupts it with",
    "# conflict markers; this driver unions entries by id instead. The driver",
    "# command is machine-local — run `lisa install-merge-driver` to register it.",
    buildLearningsAttributeLine(ledgerPath),
    "",
    GITATTRIBUTES_END_MARKER,
    "",
  ].join("\n");
}

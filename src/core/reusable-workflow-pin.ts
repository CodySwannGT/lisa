/**
 * Reading and rewriting the ref a host project's workflow uses to call one of
 * Lisa's reusable workflows.
 *
 * ## What a caller line looks like
 *
 * ```yaml
 * jobs:
 *   quality:
 *     uses: CodySwannGT/lisa/.github/workflows/quality.yml@<40-char sha> # v4.4.11
 * ```
 *
 * The SHA is what Actions resolves; the trailing comment is what a human
 * reads. Both are written by the pinner, so the comment can never disagree
 * with the pin — a reader who trusts it is right to.
 *
 * ## Why a full SHA and not `@main`
 *
 * `@main` means every host repository executes whatever is on Lisa's default
 * branch at the moment its run starts: not the Lisa the project installed, not
 * the Lisa anyone reviewed, and not the Lisa that was green the last time CI
 * passed. A caller's CI can then change without the caller changing, an old
 * run cannot be reproduced, and the trust boundary moves from "what the pin
 * pointed at when it was reviewed" to "whatever that ref points at later" —
 * the supply-chain hole GitHub's own hardening guidance answers by pinning to
 * a full-length commit SHA.
 *
 * A short SHA is not a substitute. It is ambiguous by construction, and
 * several GitHub APIs in this repository's history have been measured
 * answering `total_count: 0` for a short SHA that had runs at its full form.
 *
 * ## The two failure modes this module has to hold together
 *
 * Pinning trades one silent failure for another, and pretending otherwise is
 * how this decision has already been reversed twice:
 *
 *   - **A frozen ref stops receiving fixes** and never goes red. A caller sat
 *     on a `@v3.35.0` tag while Lisa shipped 4.x, for months, reporting
 *     healthily the whole time. That is what `@main` was reinstated to solve.
 *   - **An unreachable ref stops loading.** Actions creates zero jobs, so a
 *     required check is ABSENT rather than red and pull requests hang on a
 *     verdict that never arrives.
 *
 * The answer to the first is that nothing here is hand-maintained: the pin is
 * rewritten from the installed version's tag every time Lisa is applied, so it
 * moves when the package pin moves and cannot silently fall behind it. The
 * answer to the second is that Lisa's release pipeline refuses to publish a
 * release commit that is reachable from no durable ref, so the SHA a consumer
 * is handed is always a tagged commit rather than a loose one; and if history
 * ever does move under it, the next apply re-derives the pin from the tag and
 * repairs it without anyone noticing it was broken.
 * @module core/reusable-workflow-pin
 */

/** The repository whose reusable workflows this module governs. */
export const LISA_REUSABLE_PREFIX = "CodySwannGT/lisa/.github/workflows/";

/** The only ref shape a caller may carry: a full-length commit SHA. */
export const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

/**
 * A job-level `uses:` pointing at a Lisa reusable workflow.
 *
 * Matched as text rather than through a YAML round-trip because these files
 * are human-maintained and dense with explanatory comments that a parse and
 * reserialize would delete. The same technique is used by the sibling
 * workflow migrations for the same reason.
 */
const USES_LINE =
  /^(?<lead>[ \t]*uses:[ \t]*)(?<open>["']?)CodySwannGT\/lisa\/\.github\/workflows\/(?<workflow>[A-Za-z0-9._-]+)@(?<ref>[^\s"'#]+)(?<tail>["' \t]*(?:#[^\n]*)?)$/u;

/** One caller reference found in a workflow file. */
export interface ReusableWorkflowRef {
  /** 1-based line number within the file. */
  readonly line: number;
  /** The Lisa reusable workflow being called, e.g. `quality.yml`. */
  readonly workflow: string;
  /** The ref the caller currently names. */
  readonly ref: string;
  /** Trailing comment text without its `#`, or null when there is none. */
  readonly comment: string | null;
}

/** The identity every caller in a project is pinned at. */
export interface ReleasePin {
  /** Full 40-character commit SHA the version's tag resolves to. */
  readonly sha: string;
  /** Human-readable version, written as the trailing comment. */
  readonly version: string;
}

/**
 * Whether a line is entirely a YAML comment.
 *
 * A commented-out caller is documentation, not a call. Rewriting one would
 * edit prose, and reporting one would raise a finding about a line that
 * invokes nothing.
 * @param line - One line of a workflow file
 * @returns True when the first non-space character is `#`
 */
function isCommentLine(line: string): boolean {
  return /^\s*#/u.test(line);
}

/**
 * Extract the comment text from the tail of a matched `uses:` line.
 * @param tail - Everything after the ref and its closing quote
 * @returns Comment text without the `#` and surrounding space, or null
 */
function commentOf(tail: string): string | null {
  const hash = tail.indexOf("#");
  return hash < 0 ? null : tail.slice(hash + 1).trim();
}

/**
 * Every Lisa reusable-workflow caller reference in one workflow file.
 * @param source - Full text of a workflow file
 * @returns One entry per reference, in file order
 */
export function findReusableWorkflowRefs(
  source: string
): readonly ReusableWorkflowRef[] {
  return source.split("\n").flatMap((line, index) => {
    if (isCommentLine(line)) return [];
    const groups = USES_LINE.exec(line)?.groups;
    if (groups === undefined) return [];
    const { workflow, ref, tail } = groups;
    if (workflow === undefined || ref === undefined) return [];
    return [
      {
        line: index + 1,
        workflow,
        ref,
        comment: commentOf(tail ?? ""),
      },
    ];
  });
}

/**
 * Whether a reference already carries the exact pin, comment included.
 * @param reference - A parsed caller reference
 * @param pin - The identity every caller must carry
 * @returns True when nothing about this reference needs rewriting
 */
export function isPinnedAt(
  reference: ReusableWorkflowRef,
  pin: ReleasePin
): boolean {
  return reference.ref === pin.sha && reference.comment === `v${pin.version}`;
}

/**
 * Whether a reference names anything other than a full commit SHA.
 *
 * This is the question the reporting surface asks, and it is deliberately NOT
 * "is it the pin I expect": a repository one release behind is current-enough
 * and self-heals on its next apply, while a repository on `@main` never does.
 * @param reference - A parsed caller reference
 * @returns True when the ref is a branch, a tag, or a short SHA
 */
export function isMutableRef(reference: ReusableWorkflowRef): boolean {
  return !FULL_COMMIT_SHA.test(reference.ref);
}

/**
 * Rewrite every Lisa reusable-workflow caller in a file to the given pin.
 *
 * The trailing comment on a caller line is Lisa-owned and is replaced
 * wholesale with `# v<version>`. That is what makes the rewrite idempotent —
 * appending would grow the line on every apply — and what makes the version a
 * reader sees impossible to disagree with the SHA above it.
 *
 * Quoting, indentation, and everything else on the line are preserved.
 * @param source - Full text of a workflow file
 * @param pin - The identity every caller must carry
 * @returns The rewritten text, byte-identical to the input when nothing changed
 */
export function pinReusableWorkflowRefs(
  source: string,
  pin: ReleasePin
): string {
  return source
    .split("\n")
    .map(line => {
      if (isCommentLine(line)) return line;
      const groups = USES_LINE.exec(line)?.groups;
      if (groups === undefined) return line;
      const { lead, open, workflow } = groups;
      // The closing quote is reconstructed from the opening one rather than
      // captured: YAML quoting is symmetric, and a separate optional-quote
      // group adjacent to a greedy tail is the ambiguity that makes this
      // pattern backtrack super-linearly on a long line.
      return `${lead ?? ""}${open ?? ""}${LISA_REUSABLE_PREFIX}${workflow ?? ""}@${pin.sha}${open ?? ""} # v${pin.version}`;
    })
    .join("\n");
}

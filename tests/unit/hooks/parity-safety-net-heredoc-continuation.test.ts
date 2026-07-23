/**
 * Unquoted-heredoc-body line-continuation classification (issue #1958 Finding
 * R4).
 *
 * In an UNQUOTED `<<EOF` heredoc body bash performs NO quote processing — `'`,
 * `"` and `#` are literal bytes — but it STILL removes an unescaped
 * `\<newline>` line continuation (bash manual: for an unquoted here-doc "the
 * character sequence `\newline` is ignored") and STILL expands `$(...)` /
 * backticks. The R3 body scanner read the body AFTER
 * `collapse_line_continuations`, which applies a FLAT shell quote state: a
 * single body apostrophe (`it's`) flips that collapser into a phantom
 * single-quoted string, so it REFUSES to join a `$\<newline>(` continuation —
 * leaving `$` at the end of one body line and `(` at the start of the next.
 * The per-line substitution scan needs a contiguous `$(`, so it sees neither
 * `'$\` nor `(touch…)` as a substitution: parser UNSUPPORTED → hook ALLOW →
 * proven RCE (bash removes the `\<newline>`, runs the `$(…)`, and the
 * sentinel/`id` execute under real bash). The fix joins each unquoted-body
 * window under bash's own `\<newline>` removal — backslash-only semantics,
 * independent of the flat quote collapser — before scanning, so the rejoined
 * `$(` is BLOCKED at the heredoc wall. Controls B/Q/C pin the root cause to the
 * apostrophe-driven single-state branch; the over-block guard proves a genuine
 * line-continuation in prose (no `$(`) is NOT over-blocked.
 * @module tests/unit/hooks/parity-safety-net-heredoc-continuation
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const HEREDOC_TERMINATOR = "EOF";
const HEREDOC_WALL_REASON = "malformed or ambiguous heredoc";
// An UNQUOTED `cat <<EOF` header: bash performs NO quote/comment processing on
// the body, yet still expands `$(...)` / backticks and still removes an
// unescaped `\<newline>` line continuation inside it (issue #1958 Finding R4).
const UNQUOTED_CAT_HEREDOC = "cat <<EOF";
const unquotedCat = (...body: string[]): string =>
  [UNQUOTED_CAT_HEREDOC, ...body, HEREDOC_TERMINATOR].join("\n");
// One raw backslash and one backtick, kept as named bytes so the split-token
// fixtures below read unambiguously.
const BACKSLASH = "\\";
const BACKTICK = "`";
// A body line that ENDS in `$\`: `unquotedCat` joins body lines with `\n`, so
// pairing this with a next line starting `(cmd)` places a `$(` split across a
// bash line continuation — `$` ends line N, `(` starts line N+1.
const SPLIT_DOLLAR_OPEN = `$${BACKSLASH}`;

const runHook = (
  command: string
): { status: number | null; stderr: string } => {
  const result = spawnSync("/bin/bash", [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
};

describe("unquoted-heredoc-body line-continuation split does not smuggle a live substitution (issue #1958 Finding R4)", () => {
  it("blocks a $(touch) split by a backslash-newline behind a body apostrophe (R4 A)", () => {
    const result = runHook(
      unquotedCat(
        `'${SPLIT_DOLLAR_OPEN}`,
        "(touch heredoc-1958-fp-R4A-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a weaponized $(touch && id) split by a backslash-newline behind an apostrophe (R4 W)", () => {
    const result = runHook(
      unquotedCat(
        `'${SPLIT_DOLLAR_OPEN}`,
        "(touch heredoc-1958-fp-R4W-sentinel && id)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a realistic line-wrapped cleanup $(touch) after apostrophe prose (R4 P)", () => {
    const result = runHook(
      unquotedCat(
        "notes: it's the rollout plan.",
        `cleanup step ${SPLIT_DOLLAR_OPEN}`,
        "(touch heredoc-1958-fp-R4P-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks the same split with NO apostrophe — the flat collapse joins it (R4 B control)", () => {
    // Isolates the trigger: without the apostrophe, `collapse_line_continuations`
    // stays in plain state and joins `$\<newline>(` itself, so the flat scan
    // catches it. Must remain BLOCKED both before and after the fix.
    const result = runHook(
      unquotedCat(SPLIT_DOLLAR_OPEN, "(touch heredoc-1958-fp-R4B-sentinel)")
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks the double-quote variant — double-state collapse joins it (R4 Q control)", () => {
    // A `"` before the split does NOT defeat the flat collapser (it joins in
    // double state), isolating the defect to the SINGLE-quote branch. BLOCKED
    // regardless of the fix.
    const result = runHook(
      unquotedCat(
        `"${SPLIT_DOLLAR_OPEN}`,
        "(touch heredoc-1958-fp-R4Q-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks a backtick split by a backslash-newline — a 1-char trigger is split-immune (R4 C control)", () => {
    // A backtick is a single-byte substitution trigger, so the continuation
    // cannot hide it the way it hides a two-byte `$(`. BLOCKED regardless.
    const result = runHook(
      unquotedCat(
        `'${BACKTICK}${BACKSLASH}`,
        `touch heredoc-1958-fp-R4C-sentinel${BACKTICK}`
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still allows a genuine line-continuation in prose with NO substitution (R4 over-block guard)", () => {
    // A real trailing-backslash line-wrap in ordinary prose (no `$(`). Joining
    // continuations for the scan must NOT start blocking legitimate wrapped prose.
    expect(
      runHook(
        unquotedCat(`continued on the next line ${BACKSLASH}`, "and here it is")
      ).status
    ).toBe(EXIT_ALLOWED);
  });
});

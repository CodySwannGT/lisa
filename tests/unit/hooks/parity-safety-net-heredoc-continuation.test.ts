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

// A trailing backslash on the LAST body line is a bash line continuation that
// joins that line to the delimiter line, so the delimiter never matches and the
// here-doc is NOT closed there — the real body swallows the apparent terminator
// and keeps consuming following lines. Anything the classifier read as ordinary
// post-here-doc text is therefore still body to bash, and a `$(...)` placed
// there is EXPANDED. Ground truth measured directly against /bin/bash:
//   `cat <<EOF` / `foo\` / `EOF` / `bar`      -> stdout `fooEOF\nbar` (never closed)
//   `cat <<'EOF'` / `foo\` / `EOF` / `bar`    -> stdout `foo\`, then `bar: command not found`
// So the per-physical-line delimiter match is CORRECT for a quoted delimiter and
// WRONG only for an unquoted one, which is what makes the fix local: the window
// resolver removes `\<newline>` before matching only when the delimiter is
// unquoted. These shapes were ALLOWED (parser 10) and executed the sentinel
// end-to-end under real bash before the fix.
const afterTerminator = (body: string[], ...tail: string[]): string =>
  [UNQUOTED_CAT_HEREDOC, ...body, HEREDOC_TERMINATOR, ...tail].join("\n");
// A last body line whose trailing backslash continues INTO the delimiter line.
const SWALLOWING_TAIL = `'foo${BACKSLASH}`;

describe("a trailing-backslash continuation must not swallow the terminator (issue #1993 R5a)", () => {
  it("blocks a $(touch) placed after the swallowed terminator (R5a X1)", () => {
    const result = runHook(
      afterTerminator(
        [SWALLOWING_TAIL],
        "$(touch heredoc-1993-R5a-X1-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a weaponized $(touch && id) after the swallowed terminator (R5a W)", () => {
    const result = runHook(
      afterTerminator(
        [SWALLOWING_TAIL],
        "$(touch heredoc-1993-R5aW-sentinel && id)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a backtick substitution after the swallowed terminator (R5a bt)", () => {
    const result = runHook(
      afterTerminator(
        [SWALLOWING_TAIL],
        `${BACKTICK}touch heredoc-1993-R5abt-sentinel${BACKTICK}`
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks the realistic apostrophe-prose shape that ends in a line wrap (R5a P)", () => {
    const result = runHook(
      afterTerminator(
        [`notes: it's the rollout plan${BACKSLASH}`],
        "echo $(touch heredoc-1993-R5aP-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks the same shape with NO apostrophe (R5a C1 control)", () => {
    // Isolates the trigger. Without the apostrophe the flat scanner is not
    // poisoned and already saw the `$(`, so this was BLOCKED before the fix and
    // must stay BLOCKED after it — the fix must not be what makes it pass.
    const result = runHook(
      afterTerminator(
        [`foo${BACKSLASH}`],
        "$(touch heredoc-1993-R5aC1-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks the same shape with BALANCED apostrophes (R5a C3 control)", () => {
    // The second control from the reproduction: an even apostrophe count leaves
    // the flat quote state correct. BLOCKED before and after.
    const result = runHook(
      afterTerminator(
        [`'foo'${BACKSLASH}`],
        "$(touch heredoc-1993-R5aC3-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  // The two rows below are the ONLY fixtures in this file that isolate fix A
  // (continuation-aware terminator matching) from fix B (here-doc body
  // neutralization). Every other R5a row places a BARE `$(` or backtick after
  // the terminator, and B's blanking already exposes those to the flat scanner —
  // so those rows stay BLOCKED even with A reverted and cannot pin it. Only a
  // tail the flat scanner deliberately SKIPS can tell the two apart: text after
  // a `#` comment marker, or after an opening `'` that it reads as a quote. With
  // A reverted (B and C kept) both of these go ALLOWED and execute their
  // sentinel under real bash; with A present both are BLOCKED, because the
  // swallowed terminator makes the here-doc unterminated and the command fails
  // closed before the flat scanner's blind spot can matter. Mutation-verified.
  it("blocks a #-commented substitution after the swallowed terminator (R5a fix-A pin)", () => {
    const result = runHook(
      afterTerminator(
        [SWALLOWING_TAIL],
        "#$(touch heredoc-1993-R5a-hash-sentinel)"
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks an apostrophe-prefixed substitution after the swallowed terminator (R5a fix-A pin)", () => {
    const result = runHook(
      afterTerminator(
        [SWALLOWING_TAIL],
        `'$(touch heredoc-1993-R5a-sq-sentinel)`
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("keeps a quoted-delimiter body with a mid-body line wrap allowed (R5a quoted-asymmetry guard)", () => {
    // Bash does NOT remove `\<newline>` in a `<<'EOF'` body — backslash is DATA
    // there — so that body is inert literal text and the window resolver must
    // keep matching the delimiter per PHYSICAL line for quoted delimiters. This
    // pins the quoted path against the R5a continuation removal leaking into it.
    const command = [
      `cat <<'${HEREDOC_TERMINATOR}'`,
      `foo${BACKSLASH}`,
      "bar",
      HEREDOC_TERMINATOR,
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("pins a PRE-EXISTING false positive: quoted delimiter, trailing wrap on the LAST body line", () => {
    // Measured BLOCKED on the parent commit and still BLOCKED here — this is NOT
    // an R5a regression. Bash accepts this shape (`foo\` is literal data and the
    // next line terminates), but the whole-command `collapse_line_continuations`
    // joins `foo\` to the delimiter line before the here-doc logic ever runs, so
    // the terminator is not found and the command fails closed. That collapser
    // is outside the R5a fix (which governs the here-doc WINDOW resolver only);
    // narrowing it is a separate change with its own bypass surface. Pinned so
    // the false positive is visible and attributed rather than rediscovered.
    const command = [
      `cat <<'${HEREDOC_TERMINATOR}'`,
      `foo${BACKSLASH}`,
      HEREDOC_TERMINATOR,
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });
});

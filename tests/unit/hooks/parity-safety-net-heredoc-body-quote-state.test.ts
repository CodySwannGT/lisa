/**
 * Here-doc body bytes must not corrupt the flat quote scanner (issue #1993
 * R5b/R5c).
 *
 * `has_active_command_substitution` runs ONE flat single/double-quote state
 * machine across the whole command — including here-doc bodies, where bash
 * applies NO quote processing at all. An ODD apostrophe in an unquoted body
 * (`it's fine`) therefore opens a phantom single-quoted string in that scanner
 * which persists PAST the terminator, hiding a live `$(...)` on a FOLLOWING
 * command line that bash happily executes. `strip_provably_literal_body` could
 * not save it: it bails whenever the delimiter is unquoted, so the poisoning
 * body is exactly the one it never neutralized. R5c is the same defect reached
 * through a delimiter spelling the parser did not model at all — `<<\EOF`,
 * which bash treats as fully quoted (measured: its body prints verbatim,
 * byte-identical to `<<'EOF'`), but for which no Marker was recorded, so no
 * body window existed to neutralize.
 *
 * Every BYPASS row below was ALLOWED (parser 10) and created its sentinel
 * end-to-end under real bash before the fix. The POISON CONTROL table is the
 * load-bearing half: the trigger is PRECISELY an odd `'` count, so an even
 * `''`, an odd `"`, a `#`, an ANSI-C `$'a` and a lone trailing backslash were
 * all already BLOCKED and must STAY blocked. Those rows pin the root cause and
 * stop a future fix from over-generalizing into "blank anything that looks like
 * a body". The over-block guards prove ordinary apostrophe prose is still
 * allowed.
 *
 * Severity note: these are defence-in-depth, not RCE. Every one lands on
 * UNSUPPORTED, where the hook passes the RAW command to the content guards, so
 * a wall miss removes zero guard coverage — the destructive-payload rows at the
 * bottom prove `rm -rf /` in the same position is still blocked.
 * @module tests/unit/hooks/parity-safety-net-heredoc-body-quote-state
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const HEREDOC_TERMINATOR = "EOF";
const HEREDOC_WALL_REASON = "malformed or ambiguous heredoc";
const UNQUOTED_CAT_HEREDOC = "cat <<EOF";
// `<<\EOF` — a BACKSLASH-quoted delimiter. Bash makes this body fully literal,
// exactly like `<<'EOF'`; the parser used to record no Marker for it at all.
const BACKSLASH_QUOTED_HEREDOC = "cat <<\\EOF";
const BACKSLASH = "\\";
const BACKTICK = "`";
const SUBSTITUTION = "$(touch heredoc-1993-body-quote-sentinel)";

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

/**
 * Build a here-doc with text placed AFTER the terminator — the position where a
 * poisoned flat quote scanner hides a live substitution.
 * @param header The here-doc header line, e.g. `cat <<EOF`.
 * @param body The single body line, i.e. the candidate poison.
 * @param tail Lines following the terminator, i.e. the smuggled payload.
 * @returns The assembled multi-line command.
 */
const withTail = (header: string, body: string, ...tail: string[]): string =>
  [header, body, HEREDOC_TERMINATOR, ...tail].join("\n");

describe("an odd body apostrophe must not hide a substitution after the terminator (issue #1993 R5b)", () => {
  it("blocks a $(touch) after a body that is a bare apostrophe (R5b C2min)", () => {
    const result = runHook(withTail(UNQUOTED_CAT_HEREDOC, "'", SUBSTITUTION));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks the ordinary agent shape: apostrophe prose then one more command (R5b real)", () => {
    // The shape that makes this worth fixing at all — `cat <<EOF` writing a note
    // containing an English apostrophe, then a following command line.
    const result = runHook(
      withTail(UNQUOTED_CAT_HEREDOC, "it's fine", `echo ${SUBSTITUTION}`)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a $(touch) after a partially-quoted body line (R5b full)", () => {
    const result = runHook(
      withTail(UNQUOTED_CAT_HEREDOC, "'foo", SUBSTITUTION)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a backtick substitution after apostrophe prose (R5b bt)", () => {
    const result = runHook(
      withTail(
        UNQUOTED_CAT_HEREDOC,
        "it's fine",
        `${BACKTICK}touch heredoc-1993-R5bbt-sentinel${BACKTICK}`
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks with THREE apostrophes — any odd count poisons the scanner (R5b odd-3)", () => {
    const result = runHook(
      withTail(UNQUOTED_CAT_HEREDOC, "it's o'clock'", SUBSTITUTION)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks an apostrophe combined with a body # comment marker (R5b sq+hash)", () => {
    const result = runHook(
      withTail(UNQUOTED_CAT_HEREDOC, "it's # note", SUBSTITUTION)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });
});

describe("poison-family controls: the trigger is precisely an ODD apostrophe count (issue #1993 R5b)", () => {
  // Each body below leaves the flat scanner's quote state CORRECT, so each was
  // already BLOCKED before the fix. They must stay blocked: if one of these ever
  // flips to ALLOWED, a body-neutralizing change has over-generalized and is
  // hiding substitutions the flat scan was legitimately catching.
  const controls: ReadonlyArray<readonly [string, string]> = [
    ["a plain body with no quote bytes", "body"],
    ["an EVEN apostrophe count", "it's fine'"],
    ["an odd DOUBLE quote", 'say "hi'],
    ["a lone # comment marker", "# note"],
    ["an ANSI-C $'a token", "x $'a"],
    ["an escaped backslash pair", `back${BACKSLASH}${BACKSLASH}slash`],
  ];

  for (const [label, body] of controls) {
    it(`still blocks a following $(touch) behind ${label}`, () => {
      const result = runHook(
        withTail(UNQUOTED_CAT_HEREDOC, body, SUBSTITUTION)
      );
      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain(HEREDOC_WALL_REASON);
    });
  }
});

describe("a backslash-quoted delimiter is a modelled quoted here-doc (issue #1993 R5c)", () => {
  it("blocks a $(touch) after an apostrophe body under <<\\EOF (R5c)", () => {
    const result = runHook(
      withTail(BACKSLASH_QUOTED_HEREDOC, "it's", SUBSTITUTION)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a backtick after an apostrophe body under <<\\EOF (R5c bt)", () => {
    const result = runHook(
      withTail(
        BACKSLASH_QUOTED_HEREDOC,
        "it's",
        `${BACKTICK}touch heredoc-1993-R5cbt-sentinel${BACKTICK}`
      )
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still blocks the same shape with NO apostrophe (R5c control)", () => {
    // Pins the trigger to the apostrophe, exactly as in the R5b table.
    const result = runHook(
      withTail(BACKSLASH_QUOTED_HEREDOC, "plain body", SUBSTITUTION)
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });
});

describe("R5c's accepted over-block: <<\\EOF is quoted for BODY semantics, not for the writer path", () => {
  // Recording a Marker for `<<\EOF` (which R5c requires — no Marker meant no body
  // window to neutralize) also arms the writer-owns-a-real-marker rule and the
  // multi-marker rule. These three commands are valid, harmless bash that moved
  // from UNSUPPORTED(10) to MALFORMED(20). That is a REAL over-block, accepted
  // deliberately rather than silently: `classify_safe` demands the literal
  // `<<'DELIM'` spelling, so `<<\EOF` could never reach the SAFE payload-strip
  // path regardless. `Marker.quoted` therefore means "bash makes this body
  // literal" and NOT "this is interchangeable with `<<'EOF'` everywhere" — the
  // documented payload-strip workaround stays spelled `<<'EOF'`, pinned by the
  // last test here. Widening `classify_safe` needs its own proof.
  const overBlocked: ReadonlyArray<readonly [string, readonly string[]]> = [
    [
      "a gh issue writer using a backslash-quoted delimiter",
      ["gh issue create --title t --body-file - <<\\EOF", "hello", "EOF"],
    ],
    [
      "a gh pr comment writer using a backslash-quoted delimiter",
      ["gh pr comment 1 --body-file - <<\\EOF", "hello", "EOF"],
    ],
    [
      "two here-docs where the first delimiter is backslash-quoted",
      ["cat <<\\A <<B", "x", "A", "y", "B"],
    ],
  ];

  for (const [label, lines] of overBlocked) {
    it(`fails closed on ${label} (accepted over-block)`, () => {
      expect(runHook(lines.join("\n")).status).toBe(EXIT_BLOCKED);
    });
  }

  it("keeps the documented <<'EOF' writer workaround working", () => {
    // The counterpart that must NOT regress: the quote-pair spelling is the one
    // `classify_safe` recognizes, and it still reaches the SAFE strip path.
    const command = [
      "gh issue create --title t --body-file - <<'EOF'",
      "hello",
      "EOF",
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });
});

describe("body neutralization must not over-block ordinary payloads (issue #1993)", () => {
  it("allows apostrophe prose with nothing after the terminator", () => {
    const command = [
      UNQUOTED_CAT_HEREDOC,
      "it's fine",
      HEREDOC_TERMINATOR,
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("allows apostrophe prose followed by an ordinary command", () => {
    const result = runHook(
      withTail(UNQUOTED_CAT_HEREDOC, "it's fine", "echo done")
    );
    expect(result.status).toBe(EXIT_ALLOWED);
  });

  it("allows a tab-stripped <<-EOF body containing an apostrophe", () => {
    const command = ["cat <<-EOF", "\tit's fine", "\tEOF"].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("allows a literal $(...) inside a fully quoted <<'EOF' body", () => {
    // The Finding-1 literal-payload win: a quoted body is genuinely inert to
    // bash, and neutralizing bodies must not disturb that.
    const command = [
      `cat <<'${HEREDOC_TERMINATOR}'`,
      SUBSTITUTION,
      HEREDOC_TERMINATOR,
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("allows an unexpanded $HOME reference in an unquoted body", () => {
    const command = [
      UNQUOTED_CAT_HEREDOC,
      "path is $HOME",
      HEREDOC_TERMINATOR,
    ].join("\n");
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });
});

describe("the content guards remain the real backstop (issue #1993 severity)", () => {
  // Neutralizing a body must never hide a DESTRUCTIVE payload from the content
  // guards, which scan the raw command text. These are the rows that make a
  // here-doc-wall miss defence-in-depth rather than an RCE.
  const destructive: ReadonlyArray<readonly [string, string]> = [
    ["rm -rf of a root path", "$(rm -rf /)"],
    ["rm -rf of a home path", "$(rm -rf ~/)"],
    ["destructive SQL", '$(psql -c "DROP TABLE users")'],
  ];

  for (const [label, payload] of destructive) {
    it(`blocks ${label} placed after an apostrophe body`, () => {
      const result = runHook(
        withTail(UNQUOTED_CAT_HEREDOC, "it's fine", payload)
      );
      expect(result.status).toBe(EXIT_BLOCKED);
    });
  }
});

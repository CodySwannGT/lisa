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

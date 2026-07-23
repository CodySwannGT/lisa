/**
 * Adversarial heredoc grammar regressions for the parity safety net.
 *
 * Shell quote concatenation must be normalized before deciding whether a
 * GitHub writer owns a heredoc marker. Otherwise executable input can be
 * mistaken for prose, or an unsafe compound command can appear to be a safe
 * writer.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_BLOCKED = 2;
const HEREDOC_TERMINATOR = "EOF";
const COMMENTED_MARKER = "gh issue create --body-file - # <<'EOF'";
const HARMLESS_PROSE = "harmless prose";
const OBFUSCATED_DELETE = "r''m -rf /";

const runHook = (
  command: string,
  options: { env?: NodeJS.ProcessEnv } = {}
): { status: number | null; stderr: string } => {
  const result = spawnSync("/bin/bash", [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  return { status: result.status, stderr: result.stderr };
};

describe("parity-safety-net heredoc grammar", () => {
  it("blocks an obfuscated command after a commented writer marker", () => {
    const command = [
      COMMENTED_MARKER,
      OBFUSCATED_DELETE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("normalizes a quote-concatenated writer before comment classification", () => {
    const command = [
      "g''h issue create --body-file - # <<'EOF'",
      OBFUSCATED_DELETE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("blocks another command before an otherwise safe writer", () => {
    const command = [
      "echo prefix; gh issue create --body-file - <<'EOF'",
      HARMLESS_PROSE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("normalizes quote-concatenated commands in a prefixed writer", () => {
    const command = [
      "e''cho prefix; g''h issue create --body-file - <<'EOF'",
      HARMLESS_PROSE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it.each([
    "g\\\nh issue create --body-file - <<'EOF'",
    "gh issue \\\ncreate --body-file - <<'EOF'",
    "g\"\\\n\"h issue create --body-file - <<'EOF'",
  ])("blocks a continued writer that misses the exact grammar", header => {
    const command = [header, HARMLESS_PROSE, HEREDOC_TERMINATOR].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("blocks a continued writer with a commented fake marker", () => {
    const command = [
      "g\"\\\n\"h issue create --body-file - # <<'EOF'",
      OBFUSCATED_DELETE,
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("allows inert quoted executable heredoc payloads to reach guard scanning", () => {
    const command = [
      "python3 <<'EOF'",
      "print('Document `status:ready` and $(literal) without shell expansion')",
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command).status).toBe(0);
  });

  it("still applies custom rules to inert quoted executable heredoc payloads", () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "lisa-safety-rule-"));
    const rulesPath = path.join(fixture, "rules.txt");
    try {
      writeFileSync(rulesPath, "DO_NOT_EXECUTE\n");
      const command = [
        "python3 <<'EOF'",
        "print('DO_NOT_EXECUTE')",
        HEREDOC_TERMINATOR,
      ].join("\n");

      expect(
        runHook(command, {
          env: { SAFETY_NET_RULES_FILE: rulesPath },
        }).status
      ).toBe(EXIT_BLOCKED);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("uses commit-specific remediation only for git commit heredoc denials", () => {
    const commitCommand = [
      'git commit -m "$(cat <<EOF',
      "message",
      HEREDOC_TERMINATOR,
      ')"',
    ].join("\n");
    const scriptCommand = [
      "python3 <<EOF",
      "`status:ready`",
      HEREDOC_TERMINATOR,
    ].join("\n");

    const commit = runHook(commitCommand);
    const script = runHook(scriptCommand);

    expect(commit.status).toBe(EXIT_BLOCKED);
    expect(commit.stderr).toContain("git commit -F <file>");
    expect(script.status).toBe(EXIT_BLOCKED);
    expect(script.stderr).toContain("write the payload to a file");
    expect(script.stderr).not.toContain("git commit -F <file>");
  });
});

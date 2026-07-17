/**
 * Adversarial heredoc grammar regressions for the parity safety net.
 *
 * Shell quote concatenation must be normalized before deciding whether a
 * GitHub writer owns a heredoc marker. Otherwise executable input can be
 * mistaken for prose, or an unsafe compound command can appear to be a safe
 * writer.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const EXIT_BLOCKED = 2;
const HEREDOC_TERMINATOR = "EOF";
const COMMENTED_MARKER = "gh issue create --body-file - # <<'EOF'";

const runHook = (command: string): number | null =>
  spawnSync("/bin/bash", [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
  }).status;

describe("parity-safety-net heredoc grammar", () => {
  it("blocks an obfuscated command after a commented writer marker", () => {
    const command = [COMMENTED_MARKER, "r''m -rf /", HEREDOC_TERMINATOR].join(
      "\n"
    );

    expect(runHook(command)).toBe(EXIT_BLOCKED);
  });

  it("normalizes a quote-concatenated writer before comment classification", () => {
    const command = [
      "g''h issue create --body-file - # <<'EOF'",
      "r''m -rf /",
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command)).toBe(EXIT_BLOCKED);
  });

  it("blocks another command before an otherwise safe writer", () => {
    const command = [
      "echo prefix; gh issue create --body-file - <<'EOF'",
      "harmless prose",
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command)).toBe(EXIT_BLOCKED);
  });

  it("normalizes quote-concatenated commands in a prefixed writer", () => {
    const command = [
      "e''cho prefix; g''h issue create --body-file - <<'EOF'",
      "harmless prose",
      HEREDOC_TERMINATOR,
    ].join("\n");

    expect(runHook(command)).toBe(EXIT_BLOCKED);
  });
});

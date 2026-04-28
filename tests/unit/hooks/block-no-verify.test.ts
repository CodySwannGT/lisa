/**
 * Tests for the block-no-verify.sh hook behavior.
 *
 * The hook blocks any Bash command containing --no-verify to prevent
 * bypassing pre-commit/pre-push hooks. It must match all syntactic
 * positions of --no-verify (standalone, in subshells, etc.) while
 * excluding longer flags like --no-verify-ssl.
 * @module tests/unit/hooks/block-no-verify
 */
import { spawnSync } from "child_process";
import path from "path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (
  toolName: string,
  command: string
): { status: number | null; stderr: string } => {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  });

  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    input,
    encoding: "utf-8",
  });

  return { status: result.status, stderr: result.stderr };
};

describe("block-no-verify.sh", () => {
  describe("blocks commands with --no-verify", () => {
    it("blocks a simple git commit --no-verify", () => {
      const { status } = runHook("Bash", "git commit --no-verify");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify followed by additional flags", () => {
      const { status } = runHook("Bash", 'git commit --no-verify -m "bypass"');
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify inside a subshell with parentheses", () => {
      // Regression: `)` after --no-verify was not in the old allowed boundary
      // set, allowing (git commit --no-verify) to bypass the check.
      const { status } = runHook("Bash", "(git commit --no-verify)");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify at end of a conditional expression", () => {
      const { status } = runHook(
        "Bash",
        "[[ $var = --no-verify ]] && git commit --no-verify"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify followed by semicolon", () => {
      const { status } = runHook("Bash", "git commit --no-verify; echo done");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks --no-verify followed by pipe", () => {
      const { status } = runHook(
        "Bash",
        "git commit --no-verify | tee output.txt"
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks standalone --no-verify at end of string", () => {
      const { status } = runHook("Bash", "git push --no-verify");
      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows commands without --no-verify", () => {
    it("allows git commit without --no-verify", () => {
      const { status } = runHook("Bash", 'git commit -m "normal commit"');
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --no-verify-ssl (longer flag)", () => {
      const { status } = runHook(
        "Bash",
        "curl --no-verify-ssl https://example.com"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --no-verify-host (longer flag)", () => {
      const { status } = runHook("Bash", "ssh --no-verify-host user@host");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("ignores non-Bash tools", () => {
    it("allows non-Bash tools even with --no-verify in input", () => {
      const { status } = runHook("Read", "git commit --no-verify");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows Write tool even with --no-verify in input", () => {
      const { status } = runHook("Write", "--no-verify");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

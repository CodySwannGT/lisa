/**
 * Tests for the force-push guard in parity-safety-net.sh.
 *
 * The guard blocks force-pushing a protected branch (main/master/production/
 * prod/release) while allowing the safe `--force-with-lease`. The force flag and
 * the protected-branch name must appear in the SAME `git push` statement —
 * checking them independently across the whole command false-positives on an
 * unrelated `-f` (a `[ -f file ]` test, `rm -f`, `grep -f`) plus an unrelated
 * protected name (`--base main`, `origin/main`) sitting next to a feature-branch
 * push. These tests lock in that correlation.
 * @module tests/unit/hooks/parity-safety-net
 */
import { spawnSync } from "child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const DIRECT_ISSUE_HEREDOC = "gh issue create --body-file - <<'EOF'";
const HEREDOC_TERMINATOR = "EOF";
const DESTRUCTIVE_DELETE = "rm -rf /";
const PROTECTED_FORCE_PUSH = "git push --force origin main";

const runHook = (
  toolName: string,
  command: string,
  options: { hookPath?: string; env?: NodeJS.ProcessEnv } = {}
): { status: number | null; stderr: string } => {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  });
  const result = spawnSync(BASH_PATH, [options.hookPath ?? HOOK_PATH], {
    input,
    encoding: "utf-8",
    env: { ...process.env, ...options.env },
  });
  return { status: result.status, stderr: result.stderr };
};

describe("parity-safety-net.sh — force-push guard", () => {
  describe("ignores prose-only heredoc payloads", () => {
    it("allows a direct issue body that quotes every built-in destructive form", () => {
      const cmd = [
        DIRECT_ISSUE_HEREDOC,
        DESTRUCTIVE_DELETE,
        PROTECTED_FORCE_PUSH,
        "git reset --hard",
        "DROP TABLE users",
        HEREDOC_TERMINATOR,
      ].join("\n");

      expect(runHook("Bash", cmd).status).toBe(EXIT_ALLOWED);
    });

    it("allows the exact quoted --body cat-substitution form", () => {
      const cmd = [
        "gh pr comment 1678 --body \"$(cat <<'EOF'",
        "Document `rm -rf /` without executing it.",
        HEREDOC_TERMINATOR,
        ')"',
      ].join("\n");

      expect(runHook("Bash", cmd).status).toBe(EXIT_ALLOWED);
    });

    it("blocks destructive executable bash and python heredocs", () => {
      for (const interpreter of ["bash", "python3"]) {
        const cmd = [
          `${interpreter} <<'EOF'`,
          DESTRUCTIVE_DELETE,
          HEREDOC_TERMINATOR,
        ].join("\n");
        const result = runHook("Bash", cmd);
        expect(result.status).toBe(EXIT_BLOCKED);
        // The quoted payload is literal data to bash, so the block must come
        // from the content guard scanning the raw payload — not the heredoc
        // wall (issue #1958 F2).
        expect(result.stderr).toContain("recursive forced delete");
      }
    });

    it("blocks a destructive command following a quoted fake marker", () => {
      const cmd = ['echo "hello <<MARKER"', DESTRUCTIVE_DELETE, "MARKER"].join(
        "\n"
      );

      expect(runHook("Bash", cmd).status).toBe(EXIT_BLOCKED);
    });

    it("does not exempt a heredoc-looking marker after a shell comment", () => {
      const cmd = [
        "gh issue create --body-file - # <<'EOF'",
        DESTRUCTIVE_DELETE,
        HEREDOC_TERMINATOR,
      ].join("\n");
      expect(runHook("Bash", cmd).status).toBe(EXIT_BLOCKED);
    });

    it("allows harmless quoted operator and substitution prose", () => {
      expect(
        runHook(
          "Bash",
          "gh issue create --title 'Document C++ << operators' --body harmless"
        ).status
      ).toBe(EXIT_ALLOWED);
      expect(
        runHook("Bash", "echo 'Discuss $(name), `ticks`, and << operators'")
          .status
      ).toBe(EXIT_ALLOWED);
    });

    it("blocks an unquoted expanding heredoc", () => {
      const cmd = [
        "gh issue create --body-file - <<EOF",
        "$(rm -rf /)",
        HEREDOC_TERMINATOR,
      ].join("\n");
      expect(runHook("Bash", cmd).status).toBe(EXIT_BLOCKED);
    });

    it.each([
      [
        "multiple heredocs",
        ["cat <<'A' <<'B'", "one", "A", "two", "B"].join("\n"),
      ],
      ["unclosed heredoc", [DIRECT_ISSUE_HEREDOC, "prose"].join("\n")],
      [
        "trailing command",
        [DIRECT_ISSUE_HEREDOC, "prose", HEREDOC_TERMINATOR, "echo done"].join(
          "\n"
        ),
      ],
      [
        "piped writer",
        [
          "gh issue create --body-file - <<'EOF' | bash",
          DESTRUCTIVE_DELETE,
          HEREDOC_TERMINATOR,
        ].join("\n"),
      ],
      [
        "writer chained on its header",
        [
          "gh issue create --body-file - <<'EOF'; echo done",
          "prose",
          HEREDOC_TERMINATOR,
        ].join("\n"),
      ],
      [
        "destructive command before a writer",
        [
          DESTRUCTIVE_DELETE,
          DIRECT_ISSUE_HEREDOC,
          "prose",
          HEREDOC_TERMINATOR,
        ].join("\n"),
      ],
    ])("fails closed for %s", (_name, cmd) => {
      expect(runHook("Bash", cmd).status).toBe(EXIT_BLOCKED);
    });

    it("fails closed when the parser is missing or crashes", () => {
      const fixture = mkdtempSync(path.join(tmpdir(), "lisa-safety-net-"));
      const hookPath = path.join(fixture, "parity-safety-net.sh");
      const parserPath = path.join(fixture, "parity-safety-net-heredoc.py");
      try {
        copyFileSync(HOOK_PATH, hookPath);
        chmodSync(hookPath, 0o755);
        const cmd = [
          DIRECT_ISSUE_HEREDOC,
          "harmless prose",
          HEREDOC_TERMINATOR,
        ].join("\n");
        expect(runHook("Bash", cmd, { hookPath }).status).toBe(EXIT_BLOCKED);

        writeFileSync(parserPath, "raise RuntimeError('parser crash')\n");
        expect(runHook("Bash", cmd, { hookPath }).status).toBe(EXIT_BLOCKED);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });

    it("keeps custom rules active outside the exempt payload", () => {
      const fixture = mkdtempSync(path.join(tmpdir(), "lisa-safety-rule-"));
      const rulesPath = path.join(fixture, "rules.txt");
      try {
        writeFileSync(rulesPath, "DO_NOT_EXECUTE\n");
        const safeBody = [
          "gh issue comment 1594 --body-file - <<'EOF'",
          "DO_NOT_EXECUTE is documentation.",
          HEREDOC_TERMINATOR,
        ].join("\n");
        expect(
          runHook("Bash", safeBody, {
            env: { SAFETY_NET_RULES_FILE: rulesPath },
          }).status
        ).toBe(EXIT_ALLOWED);
        expect(
          runHook("Bash", "echo DO_NOT_EXECUTE", {
            env: { SAFETY_NET_RULES_FILE: rulesPath },
          }).status
        ).toBe(EXIT_BLOCKED);
        const executableBody = [
          "bash <<'EOF'",
          "DO_NOT_EXECUTE",
          HEREDOC_TERMINATOR,
        ].join("\n");
        expect(
          runHook("Bash", executableBody, {
            env: { SAFETY_NET_RULES_FILE: rulesPath },
          }).status
        ).toBe(EXIT_BLOCKED);
        const commentFakeMarker = [
          "gh issue create --body-file - # <<'EOF'",
          "DO_NOT_EXECUTE",
          HEREDOC_TERMINATOR,
        ].join("\n");
        expect(
          runHook("Bash", commentFakeMarker, {
            env: { SAFETY_NET_RULES_FILE: rulesPath },
          }).status
        ).toBe(EXIT_BLOCKED);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });

    it("leaves ordinary non-heredoc commands unchanged", () => {
      expect(runHook("Bash", "echo ordinary").status).toBe(EXIT_ALLOWED);
      expect(runHook("Bash", DESTRUCTIVE_DELETE).status).toBe(EXIT_BLOCKED);
    });

    it("is valid syntax on the system Bash", () => {
      expect(spawnSync(BASH_PATH, ["-n", HOOK_PATH]).status).toBe(EXIT_ALLOWED);
    });
  });

  describe("blocks force-pushing a protected branch", () => {
    it("blocks git push --force origin main", () => {
      expect(runHook("Bash", PROTECTED_FORCE_PUSH).status).toBe(EXIT_BLOCKED);
    });

    it("blocks git push -f origin master", () => {
      expect(runHook("Bash", "git push -f origin master").status).toBe(
        EXIT_BLOCKED
      );
    });

    it("blocks force-push to production", () => {
      expect(runHook("Bash", "git push --force origin production").status).toBe(
        EXIT_BLOCKED
      );
    });

    it("blocks force-push to release", () => {
      expect(runHook("Bash", "git push --force origin release").status).toBe(
        EXIT_BLOCKED
      );
    });

    it("blocks a force-push to main inside a subshell / chain", () => {
      expect(
        runHook("Bash", "cd /repo && git push --force origin main").status
      ).toBe(EXIT_BLOCKED);
    });

    it("blocks force-push to main via the HEAD:main refspec", () => {
      expect(runHook("Bash", "git push --force origin HEAD:main").status).toBe(
        EXIT_BLOCKED
      );
    });

    it("blocks force-push to main when command uses backslash-newline continuation", () => {
      // "git push --force origin \\\nmain" has a bash line continuation
      // (backslash + newline) that could split the command across two segments
      // before the branch name is evaluated, bypassing the protection.
      expect(runHook("Bash", "git push --force origin \\\nmain").status).toBe(
        EXIT_BLOCKED
      );
    });

    it("blocks force-push to main via HEAD:main with backslash-newline continuation", () => {
      expect(
        runHook("Bash", "git push --force origin \\\nHEAD:main").status
      ).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows safe pushes (no cross-statement false positives)", () => {
    it("allows a feature-branch push alongside a [ -f ] test and --base main", () => {
      // The exact false positive: feature push + `-f` from a file test + `main`
      // from `--base main`, none of which is a force-push to a protected branch.
      const cmd =
        "git push -u origin chore/foo; [ -f package-lock.json ] && echo hi; " +
        "gh pr create --base main --head chore/foo";
      expect(runHook("Bash", cmd).status).toBe(EXIT_ALLOWED);
    });

    it("allows a subshell feature-branch push piped to tail", () => {
      expect(
        runHook("Bash", '( cd /x && git push -u origin "$BR" 2>&1 | tail -3 )')
          .status
      ).toBe(EXIT_ALLOWED);
    });

    it("allows --force-with-lease to main", () => {
      expect(
        runHook("Bash", "git push --force-with-lease origin main").status
      ).toBe(EXIT_ALLOWED);
    });

    it("allows a non-force push to main", () => {
      expect(runHook("Bash", "git push origin main").status).toBe(EXIT_ALLOWED);
    });

    it("allows force-pushing a feature branch whose name contains main", () => {
      expect(
        runHook("Bash", "git push --force origin feature/main-thing").status
      ).toBe(EXIT_ALLOWED);
    });

    it("allows rm -f next to a feature-branch push", () => {
      expect(
        runHook("Bash", "rm -f stale.txt && git push -u origin feature/x")
          .status
      ).toBe(EXIT_ALLOWED);
    });

    it("allows git fetch origin main next to a [ -f ] test (no push at all)", () => {
      expect(
        runHook("Bash", "git fetch origin main; [ -f x ] && echo y").status
      ).toBe(EXIT_ALLOWED);
    });
  });

  describe("ignores non-Bash tools", () => {
    it("allows a non-Bash tool even with force-push text in input", () => {
      expect(runHook("Read", PROTECTED_FORCE_PUSH).status).toBe(EXIT_ALLOWED);
    });
  });
});

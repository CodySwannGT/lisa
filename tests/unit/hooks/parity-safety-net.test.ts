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
import path from "path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
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

describe("parity-safety-net.sh — force-push guard", () => {
  describe("blocks force-pushing a protected branch", () => {
    it("blocks git push --force origin main", () => {
      expect(runHook("Bash", "git push --force origin main").status).toBe(
        EXIT_BLOCKED
      );
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
      expect(runHook("Read", "git push --force origin main").status).toBe(
        EXIT_ALLOWED
      );
    });
  });
});

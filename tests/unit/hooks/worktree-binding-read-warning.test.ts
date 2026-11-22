/**
 * Warn on reads, refuse writes, in a mismatched worktree (CodySwannGT/lisa#4816).
 *
 * The guard refused EVERY guarded call while a session's bound worktree and
 * the worktree its call ran in disagreed. Only a write can damage another
 * session's work, so a provable read now passes with a non-blocking warning
 * naming both trees, while every write — and every command the guard cannot
 * classify — is refused exactly as before.
 *
 * Each allowing case here is paired with the refusal one changed fact would
 * produce, because a suite that only proves "reads pass" passes against a guard
 * that refuses nothing.
 * @module tests/unit/hooks/worktree-binding-read-warning
 */
import { realpathSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  type Fixture,
  runGuard,
} from "./support/worktree-binding.js";

/** The marker the read warning carries and no refusal does. */
const READ_WARNING = "allowed a READ-ONLY command";

/** The displacement refusal's first line, unchanged by #4816. */
const DISPLACED = "this session's worktree changed underneath it";

/** The read the issue names first. */
const GIT_STATUS = "git status";

/** Claude Code's runtime marker: the one runtime that reads the JSON channel. */
const CLAUDE = { CLAUDECODE: "1" } as const;

/**
 * Run one Bash command from worktree B in a session bound to worktree A.
 * @param fixture - Repository under test, already bound to A
 * @param command - Bash command the session is about to run
 * @param runtime - Runtime variables to set for the guard
 * @returns The completed spawn
 */
function displacedBash(
  fixture: Fixture,
  command: string,
  runtime?: Readonly<Record<string, string>>
) {
  return runGuard({
    cwd: fixture.b,
    state: fixture.state,
    input: { command },
    ...(runtime === undefined ? {} : { runtime }),
  });
}

describe("worktree-binding-guard on a mismatched worktree", () => {
  it.each([
    GIT_STATUS,
    "rg foo",
    "git log --oneline -5 | head -3",
    "git diff HEAD --stat",
    "git show HEAD:seed.txt",
    "ls -la 2>/dev/null",
    "cat seed.txt | wc -l",
    "sed -n '1,20p' seed.txt",
    "git branch --show-current",
    "git worktree list",
    "find . -name '*.txt' -print0 | xargs -0 wc -l",
  ])("allows the read %j and warns, naming both worktrees", command => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = displacedBash(fixture, command);
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain(READ_WARNING);
    expect(result.stderr).toContain(`bound to:  ${realpathSync(fixture.a)}`);
    expect(result.stderr).toMatch(/acting in: \S*wt-b/u);
    expect(result.stderr).toContain("Another session may own");
  });

  it("puts the warning in the agent's context on Claude Code, without granting permission", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = displacedBash(fixture, GIT_STATUS, CLAUDE);
    expect(result.status).toBe(ALLOWED);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    const context: string = output.hookSpecificOutput.additionalContext;
    expect(context).toContain(READ_WARNING);
    expect(context).toContain(realpathSync(fixture.a));
    expect(context).toMatch(/wt-b/u);
    expect(context).toContain("Another session may own");
    // "allow" would also skip the user's permission prompt — a wider grant.
    expect(output.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it.each([
    ["git commit", "git commit -m change"],
    ["file write", "echo change > seed.txt"],
    ["append redirection", "echo change >> seed.txt"],
    ["file creation", "touch new.txt"],
    ["git reset", "git reset --hard"],
    ["git checkout", "git checkout -- seed.txt"],
    ["git switch", "git switch -c other"],
    ["git merge", "git merge branch-a"],
    ["git rebase", "git rebase main"],
    ["git push", "git push origin HEAD"],
    ["git stash", "git stash"],
    ["git clean", "git clean -fd"],
    ["git restore", "git restore seed.txt"],
    ["git rm", "git rm seed.txt"],
    ["git mv", "git mv seed.txt moved.txt"],
    ["git add", "git add ."],
    ["git branch create", "git branch created"],
    ["package install", "bun install"],
    ["package add", "pnpm add left-pad"],
    ["package remove", "yarn remove left-pad"],
    ["package update", "npm update"],
    ["script execution", "bash ./build.sh"],
    ["file execution", "./build.sh"],
    ["test run", "bun run test"],
    ["sed in place", "sed -i 's/a/b/' seed.txt"],
    ["sed write command", "sed -n 'w out.txt' seed.txt"],
    ["find delete", "find . -name '*.tmp' -delete"],
    ["sort output file", "sort -o out.txt seed.txt"],
    ["read then write", "git status && touch new.txt"],
  ])("still refuses a %s exactly as before", (_label, command) => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = displacedBash(fixture, command, CLAUDE);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain(DISPLACED);
    expect(result.stderr).toMatch(/echo 'lisa-worktree-binding: accept /u);
    expect(result.stderr).not.toContain(READ_WARNING);
    expect(result.stdout).toBe("");
  });

  it.each(["Write", "Edit", "MultiEdit"])(
    "still refuses a %s into the mismatched tree",
    tool => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      const result = runGuard({
        cwd: fixture.b,
        state: fixture.state,
        tool,
        input: { file_path: path.join(fixture.b, "seed.txt"), content: "x" },
        runtime: CLAUDE,
      });
      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain(DISPLACED);
      expect(result.stdout).toBe("");
    }
  );

  it.each([
    ["command substitution", "cat $(git ls-files)"],
    ["backticks", "cat `git ls-files`"],
    ["subshell", "(git status)"],
    ["here-document", "cat <<'EOF'\nx\nEOF"],
    ["process substitution", "diff <(ls) <(ls)"],
    ["unknown program", "frobnicate --dry-run"],
    ["eval", "eval git status"],
    ["environment prefix", "FOO=1 git status"],
    ["dynamic command word", '"$TOOL" status'],
    ["path to a program", "/bin/cat seed.txt"],
    ["unterminated quote", "git log --format='%H"],
    ["xargs into a writer", "git ls-files | xargs rm"],
    ["executing grep preprocessor", "rg --pre=./decode foo"],
    ["git config injection", "git -c core.fsmonitor=./x status"],
    ["hidden option", 'rg foo "$OPTS"'],
  ])("refuses the unclassifiable %s as a write", (_label, command) => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = displacedBash(fixture, command, CLAUDE);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain(DISPLACED);
    expect(result.stdout).toBe("");
  });

  it.each([GIT_STATUS, "touch new.txt", "bun install"])(
    "neither warns nor refuses %j in a matched session",
    command => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      const result = runGuard({
        cwd: fixture.a,
        state: fixture.state,
        input: { command },
        runtime: CLAUDE,
      });
      expect(result.status).toBe(ALLOWED);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
    }
  );

  it("warns a read and refuses a write after an EnterWorktree switch that did not take effect", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      input: { path: fixture.b },
    });
    const read = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      input: { command: GIT_STATUS },
    });
    expect(read.status).toBe(ALLOWED);
    expect(read.stderr).toContain(READ_WARNING);
    expect(read.stderr).toMatch(/EnterWorktree claimed: \S*wt-b/u);
    expect(read.stderr).toMatch(/acting in: \S*wt-a/u);
    const write = runGuard({ cwd: fixture.a, state: fixture.state });
    expect(write.status).toBe(BLOCKED);
    expect(write.stderr).toContain("EnterWorktree reported success");
  });

  it("keeps refusing writes after any number of allowed reads", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    for (const command of [GIT_STATUS, "ls", "rg foo"]) {
      expect(displacedBash(fixture, command).status).toBe(ALLOWED);
    }
    expect(displacedBash(fixture, "git commit -m x").status).toBe(BLOCKED);
  });
});

/**
 * Execution-versus-argument boundary for `block-direct-issue-create.sh`.
 *
 * The guard was taught to read files so a creation moved into a script could
 * not hide from it, and the fix over-widened: it opened any readable file named
 * by ANY argument and attributed the contents to the command. Two refusals in
 * one session, both while doing ordinary work:
 *
 *   grep -n <pattern> <a guard>.sh   — the guard opened what grep was reading
 *   gh issue edit … --body-file b.md — b.md quoted a source path as prose in a
 *                                      fenced code block, and the guard opened
 *                                      that file too and judged the edit by it
 *
 * Rewriting the second body to cite the containing DIRECTORIES instead of the
 * files cleared it immediately, which isolates the trigger to the path form
 * alone. Neither file was executed by either command.
 *
 * The direction of the error is what makes it expensive: it fires hardest on
 * reading a hook's source and on filing a bug report that quotes file paths,
 * which are the two things someone does while investigating a hook.
 *
 * So this file pins the boundary from both sides at once — a file a command
 * RUNS is read, a file a command merely NAMES is not — because either half
 * alone is trivially satisfiable by a guard that is useless in the other
 * direction. The same rule ships in `parity-safety-net.sh`; two guards in one
 * fleet with two different notions of "executes" would be its own defect.
 * @module tests/unit/hooks/block-direct-issue-create-follow-execution
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A Linear-tracked project, whose build-ready role is a workflow state. */
const LINEAR_CONFIG = {
  linear: { workflow: { ready: "Ready" } },
  tracker: "linear",
};

/** The GraphQL body a hand-rolled Linear creation submits. */
const LINEAR_MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

/** A shell script that files a Linear issue and declares nothing. */
const UNDECLARED_SCRIPT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "curl -sS -X POST https://api.linear.app/graphql \\",
  `  -d '${LINEAR_MUTATION}'`,
  "",
].join("\n");

/** The name every fixture script is written under. */
const SCRIPT_FILE = "filer.sh";

/**
 * Write a file into a throwaway project directory.
 * @param cwd - The project directory.
 * @param name - The file name.
 * @param body - The contents.
 * @returns The absolute path written.
 */
const fixture = (cwd: string, name: string, body: string): string => {
  const target = path.join(cwd, name);
  writeFileSync(target, body, "utf-8");
  return target;
};

/**
 * A project holding one undeclared creation script.
 * @returns The project directory and the script's absolute path.
 */
const projectWithScript = (): { cwd: string; script: string } => {
  const cwd = projectWithTracker(LINEAR_CONFIG);
  return { cwd, script: fixture(cwd, SCRIPT_FILE, UNDECLARED_SCRIPT) };
};

describe("block-direct-issue-create.sh execution boundary", () => {
  describe("a file a command merely NAMES is not read", () => {
    // Reproduction 1, verbatim in shape: the refusal named the file grep was
    // reading and told the caller to add a label to a filing that was never
    // attempted.
    it("allows a grep of a script that contains an undeclared creation", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`grep -n curl ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it.each([
      ["cat", "cat"],
      ["head", "head -5"],
      ["tail", "tail -5"],
      ["wc", "wc -l"],
      ["sed without -i", "sed -n 1p"],
      ["git add", "git add"],
      ["a shell mentioning the path in a message", "echo see"],
    ])("allows %s naming the script", (_label, tool) => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`${tool} ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    // Reproduction 2. The nesting is the finding: the guard resolved the
    // markdown as a file operand, re-tokenised its PROSE as argv, found a
    // path-shaped word inside a fenced code block, opened that file too, and
    // attributed its contents to the `gh issue edit`.
    it("allows an issue edit whose body file quotes a path as prose", () => {
      const { cwd, script } = projectWithScript();
      const body = fixture(
        cwd,
        "report.md",
        [
          "# Report",
          "",
          "The filer lives at:",
          "",
          "```",
          script,
          "```",
          "",
        ].join("\n")
      );

      const { status } = runHook(
        bash(`gh issue edit 1 --repo o/r --title x --body-file ${body}`),
        { cwd }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a pull-request body file that quotes such a path", () => {
      const { cwd, script } = projectWithScript();
      const body = fixture(
        cwd,
        "pr.md",
        ["Fixes the filer at:", script, ""].join("\n")
      );

      const { status } = runHook(bash(`gh pr create --body-file ${body}`), {
        cwd,
      });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("a file a command RUNS is still read", () => {
    // The whole point of the reach the guard has. Passes before and after this
    // change, and is the control that says the narrowing did not become a
    // removal.
    it.each([
      ["an interpreter", "bash"],
      ["source", "source"],
      ["the dot builtin", "."],
      ["a wrapper in front of an interpreter", "nice -n 5 bash"],
      ["a script interpreter", "node"],
    ])("refuses %s running the script", (_label, runner) => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`${runner} ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a script piped into an interpreter by cat", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`cat ${script} | bash`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // The separator is load-bearing: without it these are two statements and
    // the interpreter runs nothing.
    it("allows the same two commands separated by a semicolon", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`cat ${script}; bash --version`), {
        cwd,
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("refuses a script redirected into an interpreter", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`bash < ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses an interpreter reached through a nested command string", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash(`bash -c 'bash ${script}'`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a script whose path arrives via a scratch variable", () => {
      const { cwd, script } = projectWithScript();

      const { status } = runHook(bash('bash "$CLAUDE_PROJECT_DIR/filer.sh"'), {
        cwd,
        env: { CLAUDE_PROJECT_DIR: path.dirname(script) },
      });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("what it cannot read, it refuses", () => {
    it.each([
      ["a computed target", 'bash "$SCRIPT_PATH"'],
      ["a target that does not exist", "bash ./absent.sh"],
      ["a dispatcher that builds the invocation", "xargs bash"],
    ])("refuses %s", (_label, command) => {
      const { cwd } = projectWithScript();

      const { status } = runHook(bash(command), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });

    // A truncated scan would report a confident ALLOW about text it never
    // read, so the size cap must refuse rather than skip.
    it("refuses a script past the inspection cap rather than half-scanning it", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(
        cwd,
        "huge.sh",
        `${UNDECLARED_SCRIPT}${"a".repeat(300000)}`
      );

      const { status, stderr } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
      // The REASON, not the remedy paragraph: the refusal body mentions the
      // cap either way, so a looser assertion passed while the size check was
      // mutated out and the file was refused as merely unresolvable.
      expect(stderr).toContain("larger than the 262144-byte inspection cap");
    });

    it("names the unreadable file and does not print the filing remedy", () => {
      const { cwd } = projectWithScript();

      const { stderr } = runHook(bash("bash ./absent.sh"), { cwd });

      expect(stderr).toContain(
        "cannot classify the file this command executes"
      );
      expect(stderr).toContain("./absent.sh");
      expect(stderr).not.toContain("this filing declares no readiness");
    });

    it("stands down for the operator's ambient override", () => {
      const { cwd } = projectWithScript();

      const { status } = runHook(bash('bash "$SCRIPT_PATH"'), {
        cwd,
        env: { LISA_ALLOW_DIRECT_ISSUE_CREATE: "1" },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("a command word that merely resembles a path is not an execution", () => {
    // The negative controls for the fail-closed arm. Refusing on shape alone
    // would deny both of these, and the guard-parity matrix pins them as
    // permitted.
    it.each([
      ["an absolute path to a program that is not here", "/usr/bin/charm x"],
      [
        "a relative path to a program that is not here",
        "./scripts/confirm -rf /",
      ],
      ["an interpreter with no operand at all", "bash --version"],
      ["an interpreter running an inline command string", "bash -c 'echo hi'"],
    ])("allows %s", (_label, command) => {
      const { cwd } = projectWithScript();

      const { status } = runHook(bash(command), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    // A path at a command position is only EVIDENCE of a script; the `#!` line
    // is the proof. Without that gate a data file sitting where a program goes
    // would be scanned as though it ran.
    it("allows a command word naming a readable file with no shebang", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      fixture(
        cwd,
        "runner.txt",
        UNDECLARED_SCRIPT.split("\n").slice(1).join("\n")
      );

      const { status } = runHook(bash("./runner.txt --send"), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows an interpreter fed by a heredoc, which is not a file", () => {
      const { cwd } = projectWithScript();

      const { status } = runHook(bash("bash <<EOF\necho hi\nEOF"), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    // An indirection inside an already-followed script is the documented
    // residual: `source "$(dirname "$0")/lib.sh"` is the universal shell idiom
    // and failing closed on it would refuse most real scripts.
    it("does not fail closed on a computed source inside a followed script", () => {
      const cwd = projectWithTracker(LINEAR_CONFIG);
      const script = fixture(
        cwd,
        "outer.sh",
        [
          "#!/usr/bin/env bash",
          'source "$(dirname "$0")/lib.sh"',
          "echo done",
          "",
        ].join("\n")
      );

      const { status } = runHook(bash(`bash ${script}`), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

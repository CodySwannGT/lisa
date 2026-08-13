/**
 * Tests for block-direct-issue-create.sh — the PreToolUse Bash guard that
 * refuses an ad-hoc tracker-creation command carrying no readiness declaration.
 *
 * The guard exists because prose did not bind. A conformance audit of the ~13
 * issues filed during one working session found 13/13 bypassed the
 * `ready-role-filing` rule, with zero `lisa-track` / `lisa-tracker-write`
 * invocations — eight of them filed *after* the rule merged, several by the
 * agent that wrote it. Over the same window `Co-Authored-By` compliance was
 * 50/50, because a husky `commit-msg` hook enforces it. Lisa's own
 * `learnings-ladder` rule says machine-checkable knowledge belongs at
 * EXECUTABLE-CONTROL; this is that promotion.
 *
 * The three properties these tests pin, in order of how easily each is lost:
 *
 *   1. The refusal fires on the *undeclared* filing and only there. A create
 *      that carries the configured build-ready role, or an explicit
 *      `[lisa-human-gate]` marker (including one living in a `--body-file`),
 *      is the correct outcome and must pass — otherwise the guard blocks
 *      `lisa-github-write-issue` itself and Lisa cannot file anything.
 *   2. Reads and non-create subcommands never fire. `gh issue list`,
 *      `gh issue view`, `gh issue edit`, `gh pr create` and a bare prose
 *      mention are the overwhelming majority of traffic through this matcher.
 *   3. The operator override is honored from the ambient environment and
 *      refused when set inline in the intercepted command. An escape the
 *      governed agent can reach by typing one more token in front of the
 *      command it was just refused is not an escape hatch, it is the prose
 *      problem with extra steps.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  CUSTOM_ROLE,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithoutTracker,
  projectWithTracker,
  runHook,
  UNDECLARED_CREATE,
} from "./support/direct-issue-create.js";

describe("block-direct-issue-create.sh", () => {
  describe("refuses an undeclared direct creation", () => {
    it.each([
      ["gh", `${UNDECLARED_CREATE} --body "y"`],
      ["gh with --repo", 'gh issue create --repo o/r --title "x" --body "y"'],
      [
        "gh with unrelated labels",
        'gh issue create --title "x" --body-file /tmp/b.md --label "type:Bug"',
      ],
      ["linear cli", 'linear issue create --title "x"'],
      ["jira cli", "jira issue create --type Bug --summary x"],
      ["acli", "acli jira workitem create --summary x --type Bug"],
      ["gh api REST", "gh api repos/o/r/issues -f title=x -f body=y"],
      [
        "gh api REST with explicit method",
        "gh api --method POST repos/o/r/issues --input body.json",
      ],
      [
        "gh api graphql",
        "gh api graphql -f query='mutation{createIssue(input:{}){issue{id}}}'",
      ],
      [
        "linear graphql over curl",
        'curl -X POST https://api.linear.app/graphql -d \'{"query":"mutation{issueCreate(input:{}){success}}"}\'',
      ],
      [
        "github rest over curl",
        'curl -X POST https://api.github.com/repos/o/r/issues -d \'{"title":"x"}\'',
      ],
      [
        "jira rest over curl",
        "curl --request POST https://acme.atlassian.net/rest/api/3/issue --data @payload.json",
      ],
      // gh's persistent flags may precede the subcommand: cobra strips them
      // before resolving `create`, and this form was VERIFIED against the real
      // gh (it reaches "must provide --title and --body", i.e. the subcommand
      // resolved). A strict positional matcher missed it entirely.
      [
        "gh with --repo BEFORE the subcommand",
        'gh issue --repo o/r create --title "x" --body "y"',
      ],
      [
        "gh with --repo=value before the subcommand",
        'gh issue --repo=o/r create --title "x"',
      ],
      // A shell wrapper is a command in a string, not argv — the outer argv
      // names bash, so nothing about the create is visible without recursing.
      ["wrapped in bash -c", `bash -c '${UNDECLARED_CREATE}'`],
      ["wrapped in sh -c", `sh -c '${UNDECLARED_CREATE}'`],
      ["after a cd", 'cd /tmp && gh issue create --title "x"'],
      ["inside a subshell", '(gh issue create --title "x")'],
      ["via an absolute path", '/opt/homebrew/bin/gh issue create --title "x"'],
    ])("refuses %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the sanctioned route and both declarations in the refusal", () => {
      const { stderr } = runHook(bash(UNDECLARED_CREATE));

      expect(stderr).toContain("lisa-track");
      expect(stderr).toContain("lisa-tracker-write");
      expect(stderr).toContain("build_ready:");
      expect(stderr).toContain("human_gate:");
    });

    it("names the ready role the project actually configured", () => {
      const cwd = projectWithTracker({
        tracker: "github",
        github: { labels: { build: { ready: CUSTOM_ROLE } } },
      });

      const { stderr } = runHook(bash(UNDECLARED_CREATE), { cwd });

      expect(stderr).toContain(CUSTOM_ROLE);
    });
  });

  describe("never fires on reads or non-create commands", () => {
    it.each([
      ["issue list", "gh issue list --repo o/r --state open"],
      ["issue view", "gh issue view 123 --repo o/r --json body"],
      ["issue edit", 'gh issue edit 123 --repo o/r --add-label "status:ready"'],
      ["issue comment", 'gh issue comment 123 --body "note"'],
      ["pr create", 'gh pr create --title "x" --body "y"'],
      ["issue create help", "gh issue create --help"],
      ["a read through gh api", "gh api repos/o/r/issues --method GET"],
      ["a bare gh api read", "gh api repos/o/r/issues"],
      ["a label create", 'gh label create "status:ready" --color ededed'],
      ["a prose mention", 'git commit -m "add the gh issue create guard"'],
      ["an echoed mention", 'echo "run gh issue create to file it"'],
      ["a grep for the phrase", "rg 'gh issue create' plugins/"],
      ["an unrelated curl POST", "curl -X POST https://example.com/webhook"],
      ["a linear read", "linear issue list --team ENG"],
    ])("allows %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("ignores a non-Bash tool call", () => {
      const { status } = runHook({
        tool_name: "Write",
        tool_input: { file_path: "x.md", content: "gh issue create" },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("stands down where there is nothing to route through", () => {
    it("allows direct creation when no Lisa config exists (bootstrapping)", () => {
      const { status } = runHook(bash(UNDECLARED_CREATE), {
        cwd: projectWithoutTracker(),
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows direct creation when the config configures no tracker", () => {
      const cwd = projectWithTracker({ harness: "fleet" });

      const { status } = runHook(bash(UNDECLARED_CREATE), { cwd });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("still refuses when a tracker is configured only in the local overlay", () => {
      const cwd = projectWithTracker({ harness: "fleet" });
      writeFileSync(
        path.join(cwd, ".lisa.config.local.json"),
        JSON.stringify({ tracker: "github" }),
        "utf-8"
      );

      const { status } = runHook(bash(UNDECLARED_CREATE), { cwd });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("the operator override is an operator act, not an agent one", () => {
    it("allows the create when the override is in the ambient environment", () => {
      const { status } = runHook(bash(UNDECLARED_CREATE), {
        env: { LISA_ALLOW_DIRECT_ISSUE_CREATE: "1" },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("refuses the create when the override is set inline on the command", () => {
      const { status } = runHook(
        bash(`LISA_ALLOW_DIRECT_ISSUE_CREATE=1 ${UNDECLARED_CREATE}`)
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses an inline override even when the ambient one is also set", () => {
      const { status } = runHook(
        bash(`LISA_ALLOW_DIRECT_ISSUE_CREATE=1 ${UNDECLARED_CREATE}`),
        { env: { LISA_ALLOW_DIRECT_ISSUE_CREATE: "1" } }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses an inline override smuggled through env(1)", () => {
      const { status } = runHook(
        bash(`env LISA_ALLOW_DIRECT_ISSUE_CREATE=1 ${UNDECLARED_CREATE}`)
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses an inline override applied by a preceding export", () => {
      const { status } = runHook(
        bash(
          "export LISA_ALLOW_DIRECT_ISSUE_CREATE=1 && gh issue create --title x"
        )
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the override in the refusal so a human can reach it", () => {
      const { stderr } = runHook(bash(UNDECLARED_CREATE));

      expect(stderr).toContain("LISA_ALLOW_DIRECT_ISSUE_CREATE");
    });
  });
});

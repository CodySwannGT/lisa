/**
 * Guard-parity fixture matrix for parity-safety-net.sh (issue #1960).
 *
 * Drives the REAL hook via a bash subprocess with PreToolUse JSON on stdin and
 * asserts the exit code per fixture: 2 = blocked, 0 = allowed. Fixture data
 * lives in tests/helpers/safety-net-guard-fixtures.ts; the subprocess harness
 * in tests/helpers/safety-net-guard-harness.ts.
 *
 * Deep force-push and heredoc coverage lives in parity-safety-net.test.ts and
 * parity-safety-net-heredoc.test.ts — this suite only smoke-pins those.
 * @module tests/unit/hooks/parity-safety-net-guards
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GIT_STATE_FIXTURES,
  PROJECT_DIR_TOKEN,
  RM_RF_ROOT,
  STATELESS_FIXTURES,
} from "../../helpers/safety-net-guard-fixtures";
import {
  createGuardHarness,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  expectedStatus,
} from "../../helpers/safety-net-guard-harness";

const HEREDOC_TERMINATOR = "EOF";
const { runHook, runHookRaw, makeRepo } = createGuardHarness(process.env);

describe("parity-safety-net.sh — guard parity matrix (#1960)", () => {
  let workRoot: string;
  let projectDir: string;

  beforeAll(() => {
    workRoot = mkdtempSync(path.join(tmpdir(), "lisa-safety-guards-"));
    projectDir = path.join(workRoot, "project");
    mkdirSync(projectDir);
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  describe("built-in guards (stateless fixtures)", () => {
    it.each(STATELESS_FIXTURES)("$id [$expected] $command", fixture => {
      const command = fixture.command.replaceAll(PROJECT_DIR_TOKEN, projectDir);
      const { status, stderr } = runHook(command, { cwd: projectDir });
      expect(
        status,
        `${fixture.id} (${fixture.guard}) expected ${fixture.expected}; stderr: ${stderr}`
      ).toBe(expectedStatus(fixture.expected));
    });
  });

  describe("rm hardening when cwd is $HOME (absorb 9 HOME gate)", () => {
    it("HM-B1 blocks a recursive forced delete run from $HOME", () => {
      const { status } = runHook("rm -rf projects", {
        cwd: projectDir,
        env: { HOME: projectDir },
      });
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("HM-A1 allows a non-recursive delete run from $HOME", () => {
      const { status } = runHook("rm -f notes.txt", {
        cwd: projectDir,
        env: { HOME: projectDir },
      });
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("dirty/clean working-tree reset guards (guard 3 + absorb 7)", () => {
    let cleanRepo: string;
    let dirtyRepo: string;

    beforeAll(() => {
      cleanRepo = makeRepo(workRoot, "clean-repo", false);
      dirtyRepo = makeRepo(workRoot, "dirty-repo", true);
    });

    it.each(GIT_STATE_FIXTURES)(
      "$id [$expected] $command in $repo repo",
      fixture => {
        const cwd = fixture.repo === "dirty" ? dirtyRepo : cleanRepo;
        const { status, stderr } = runHook(fixture.command, { cwd });
        expect(
          status,
          `${fixture.id} in ${fixture.repo} repo expected ${fixture.expected}; stderr: ${stderr}`
        ).toBe(expectedStatus(fixture.expected));
      }
    );
  });

  describe("project-local custom rules file (guard 14)", () => {
    let rulesPath: string;

    beforeAll(() => {
      rulesPath = path.join(workRoot, "custom-rules.txt");
      writeFileSync(
        rulesPath,
        [
          "# comment lines are ignored",
          "",
          "terraform[[:space:]]+destroy",
          "FORBIDDEN_TOKEN",
          "",
        ].join("\n")
      );
    });

    /**
     * Screens a command with the custom rules file active.
     * @param command - The Bash command under test.
     * @returns The hook exit status.
     */
    const withRules = (command: string): number | null =>
      runHook(command, {
        cwd: projectDir,
        env: { SAFETY_NET_RULES_FILE: rulesPath },
      }).status;

    it("CR-B1 blocks a command matching a custom ERE", () => {
      expect(withRules("terraform destroy -auto-approve")).toBe(EXIT_BLOCKED);
    });

    it("CR-A1 allows the near-miss of the custom ERE", () => {
      expect(withRules("terraform plan")).toBe(EXIT_ALLOWED);
    });

    it("CR-B2 applies rules that follow comments and blank lines", () => {
      expect(withRules("echo FORBIDDEN_TOKEN")).toBe(EXIT_BLOCKED);
    });

    it("CR-A2 allows a command matching no rule", () => {
      expect(withRules("echo safe output")).toBe(EXIT_ALLOWED);
    });
  });

  describe("fail-closed input handling (absorb 13)", () => {
    it("FC-B1 denies (exit 2) on malformed hook JSON", () => {
      const { status } = runHookRaw("not json", { cwd: projectDir });
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("FC-A1 allows valid input with no command field", () => {
      const input = JSON.stringify({ tool_name: "Bash", tool_input: {} });
      expect(runHookRaw(input, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });

    it("FC-A2 ignores non-Bash tools even with destructive text", () => {
      const input = JSON.stringify({
        tool_name: "Read",
        tool_input: { command: RM_RF_ROOT },
      });
      expect(runHookRaw(input, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });
  });

  describe("heredoc classifier smoke regressions", () => {
    it("HD-A1 still exempts a gh-writer prose heredoc quoting rm -rf /", () => {
      const command = [
        "gh issue create --body-file - <<'EOF'",
        RM_RF_ROOT,
        HEREDOC_TERMINATOR,
      ].join("\n");
      expect(runHook(command, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });

    it("HD-B1 still blocks an executable heredoc containing rm -rf /", () => {
      const command = ["bash <<'EOF'", RM_RF_ROOT, HEREDOC_TERMINATOR].join(
        "\n"
      );
      expect(runHook(command, { cwd: projectDir }).status).toBe(EXIT_BLOCKED);
    });
  });
});

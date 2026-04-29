/**
 * Tests for the enforce-team-first.sh hook.
 *
 * The hook arms enforcement when /lisa:research|plan|implement|intake is
 * invoked, blocks bypass tool calls until ToolSearch+TeamCreate fire,
 * and exempts subagent (teammate) sessions because they inherit the
 * lead's team.
 * @module tests/unit/hooks/enforce-team-first
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/enforce-team-first.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const IMPLEMENT_PROMPT = "/lisa:implement SE-1";

let stateRoot: string;

beforeEach(() => {
  stateRoot = mkdtempSync(path.join(tmpdir(), "lisa-hook-test-"));
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

const runHook = (
  payload: Record<string, unknown>
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, TMPDIR: stateRoot },
  });
  return { status: result.status, stderr: result.stderr };
};

const flagPath = (sessionId: string, suffix: string): string =>
  path.join(stateRoot, "lisa-team-enforce", `${sessionId}.${suffix}`);

const armSession = (sessionId: string, prompt = IMPLEMENT_PROMPT): void => {
  runHook({
    hook_event_name: "UserPromptSubmit",
    session_id: sessionId,
    prompt,
  });
};

const preToolUse = (
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown> = {}
): { status: number | null; stderr: string } =>
  runHook({
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_name: toolName,
    tool_input: toolInput,
  });

describe("enforce-team-first.sh", () => {
  describe("arming", () => {
    it("does nothing when no lifecycle skill has been invoked", () => {
      const { status } = preToolUse("idle", "Bash", { command: "ls" });
      expect(status).toBe(EXIT_ALLOWED);
    });

    it.each([
      ["/lisa:research onboarding", "research"],
      ["/lisa:plan https://example.com/prd", "plan"],
      ["/lisa:implement SE-1", "implement"],
      ["/lisa:intake SE", "intake"],
    ])("arms via UserPromptSubmit on %s", (prompt, label) => {
      const sid = `arm-${label}`;
      armSession(sid, prompt);
      expect(existsSync(flagPath(sid, "skill"))).toBe(true);
    });

    it("does not arm for non-lifecycle slash commands", () => {
      armSession("not-lifecycle", "/help");
      expect(existsSync(flagPath("not-lifecycle", "skill"))).toBe(false);
    });

    it("arms via Skill tool with skill=lisa:implement", () => {
      const { status } = preToolUse("skill-arm", "Skill", {
        skill: "lisa:implement",
      });
      expect(status).toBe(EXIT_ALLOWED);
      expect(existsSync(flagPath("skill-arm", "skill"))).toBe(true);
    });

    it("does not arm for non-lifecycle Skill calls", () => {
      preToolUse("git-commit", "Skill", { skill: "lisa:git-commit" });
      expect(existsSync(flagPath("git-commit", "skill"))).toBe(false);
    });
  });

  describe("blocks bypass tools when armed and team not yet created", () => {
    it.each([
      ["Task", { subagent_type: "Explore" }],
      ["Read", { file_path: "/foo" }],
      ["Bash", { command: "ls" }],
      ["Edit", {}],
      ["Write", {}],
      ["MultiEdit", {}],
      ["Grep", {}],
      ["Glob", {}],
      ["WebFetch", {}],
      ["WebSearch", {}],
      ["TaskCreate", {}],
      ["mcp__plugin_atlassian_atlassian__getJiraIssue", {}],
      ["Skill", { skill: "lisa:tracker-read" }],
    ])("blocks %s", (tool, input) => {
      const sid = `block-${tool}`;
      armSession(sid);
      const { status } = preToolUse(sid, tool, input);
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("explains the path forward in the block message", () => {
      armSession("msg");
      const { stderr } = preToolUse("msg", "Task", {});
      expect(stderr).toContain("ToolSearch");
      expect(stderr).toContain("TeamCreate");
      expect(stderr).toContain("/lisa:implement");
    });
  });

  describe("allows the path forward and benign tools", () => {
    it.each([
      ["ToolSearch", { query: "select:TeamCreate" }],
      ["TeamCreate", {}],
      ["TodoWrite", { todos: [] }],
      ["AskUserQuestion", {}],
    ])("allows %s while armed", (tool, input) => {
      const sid = `allow-${tool}`;
      armSession(sid);
      const { status } = preToolUse(sid, tool, input);
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("PostToolUse on TeamCreate", () => {
    it("lifts enforcement when TeamCreate succeeds", () => {
      const sid = "post-ok";
      armSession(sid);
      expect(preToolUse(sid, "Bash", { command: "ls" }).status).toBe(
        EXIT_BLOCKED
      );

      runHook({
        hook_event_name: "PostToolUse",
        session_id: sid,
        tool_name: "TeamCreate",
        tool_input: {},
        tool_response: { team_id: "team-xyz" },
      });
      expect(existsSync(flagPath(sid, "team"))).toBe(true);
      expect(preToolUse(sid, "Bash", { command: "ls" }).status).toBe(
        EXIT_ALLOWED
      );
    });

    it("keeps enforcement when TeamCreate failed (is_error=true)", () => {
      const sid = "post-fail";
      armSession(sid);
      runHook({
        hook_event_name: "PostToolUse",
        session_id: sid,
        tool_name: "TeamCreate",
        tool_input: {},
        tool_response: { is_error: true, error: "double-create" },
      });
      expect(existsSync(flagPath(sid, "team"))).toBe(false);
      expect(preToolUse(sid, "Bash", { command: "ls" }).status).toBe(
        EXIT_BLOCKED
      );
    });
  });

  describe("subagent exemption", () => {
    it("never blocks once SubagentStart has marked the session", () => {
      const sid = "sub-1";
      runHook({ hook_event_name: "SubagentStart", session_id: sid });
      expect(existsSync(flagPath(sid, "subagent"))).toBe(true);

      armSession(sid, "/lisa:implement SE-2");
      const { status } = preToolUse(sid, "Bash", { command: "ls" });
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("cross-session isolation", () => {
    it("does not leak flags between session ids", () => {
      armSession("iso-a");
      const { status } = preToolUse("iso-b", "Bash", { command: "ls" });
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("fail-open behavior", () => {
    it.each([
      ["missing session_id", JSON.stringify({ hook_event_name: "PreToolUse" })],
      ["empty input", ""],
      ["malformed JSON", "{not json"],
    ])("exits 0 on %s", (_label, input) => {
      const result = spawnSync(BASH_PATH, [HOOK_PATH], {
        input,
        encoding: "utf-8",
        env: { ...process.env, TMPDIR: stateRoot },
      });
      expect(result.status).toBe(EXIT_ALLOWED);
    });
  });

  describe("stale state cleanup", () => {
    it("removes flag files older than 24h", () => {
      const dir = path.join(stateRoot, "lisa-team-enforce");
      mkdirSync(dir, { recursive: true });
      const oldFlag = path.join(dir, "stale-session.skill");
      writeFileSync(oldFlag, "lisa:implement\n");
      const past = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
      utimesSync(oldFlag, past, past);
      expect(existsSync(oldFlag)).toBe(true);

      preToolUse("fresh", "Read", {});
      expect(existsSync(oldFlag)).toBe(false);
    });
  });
});

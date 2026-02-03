/**
 * Tests for the track-plan-sessions.sh hook's dedup logic.
 *
 * Verifies that session ID dedup is scoped to the ## Sessions section,
 * preventing false positives when session IDs appear elsewhere in plan content
 * (e.g., scratchpad directory paths).
 *
 * @module tests/unit/hooks/track-plan-sessions
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const HOOK_PATH = path.resolve(".claude/hooks/track-plan-sessions.sh");
const BASH_PATH = "/bin/bash";
const SESSION_ID = "68a7b384-a3cc-4e42-9077-c40c76e70232";
const TEST_PLAN_HEADING = "# Test Plan";
const SESSIONS_HEADING = "## Sessions";

const createTempDir = (): string => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "track-plan-test-"))
  );
  fs.mkdirSync(path.join(dir, "plans"), { recursive: true });
  return dir;
};

const runHook = (
  sessionId: string,
  planFilePath: string,
  tempDir: string
): void => {
  const input = JSON.stringify({
    session_id: sessionId,
    permission_mode: "plan",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: planFilePath },
  });

  spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd: tempDir,
    input,
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tempDir },
  });
};

const createPlanFile = (tempDir: string, content: string): string => {
  const plansDir = path.join(tempDir, "plans");
  const planFile = path.join(plansDir, "test-plan.md");
  fs.writeFileSync(planFile, content, "utf-8");
  return planFile;
};

const readPlanFile = (planFile: string): string =>
  fs.readFileSync(planFile, "utf-8");

describe("track-plan-sessions.sh dedup check", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    cleanupDirs.forEach(dir => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
    cleanupDirs.length = 0;
  });

  it("should not false-positive when session ID appears in plan content", () => {
    const tempDir = createTempDir();
    cleanupDirs.push(tempDir);

    const planContent = [
      TEST_PLAN_HEADING,
      "",
      "## Implementation",
      "",
      `Use scratchpad at /private/tmp/claude-501/-Users-cody-workspace-lisa/${SESSION_ID}/scratchpad/test.sh`,
      "",
    ].join("\n");

    const planFile = createPlanFile(tempDir, planContent);
    runHook(SESSION_ID, planFile, tempDir);

    const result = readPlanFile(planFile);
    expect(result).toContain(SESSIONS_HEADING);
    expect(result).toContain(`| ${SESSION_ID} |`);
  });

  it("should correctly dedup when session ID is in the Sessions table", () => {
    const tempDir = createTempDir();
    cleanupDirs.push(tempDir);

    const planContent = [
      TEST_PLAN_HEADING,
      "",
      SESSIONS_HEADING,
      "",
      "<!-- Auto-maintained by track-plan-sessions.sh -->",
      "| Session ID | First Seen | Phase |",
      "|------------|------------|-------|",
      `| ${SESSION_ID} | 2026-01-01T00:00:00Z | plan |`,
      "",
    ].join("\n");

    const planFile = createPlanFile(tempDir, planContent);
    const contentBefore = readPlanFile(planFile);
    runHook(SESSION_ID, planFile, tempDir);

    const contentAfter = readPlanFile(planFile);
    expect(contentAfter).toBe(contentBefore);
  });

  it("should write session when Sessions section does not exist", () => {
    const tempDir = createTempDir();
    cleanupDirs.push(tempDir);

    const planContent = [TEST_PLAN_HEADING, "", "Some content here.", ""].join(
      "\n"
    );

    const planFile = createPlanFile(tempDir, planContent);
    runHook(SESSION_ID, planFile, tempDir);

    const result = readPlanFile(planFile);
    expect(result).toContain(SESSIONS_HEADING);
    expect(result).toContain("| Session ID | First Seen | Phase |");
    expect(result).toContain(`| ${SESSION_ID} |`);
  });
});

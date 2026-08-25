/**
 * Tests for the track-plan-sessions.sh hook behavior.
 *
 * The hook is currently temporarily disabled (exits early with code 0).
 * Tests verify it does not modify plan files while disabled, and that the
 * dedup logic still correctly ignores already-tracked sessions.
 *
 * ## Why the resolved path and the exit status are both asserted
 *
 * This file used to spawn `.claude/hooks/track-plan-sessions.sh`, which is an
 * INSTALL-ONLY path: `git ls-files .claude/` lists no `hooks/` entries, and the
 * directory only appears once the Lisa plugin has been installed into a
 * checkout. In CI the child was therefore `bash <missing file>` — exit 127,
 * nothing written — and "does not modify plan files while disabled" passed for
 * the wrong reason. **A missing script modifies nothing just as reliably as a
 * disabled one**, and a file-content assertion cannot tell those apart
 * (CodySwannGT/lisa#3020).
 *
 * So two things are asserted that a content comparison alone never covers:
 * the hook exists where it actually SHIPS, and the child it starts ran to a
 * clean exit. Delete the script and this suite fails naming it, rather than
 * reporting a hook that declined to write.
 * @module tests/unit/hooks/track-plan-sessions
 */
import fs from "fs";
import path from "path";
import os from "os";
import type { SpawnSyncReturns } from "node:child_process";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/**
 * Where the hook is tracked in this repository.
 *
 * `plugins/lisa/hooks/` is the shipped location and the convention every other
 * hook suite in this tree already uses (`block-no-verify`, `parity-safety-net`,
 * `enforce-team-first`, ...). It is present in a fresh clone, which is the
 * whole property the previous path lacked.
 */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/track-plan-sessions.sh");
const BASH_PATH = "/bin/bash";
const SESSION_ID = "68a7b384-a3cc-4e42-9077-c40c76e70232";
const TEST_PLAN_HEADING = "# Test Plan";
const SESSIONS_HEADING = "## Sessions";

/** A plan body with no `## Sessions` section, so a live hook would add one. */
const PLAIN_PLAN = [TEST_PLAN_HEADING, "", "Some content here.", ""].join("\n");

/** Exit status a shell reports for a command it cannot find. */
const COMMAND_NOT_FOUND_STATUS = 127;

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
): SpawnSyncReturns<string> => {
  const input = JSON.stringify({
    session_id: sessionId,
    permission_mode: "lisa-plan",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: planFilePath },
  });

  return boundedSpawnSync({
    label: "track-plan-sessions hook",
    command: BASH_PATH,
    args: [HOOK_PATH],
    cwd: tempDir,
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: tempDir },
  });
};

/**
 * Assert the hook actually executed, and say what happened when it did not.
 *
 * This is the assertion the ticket is about. Every case below then compares
 * plan-file content, and that comparison is only evidence about the hook once
 * the hook is known to have run — an absent script satisfies it trivially.
 * The two failures are kept apart because they call for opposite fixes: a
 * 127 means the resolved path is wrong, any other non-zero means the hook is.
 * @param outcome - What `boundedSpawnSync` returned for the hook
 */
const expectHookExecuted = (outcome: SpawnSyncReturns<string>): void => {
  if (outcome.status === 0) return;
  if (outcome.status === COMMAND_NOT_FOUND_STATUS) {
    throw new Error(
      `The hook did not run: /bin/bash could not find ${HOOK_PATH} ` +
        `(exit ${COMMAND_NOT_FOUND_STATUS}). Nothing was executed, so this ` +
        `case proves NOTHING about whether the hook modifies plan files — a ` +
        `missing script leaves them untouched exactly as a disabled one does. ` +
        `Resolve the hook from where it ships rather than from an install-only ` +
        `path (CodySwannGT/lisa#3020).`
    );
  }
  throw new Error(
    `The hook ran but exited ${String(outcome.status)}, so its effect on the ` +
      `plan file is not the disabled-path behaviour this case describes. ` +
      `stderr: ${outcome.stderr.trim() || "(empty)"}`
  );
};

const createPlanFile = (tempDir: string, content: string): string => {
  const plansDir = path.join(tempDir, "plans");
  const planFile = path.join(plansDir, "test-plan.md");
  fs.writeFileSync(planFile, content, "utf-8");
  return planFile;
};

const readPlanFile = (planFile: string): string =>
  fs.readFileSync(planFile, "utf-8");

describe("track-plan-sessions.sh resolution", () => {
  it("resolves the hook from a path present in a fresh checkout", () => {
    // Named explicitly rather than left to the spawn, so the first thing a
    // reader sees is the missing file rather than a downstream symptom of it.
    expect(fs.existsSync(HOOK_PATH) ? HOOK_PATH : `MISSING: ${HOOK_PATH}`).toBe(
      HOOK_PATH
    );
  });
});

describe("track-plan-sessions.sh dedup check", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    cleanupDirs.forEach(dir => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
    cleanupDirs.length = 0;
  });

  it("should not modify plan file when hook is disabled", () => {
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
    const contentBefore = readPlanFile(planFile);
    const outcome = runHook(SESSION_ID, planFile, tempDir);

    expectHookExecuted(outcome);
    const result = readPlanFile(planFile);
    expect(result).toBe(contentBefore);
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
    const outcome = runHook(SESSION_ID, planFile, tempDir);

    expectHookExecuted(outcome);
    const contentAfter = readPlanFile(planFile);
    expect(contentAfter).toBe(contentBefore);
  });

  it("should not write session when hook is disabled", () => {
    const tempDir = createTempDir();
    cleanupDirs.push(tempDir);

    const planFile = createPlanFile(tempDir, PLAIN_PLAN);
    const contentBefore = readPlanFile(planFile);
    const outcome = runHook(SESSION_ID, planFile, tempDir);

    expectHookExecuted(outcome);
    const result = readPlanFile(planFile);
    expect(result).toBe(contentBefore);
  });

  it("distinguishes a hook that ran and declined from one that never started", () => {
    // The case the suite could not previously express. Both arms leave the plan
    // file byte-identical; only the exit status separates them, so only the
    // exit status can carry the distinction.
    const tempDir = createTempDir();
    cleanupDirs.push(tempDir);

    const planFile = createPlanFile(tempDir, PLAIN_PLAN);

    const ran = runHook(SESSION_ID, planFile, tempDir);
    const neverStarted = boundedSpawnSync({
      label: "absent track-plan-sessions hook",
      command: BASH_PATH,
      args: [path.join(tempDir, "no-such-hook.sh")],
      cwd: tempDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tempDir },
    });

    expect(ran.status).toBe(0);
    expect(neverStarted.status).toBe(COMMAND_NOT_FOUND_STATUS);
    // Identical observable effect on disk, opposite meanings.
    expect(readPlanFile(planFile)).toBe(PLAIN_PLAN);
    expect(() => expectHookExecuted(neverStarted)).toThrow(/did not run/u);
  });
});

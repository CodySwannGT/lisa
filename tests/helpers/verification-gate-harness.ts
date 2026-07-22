/**
 * Shared harness for the enforce-verification-gate.sh Stop hook tests.
 *
 * The gate is exercised as a real process — the tests spawn the actual shipped
 * hook against a throwaway project directory and state directory, so what is
 * pinned is the hook's observable contract (exit code + stderr), not a
 * reimplementation of its logic.
 *
 * The v1 and v2 suites share this harness so the compatibility window is
 * proven against one identical driver: the same arming, freshness, and config
 * mechanics judge both schema versions.
 * @module tests/helpers/verification-gate-harness
 */
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const BASH_PATH = "/bin/bash";

/** Exit code the hook uses to block a stop. */
export const EXIT_BLOCKED = 2;

/** Exit code the hook uses to allow a stop. */
export const EXIT_ALLOWED = 0;

/** Matches the hook's own MAX_BLOCKS escalation bound. */
export const MAX_BLOCKS = 8;

/** Seconds the verdict mtime is pushed past the arm flag to be "fresh". */
const FRESH_SKEW_SECONDS = 30;

const IMPLEMENT_PROMPT = "/lisa:implement BCE-2";

const HOOK_PATH = path.resolve(
  "plugins/lisa/hooks/enforce-verification-gate.sh"
);

/** Timestamp reused across fixtures so no literal is duplicated. */
export const FIXTURE_TIMESTAMP = "2026-07-20T00:00:00Z";

/** The head_sha a clean v2 fixture claims to have been captured at. */
export const FIXTURE_HEAD_SHA = "bbbb222";

/** Result of one hook invocation. */
export type HookResult = { status: number | null; stderr: string };

/** Options controlling how a verdict file is written. */
export type WriteVerdictOptions = { stale?: boolean };

/** One isolated gate scenario, bound to its own temp directories. */
export type GateScenario = {
  cleanup: () => void;
  runHook: (payload: Record<string, unknown>) => HookResult;
  armSession: (sessionId: string) => void;
  stop: (sessionId: string) => HookResult;
  writeVerdict: (contents: string, options?: WriteVerdictOptions) => void;
  writeConfig: (enforceBoundaries: boolean) => void;
  writeEvidenceFile: (relativePath: string, contents: string) => void;
};

/**
 * Creates an isolated scenario around the real hook, with a fresh session
 * state directory and project directory. Call once per test and cleanup after.
 * @param baseEnv - Environment to inherit (callers pass process.env).
 * @returns The scenario driver.
 */
export const createGateScenario = (
  baseEnv: Record<string, string | undefined>
): GateScenario => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), "lisa-verify-hook-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "lisa-verify-proj-"));
  const verdictFile = path.join(
    projectDir,
    ".lisa",
    "verification-status.json"
  );
  const runHook = (payload: Record<string, unknown>): HookResult => {
    const result = spawnSync(BASH_PATH, [HOOK_PATH], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: { ...baseEnv, TMPDIR: stateRoot, CLAUDE_PROJECT_DIR: projectDir },
    });
    return { status: result.status, stderr: result.stderr };
  };

  mkdirSync(path.join(projectDir, ".lisa"), { recursive: true });

  return {
    cleanup: (): void => {
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    },

    runHook,

    armSession: (sessionId: string): void => {
      runHook({
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        prompt: IMPLEMENT_PROMPT,
      });
    },

    stop: (sessionId: string): HookResult =>
      runHook({ hook_event_name: "Stop", session_id: sessionId }),

    /**
     * Writes the verdict file and forces its mtime relative to the arm flag so
     * the hook's freshness check is exercised deterministically.
     * @param contents - Raw contents, so malformed JSON is testable.
     * @param options - Options bag.
     * @param options.stale - Backdate the verdict behind the arm flag.
     */
    writeVerdict: (
      contents: string,
      options: WriteVerdictOptions = {}
    ): void => {
      const now = Date.now() / 1000;
      const when = options.stale
        ? now - FRESH_SKEW_SECONDS * 2
        : now + FRESH_SKEW_SECONDS;
      writeFileSync(verdictFile, contents);
      utimesSync(verdictFile, when, when);
    },

    /**
     * Writes .lisa.config.json setting the boundary-enforcement posture.
     * @param enforceBoundaries - Value for verification.gate.enforceBoundaries.
     */
    writeConfig: (enforceBoundaries: boolean): void => {
      writeFileSync(
        path.join(projectDir, ".lisa.config.json"),
        JSON.stringify({ verification: { gate: { enforceBoundaries } } })
      );
    },

    /**
     * Materializes an evidence artifact inside the scenario's project directory
     * so the gate's digest check has real bytes to recompute. Evidence
     * `locator` values are project-relative, exactly as a verdict records them.
     * @param relativePath - Locator relative to the project directory.
     * @param contents - Bytes to write at that locator.
     */
    writeEvidenceFile: (relativePath: string, contents: string): void => {
      const target = path.join(projectDir, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    },
  };
};

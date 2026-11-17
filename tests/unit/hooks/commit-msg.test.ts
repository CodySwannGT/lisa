/**
 * Regression tests for the commit-msg hook diagnostics.
 *
 * The hook should name the exact failing commitlint rule and show concrete
 * attribution trailers, so agents do not need multiple commit attempts to learn
 * what the hook wanted.
 * @module tests/unit/hooks/commit-msg
 */
import type { SpawnSyncReturns } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_TRAILER,
  DEVIN_AGENT_TRAILER,
  DEVIN_EFFORT_TRAILER,
  DEVIN_MODEL_TRAILER,
  DEVIN_TRAILER,
  HUMAN_TRAILER,
  OPENCODE_AGENT_TRAILER,
  OPENCODE_EFFORT_HINT,
  OPENCODE_MODEL_HINT,
  OPENCODE_TRAILER,
  PASSING_COMMITLINT_BIN,
  VALID_SUBJECT,
  WORK_ITEM_TRAILER,
  createProject as createHookProject,
  type ProjectOptions,
  runHook as runHookIn,
} from "./commit-msg-fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * Create a temp hook project and register it for cleanup after the test.
 * @param options - Project setup options.
 * @returns The temporary project directory.
 */
function createProject(options: ProjectOptions): string {
  const project = createHookProject(options, process.env);
  tempDirs.push(project);
  return project;
}

/**
 * Run the real commit-msg hook in a temp project under this process's env.
 * @param project - Temporary project directory.
 * @param shell - Interpreter to run the hook under; `sh` matches what git uses.
 * @param hookPath - Installed hook or source template to execute.
 * @returns The completed hook process.
 */
function runHook(
  project: string,
  shell?: string,
  hookPath?: string
): SpawnSyncReturns<string> {
  return runHookIn(project, process.env, shell, hookPath);
}

describe("commit-msg hook diagnostics", () => {
  it("names the failed commitlint rule and offending subject", () => {
    const project = createProject({
      binName: "npx",
      binBody: [
        "printf '%s\\n' 'input: Fix Bad Subject'",
        "printf '%s\\n' '✖   subject must not be sentence-case, start-case, pascal-case, upper-case [subject-case]'",
        "exit 1",
      ].join("\n"),
      message: [
        "Fix Bad Subject",
        "",
        WORK_ITEM_TRAILER,
        "Co-authored-by: Codex <codex@openai.com>",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Failed commitlint rule(s):");
    expect(result.stdout).toContain("[subject-case]");
    expect(result.stdout).toContain("Subject: Fix Bad Subject");
  });

  it("prints exact expected attribution trailers", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Expected one of these trailers:");
    expect(result.stdout).toContain(CLAUDE_TRAILER);
    expect(result.stdout).toContain("Co-authored-by: Codex <codex@openai.com>");
    expect(result.stdout).toContain(
      "Co-authored-by: Cursor <noreply@cursor.com>"
    );
    expect(result.stdout).toContain(OPENCODE_TRAILER);
    expect(result.stdout).toContain(
      "Co-authored-by: Antigravity <noreply@google.com>"
    );
    expect(result.stdout).toContain(
      "Co-authored-by: Copilot <noreply@github.com>"
    );
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });

  it("accepts every fleet agent's trailer alone", () => {
    // The gate must cover the whole supported fleet — Claude, Codex, Cursor,
    // OpenCode, Antigravity, Copilot — not just the three it started with.
    // CodySwannGT/lisa#4282.
    for (const trailer of [
      "Co-authored-by: Cursor <noreply@cursor.com>",
      "Co-authored-by: Antigravity <noreply@google.com>",
      "Co-authored-by: Copilot <noreply@github.com>",
    ]) {
      const project = createProject({
        binName: "npx",
        binBody: PASSING_COMMITLINT_BIN,
        message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n${trailer}\n`,
      });

      const result = runHook(project);

      expect(result.status, `refused ${trailer}`).toBe(0);
    }
  });

  it("accepts a non-fleet agent carrying AI metadata trailers", () => {
    // Devin is not in Lisa's plugin fleet, but the gate enforces attribution,
    // not agent gatekeeping: the AI-Agent/AI-Model/AI-Effort block keeps the
    // commit auditable. CodySwannGT/lisa#4282.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        DEVIN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects a non-fleet agent missing AI metadata trailers", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [VALID_SUBJECT, "", WORK_ITEM_TRAILER, DEVIN_TRAILER, ""].join(
        "\n"
      ),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
    expect(result.stdout).toContain("AI-Model");
    expect(result.stdout).toContain("AI-Effort");
  });

  it("rejects AI metadata written in body prose, not the trailer block", () => {
    // The AI-* checks read the same parsed trailer block the co-author list
    // comes from — an "AI-Agent:" line in prose is not attribution metadata
    // and must not satisfy the gate. CodySwannGT/lisa#4282.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "Authored with assistance; metadata recorded inline:",
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
        WORK_ITEM_TRAILER,
        DEVIN_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("rejects metadata that attests to no listed co-author", () => {
    // A commit whose only co-author is human — or whose AI-Agent names an
    // agent that is not a co-author — is refused: the block must attest to
    // someone actually listed. CodySwannGT/lisa#4294.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("rejects an AI-Agent value that only substring-matches the trailer prefix", () => {
    // "AI-Agent: Co-authored-by" substring-matches every co-author trailer
    // line while naming nobody — the check compares against the extracted
    // co-author NAME, not the raw line. CodySwannGT/lisa#4294.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        "AI-Agent: Co-authored-by",
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("accepts a human co-author when the driving agent is also listed", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        DEVIN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects a non-fleet co-author even when a fleet trailer is present", () => {
    // Per-entry judgement: a fleet trailer must not mask a sibling co-author
    // that owes AI-* metadata.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        CLAUDE_TRAILER,
        DEVIN_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("ignores a co-author named in prose, not the trailer block", () => {
    // A "Co-authored-by:" string inside the message body is not attribution —
    // only the git trailer block counts.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "Review note: Co-authored-by: Devin <devin@cognition.ai> was discussed",
        "during pairing and is named here in passing.",
        "",
        WORK_ITEM_TRAILER,
        CLAUDE_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("does not count a body mention as co-authorship", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "The diff was pair-reviewed; see Co-authored-by: Devin",
        "<devin@cognition.ai> in the notes.",
        "",
        WORK_ITEM_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Commit message must include AI co-authorship"
    );
  });
});

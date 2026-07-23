/**
 * Prose contract for the overflow buffer and its drain (CodySwannGT/lisa#1996).
 *
 * The executable half — preserve-on-budget-drop, the union merge attribute, the
 * `lisa learnings-overflow` handle — is covered by unit tests. This file covers
 * the half that lives in agent instructions, because an overflow file nothing
 * drains is just a slower way to lose the capture:
 *
 * - `lisa-persist-learning` must ship the preserved capture instead of stopping
 *   at the saturation ticket. The overflow is git-tracked precisely so it
 *   reaches `main`; a capture preserved only inside a disposable worktree is
 *   durable in name only.
 * - `lisa-learnings-audit` (the gardener) must inventory the overflow and drain
 *   it, and must do so through the command rather than by hand-editing — the
 *   same rule every other learnings surface follows.
 *
 * Assertions cover the canonical plugin source and every checked-in runtime
 * projection, so a rebuild that drops the wording on one agent fails here.
 * @module tests/unit/strategies/learnings-overflow-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PERSIST_PATHS = [
  "plugins/src/base/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-agy/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-persist-learning/SKILL.md",
] as const;

const AUDIT_PATHS = [
  "plugins/src/base/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-agy/skills/lisa-learnings-audit/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-learnings-audit/SKILL.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(PERSIST_PATHS)("budget-drop preservation (%s)", skillPath => {
  const skill = read(skillPath);

  it("tells the writer the drop is preserved in the overflow, not lost", () => {
    expect(skill).toContain("PROJECT_LEARNINGS.overflow.md");
    expect(skill).toMatch(/overflow/i);
  });

  it("ships the preserved capture instead of stopping at the signal", () => {
    // A capture preserved only in a disposable worktree never reaches the
    // gardener, so the PR must still open and must carry the overflow file.
    expect(skill).toMatch(/still open the pull request/i);
  });

  it("keeps the saturation signal alongside the preservation", () => {
    expect(skill).toContain("[lisa-ledger-saturated]");
  });
});

describe.each(AUDIT_PATHS)("gardener overflow drain (%s)", skillPath => {
  const skill = read(skillPath);

  it("inventories the overflow as a source of truth", () => {
    expect(skill).toMatch(/overflow/i);
  });

  it("drains through the command, never by hand-editing", () => {
    expect(skill).toContain("lisa learnings-overflow");
    expect(skill).toContain("--drain");
  });

  it("files the durable home BEFORE draining, so a partial run is resumable", () => {
    expect(skill).toMatch(/only after .{0,80}ticket/i);
  });
});

/**
 * Regression coverage for the lisa-wiki `ensure-gitignore.mjs` script.
 *
 * The script merges a managed block (`# BEGIN: AI GUARDRAILS WIKI` /
 * `# END: AI GUARDRAILS WIKI`) into a project's `.gitignore`, idempotently.
 * Tests cover: file-creation, in-place block replacement, append when block
 * is absent, idempotent re-run, and preservation of user content outside
 * the block.
 *
 * Wired by lisa-wiki-setup workflow step 4 — wiki-wrapper repos (mode
 * `wrapper` / `standalone`) typically don't enable the base lisa plugin, so
 * this is the only path by which they get the worktree-ignore patterns.
 *
 * @module tests/unit/strategies/wiki-ensure-gitignore
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Markers the script keys on (match the script + template). */
const BEGIN_MARKER = "# BEGIN: AI GUARDRAILS WIKI";
/** Closing marker the script keys on. */
const END_MARKER = "# END: AI GUARDRAILS WIKI";
/** Lead pattern in the managed block — re-used across cases. */
const CLAUDE_WORKTREES = "/.claude/worktrees/";
/** The other two patterns are deduped via REQUIRED_PATTERNS below. */
const CODEX_WORKTREES = "/.codex/worktrees/";
/** Lisa backup snapshots — third pattern in the managed block. */
const LISABAK = "/.lisabak/";
/** Patterns the template ships — at least these must land inside the block. */
const REQUIRED_PATTERNS = [CLAUDE_WORKTREES, CODEX_WORKTREES, LISABAK] as const;
/** Filename consumed throughout the suite — extracted to satisfy no-duplicate-string. */
const GITIGNORE = ".gitignore";
/** Common user-content fixture used as pre-existing lines outside the block. */
const NODE_MODULES_LINE = "node_modules/";
/** Absolute path to the script under test. */
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../plugins/src/wiki/scripts/ensure-gitignore.mjs"
);

/**
 * Run the ensure-gitignore script against a tempdir, capturing stdout. Uses
 * `process.execPath` (the absolute path to the current Node binary) instead
 * of resolving `node` via $PATH, because relying on $PATH inside execFileSync
 * trips the project's no-os-command-from-path rule.
 * @param cwd - Working directory whose .gitignore will be created or updated.
 * @returns Captured stdout from the script (a one-line status message).
 */
const run = (cwd: string): string =>
  execFileSync(process.execPath, [SCRIPT_PATH, "--cwd", cwd], {
    encoding: "utf8",
  });

describe("lisa-wiki ensure-gitignore.mjs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-wiki-gitignore-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates .gitignore with the managed block when the file is absent", () => {
    run(tmp);
    const text = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(text).toContain(BEGIN_MARKER);
    expect(text).toContain(END_MARKER);
    for (const pattern of REQUIRED_PATTERNS) {
      expect(text).toContain(pattern);
    }
  });

  it("is idempotent: second run produces no diff", () => {
    run(tmp);
    const first = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    run(tmp);
    const second = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(second).toBe(first);
  });

  it("appends the block to a pre-existing .gitignore without the markers", () => {
    const original = "node_modules/\nbuild/\n# user comment\n";
    fs.writeFileSync(path.join(tmp, GITIGNORE), original);
    run(tmp);
    const text = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(text.startsWith(original)).toBe(true);
    expect(text).toContain(BEGIN_MARKER);
    expect(text).toContain(CLAUDE_WORKTREES);
  });

  it("replaces a stale block in place, preserving content before and after", () => {
    const original = [
      NODE_MODULES_LINE,
      BEGIN_MARKER,
      "stale-old-pattern",
      END_MARKER,
      "build/",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmp, GITIGNORE), original);
    run(tmp);
    const text = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(text).not.toContain("stale-old-pattern");
    expect(text).toContain(CLAUDE_WORKTREES);
    // User content before AND after the block is preserved.
    expect(text.startsWith("node_modules/\n")).toBe(true);
    expect(text).toContain("build/");
  });

  it("preserves user content outside the block on re-runs", () => {
    const original = "node_modules/\n# my custom rule\n*.log\n";
    fs.writeFileSync(path.join(tmp, GITIGNORE), original);
    run(tmp);
    run(tmp); // idempotency
    const text = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(text).toContain(NODE_MODULES_LINE);
    expect(text).toContain("# my custom rule");
    expect(text).toContain("*.log");
  });

  it("coexists with the base lisa plugin's # BEGIN: AI GUARDRAILS block", () => {
    // The "WIKI" suffix lets this block coexist with the base plugin's block
    // because copy-contents keys on the marker suffix. Simulate both blocks
    // being present and confirm we touch only the WIKI one.
    const baseBlock = [
      "# BEGIN: AI GUARDRAILS",
      "base-managed-pattern",
      "# END: AI GUARDRAILS",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmp, GITIGNORE), `${baseBlock}user-pat\n`);
    run(tmp);
    const text = fs.readFileSync(path.join(tmp, GITIGNORE), "utf8");
    expect(text).toContain("base-managed-pattern");
    expect(text).toContain("user-pat");
    expect(text).toContain(BEGIN_MARKER);
    expect(text).toContain(CLAUDE_WORKTREES);
  });
});

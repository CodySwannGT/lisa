/**
 * Every guard must see the same normalized command text.
 *
 * `parity-safety-net.sh` normalizes bash line-continuations (trailing backslash
 * + newline → space) before matching, because the guard patterns rely on
 * intermediate whitespace and an embedded `\<newline>` is not whitespace to
 * `grep -E`. That normalization existed, but only the two segment-walking
 * guards (`rm`, `git push`) consumed it: the shared `matches` / `matches_cs`
 * helpers read the RAW text, so every guard expressed through them could be
 * evaded by breaking the command across lines.
 *
 * Same shape as the force-push `+refspec` gap fixed in #2374 — a guard whose
 * pattern is correct but whose input was not the text it was written against.
 * @module tests/unit/hooks/parity-safety-net-line-continuation
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const BASH_PATH = "/bin/bash";

/** Claude's refusal code. Anything else lets the command through. */
const EXIT_BLOCKED = 2;

/**
 * Run the hook against a Bash payload.
 * @param command - The command Claude proposes to run.
 * @returns Exit status and stderr.
 */
function runHook(command: string): { status: number | null; stderr: string } {
  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf-8",
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

describe("parity-safety-net.sh — guards see normalized text", () => {
  // Only unconditional guards belong here. `git reset --hard` is deliberately
  // conditional — Lisa allows clean-tree resets and blocks only a dirty one —
  // so asserting on it would pass or fail depending on whether the repo this
  // suite happens to run in has uncommitted changes.
  it.each([
    ["git checkout --", "git checkout \\\n  -- src/index.ts"],
    ["rm -rf", "rm -rf \\\n  /"],
    ["destructive SQL", "psql -c 'DROP \\\n  TABLE users'"],
    ["git branch -D", "git branch -D \\\n  main"],
  ])("still blocks %s when split across lines", (_label, command) => {
    // Each of these matched fine on one line and slipped straight through when
    // the same command was wrapped — the whole point of the normalization.
    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });

  it("blocks a protected force-push split across lines", () => {
    // The case the normalization was originally written for; pinned here so the
    // two segment-walking guards stay covered alongside the helper-based ones.
    expect(runHook("git push --force origin \\\n  main").status).toBe(
      EXIT_BLOCKED
    );
  });

  it("still allows an ordinary wrapped command", () => {
    // Normalizing must not turn every multi-line command into a refusal.
    const { status } = runHook("echo hello \\\n  world");
    expect(status).toBe(0);
  });
});

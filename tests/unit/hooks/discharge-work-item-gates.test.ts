/**
 * Tests for `discharge-work-item-gates.sh` — the PostToolUse Bash hook that
 * checks, at pull-request creation, the two Work-Item gates a push could not.
 *
 * Gate 4 (the `Work-Item:` line in the PR body) and gate 5 (the managed
 * backlink on the item) are properties of a pull request, and a push is what
 * makes a pull request possible — so a push reports both as unchecked and the
 * next thing that looks is CI, one cycle later (CodySwannGT/lisa#3791). This
 * hook is what looks in between.
 *
 * What is pinned here is the hook's ROUTING, which is all the hook owns: which
 * commands wake it, and how the validator's three answers map onto Claude's
 * two. The validator's own verdicts are pinned in
 * `tests/unit/scripts/lisa-work-item.test.ts`.
 *
 * The exit-3 case is the one worth stating twice. PostToolUse fires after a
 * tool call whether or not it succeeded, so a `gh pr create` that FAILED still
 * reaches this hook — and there is then no pull request to check. Collapsing
 * that into the blocking arm would report a work-item violation on somebody's
 * typo, which is the same defect as a gate that reports success without
 * measuring: a verdict nobody reached, delivered as one.
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/discharge-work-item-gates.sh"
);
/** Claude's refusal code. Anything else lets the command through. */
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
/** Marker the fake validator drops, so "did not run" is an assertion. */
const RAN_MARKER = "validator-ran";

/**
 * A throwaway git repository carrying a fake work-item validator.
 * @param exitCode - Status the fake validator exits with; omit to install none.
 * @returns The repository path.
 */
function project(exitCode?: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-discharge-hook-"));
  boundedSpawnSync({
    args: ["init", "-q", "-b", "main"],
    command: "git",
    cwd: dir,
    label: "git init",
  });
  if (exitCode === undefined) return dir;
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(
    path.join(dir, "scripts", "lisa-work-item.mjs"),
    [
      `import { writeFileSync } from "node:fs";`,
      `writeFileSync(${JSON.stringify(path.join(dir, RAN_MARKER))}, process.argv.slice(2).join(" "));`,
      `console.log("validator says: gate 4 unmet");`,
      `process.exit(${exitCode});`,
    ].join("\n"),
    "utf-8"
  );
  return dir;
}

/**
 * Run the hook against a PostToolUse payload naming a shell command.
 * @param command - The intercepted Bash command.
 * @param cwd - The repository the hook resolves the validator from.
 * @returns Exit status and stderr.
 */
function runHook(
  command: string,
  cwd: string
): { status: number | null; stderr: string } {
  const result = boundedSpawnSync({
    args: [SCRIPT_PATH],
    command: "/bin/bash",
    cwd,
    input: JSON.stringify({ tool_input: { command }, tool_name: "Bash" }),
    label: "discharge-work-item-gates.sh",
  });
  return { status: result.status, stderr: result.stderr };
}

describe("discharge-work-item-gates.sh", () => {
  it("blocks and reports when the validator finds an unmet gate", () => {
    const dir = project(1);

    const result = runHook('gh pr create --title "x" --body "y"', dir);

    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("validator says: gate 4 unmet");
    expect(existsSync(path.join(dir, RAN_MARKER))).toBe(true);
  });

  it("passes silently when both gates are satisfied", () => {
    const dir = project(0);

    const result = runHook('gh pr create --title "x" --body "y"', dir);

    expect(result.status).toBe(EXIT_ALLOWED);
    expect(result.stderr).toBe("");
    expect(existsSync(path.join(dir, RAN_MARKER))).toBe(true);
  });

  it("treats exit 3 as nothing to check, not as a violation", () => {
    // The `gh pr create` that failed. The tool call ran, so this hook fires,
    // and there is no pull request behind it.
    const dir = project(3);

    const result = runHook('gh pr create --title "x"', dir);

    expect(result.status).toBe(EXIT_ALLOWED);
    expect(result.stderr).toBe("");
  });

  it("wakes on a body edit, which is the other way gate 4 changes", () => {
    const dir = project(1);

    const result = runHook('gh pr edit 7 --body "no declaration"', dir);

    expect(result.status).toBe(EXIT_BLOCKED);
  });

  it.each([
    ["a read", "gh pr view 7 --json body"],
    ["a merge", "gh pr merge 7 --merge --auto"],
    ["an unrelated command", "git push origin HEAD"],
    ["prose mentioning the token", 'echo "run gh pr creation later"'],
  ])("stays out of the way for %s", (_label, command) => {
    const dir = project(1);

    const result = runHook(command, dir);

    expect(result.status).toBe(EXIT_ALLOWED);
    // The validator is not merely tolerated here, it is never spawned: this
    // hook runs on every Bash call the agent makes, so a network round trip
    // per command would be its own defect.
    expect(existsSync(path.join(dir, RAN_MARKER))).toBe(false);
  });

  it("does nothing in a repository that has no work-item validator", () => {
    const dir = project();

    const result = runHook('gh pr create --title "x"', dir);

    expect(result.status).toBe(EXIT_ALLOWED);
    expect(result.stderr).toBe("");
  });
});

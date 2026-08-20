/**
 * The dispatcher must not report success when it dispatched nothing.
 *
 * `lisa-enforcement-fallback.sh` exists because plugin-delivered guards failed
 * open silently, and it reproduced that failure one layer down: when it
 * resolved zero guard scripts it exited 0, allowed the tool call, and printed
 * nothing at all. Nothing distinguished "every guard ran and none objected"
 * from "no guard was found".
 *
 * A whitespace-only `CLAUDE_PROJECT_DIR` reached the same place by a different
 * road — `-n " "` is true, so the value survived the emptiness test, every
 * candidate path became `" /scripts/lisa-hooks/..."`, and every guard was
 * skipped.
 *
 * Both are now refusals. The reasoning is in the script: the hook entry in
 * `.claude/settings.json` and the guards under `scripts/lisa-hooks/` are
 * written by the same `lisa apply`, so "wired but no guards" is never a
 * configuration anyone chose.
 * @module tests/unit/hooks/enforcement-fallback-zero-guards
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const FALLBACK = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** A config directory that cannot exist, standing in for a fresh container. */
const NO_PLUGIN = "/nonexistent-claude-config";

/** Claude's refusal code. Anything else lets the command through. */
const BLOCKED = 2;

/** The bypass a plugin-less session actually got away with. */
const BYPASS = "git commit --no-verify -m x";

/** A command no guard has an opinion about. */
const HARMLESS = "ls -la";

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A directory containing none of the guard scripts — a host whose
 * `scripts/lisa-hooks/` was never written, was deleted, or drifted.
 * @returns Path to an empty directory.
 */
function rootWithNoGuards(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-noguards-"));

  temporaries.push(root);
  return root;
}

/**
 * Run the dispatcher against a proposed command.
 * @param command The Bash command Claude proposes to run.
 * @param projectDir The value of CLAUDE_PROJECT_DIR for the run.
 * @param cwd Working directory, which decides what `git rev-parse` resolves.
 * @returns Exit status and combined output.
 */
function runFallback(
  command: string,
  projectDir: string,
  cwd: string = REPO_ROOT
): { status: number | null; output: string } {
  const result = spawnSync(BASH, [FALLBACK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_CONFIG_DIR: NO_PLUGIN,
    },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("a dispatcher that resolves zero guards", () => {
  it("refuses instead of exiting 0", () => {
    // The whole defect in one assertion: before the fix this was 0, and the
    // command Lisa was built to refuse ran with no enforcement whatsoever.
    expect(runFallback(BYPASS, rootWithNoGuards()).status).toBe(BLOCKED);
  });

  it("refuses an ordinary command too, because it checked nothing", () => {
    // "It only blocks the bad ones" would mean it evaluated them, which is
    // precisely what it could not do. A session with no guards is unguarded for
    // every payload, not just the ones a guard would have objected to.
    expect(runFallback(HARMLESS, rootWithNoGuards()).status).toBe(BLOCKED);
  });

  it("names every guard it could not find", () => {
    const { output } = runFallback(BYPASS, rootWithNoGuards());

    for (const guard of [
      "block-no-verify",
      "parity-safety-net",
      "block-shell-json-parsing",
      "block-instruction-file-edits",
      "block-direct-issue-create",
      "block-managed-file-edits",
    ]) {
      expect(output, guard).toContain(guard);
    }
  });

  it("names both paths it searched and the command that repairs it", () => {
    // An operator standing at the gate gets the two places to look and the one
    // thing to run, not a bare refusal.
    const root = rootWithNoGuards();
    const { output } = runFallback(BYPASS, root);

    expect(output).toContain(path.join(root, "scripts", "lisa-hooks"));
    expect(output).toContain(path.join(root, "plugins", "lisa", "hooks"));
    expect(output).toContain("lisa apply");
  });
});

describe("a whitespace-only project directory", () => {
  it("is treated as unset rather than as a root with no guards", () => {
    // `-n \" \"` is true, so the value survived the emptiness test and every
    // candidate path became \" /scripts/lisa-hooks/...\". Trimmed to empty it
    // falls through to `git rev-parse`, which resolves the real checkout.
    const { status, output } = runFallback(BYPASS, " ");

    expect(status).toBe(BLOCKED);
    expect(output).toContain("--no-verify");
    expect(output).not.toContain("could not be found");
  });

  it("still lets an ordinary command through once the root is recovered", () => {
    // The proof that the trim resolved a real root rather than blanket-refusing.
    expect(runFallback(HARMLESS, " ").status).toBe(0);
  });
});

describe("guards present (control)", () => {
  it("refuses the bypass with the guard's own objection", () => {
    const { status, output } = runFallback(BYPASS, REPO_ROOT);

    expect(status).toBe(BLOCKED);
    expect(output).toContain("--no-verify");
  });

  it("lets an ordinary command through", () => {
    expect(runFallback(HARMLESS, REPO_ROOT).status).toBe(0);
  });
});

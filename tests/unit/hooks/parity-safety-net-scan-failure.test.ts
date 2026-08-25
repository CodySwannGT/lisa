/**
 * A guard that cannot run must DENY, and must say that is what happened.
 *
 * Every built-in guard in the safety net reached its verdict through a bare
 * `printf … | grep -q …` in a condition, under `set -euo pipefail`. grep answers
 * three ways — 0 matched, 1 did not match, >=2 could not do the job — and a
 * condition reads only two of them. So "the scan could not run" was
 * indistinguishable from "this command is safe", and the hook exited 0.
 *
 * Measured before the fix, with a `grep` that exits 2 first on PATH: `rm -rf /`,
 * `git push --force origin main`, `dd of=/dev/disk0` and `git branch -D main`
 * were ALL allowed, silently, with nothing printed. The hook's own header
 * promises the opposite — "Malformed hook input fails CLOSED … a non-2 exit
 * would be a non-blocking hook error in Claude Code, silently failing open."
 *
 * The reasoning already existed at the bottom of the same file, for project
 * custom rules, where a malformed ERE used to silently disable a rule the
 * project believed it had. It was never extended to the built-in guards.
 *
 * ## Why this belongs to CodySwannGT/lisa#3054
 *
 * That ticket is about steps that fail on something environmental and report it
 * as a content failure, so the operator re-runs and the real condition is never
 * examined. This is that shape at its worst: the environmental failure's report
 * was the word "safe". The second describe below pins the reporting half —
 * sighting 3's assertion, `expected 'Blocked by safety-net: malformed or a…' to
 * contain 'git commit -F <file>'`, is reproduced exactly by a grep that cannot
 * answer, and must now name the machine instead.
 * @module tests/unit/hooks/parity-safety-net-scan-failure
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { withUnanswerableGrep } from "../../helpers/unanswerable-grep.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/**
 * Destructive commands assembled from fragments rather than written as
 * literals, so this file's own source is not a payload any scanner — including
 * the hook under test, when it guards a later edit to this repository — has to
 * reason about.
 */
const DESTRUCTIVE: readonly (readonly [string, string])[] = [
  ["a recursive forced delete of root", ["rm", "-rf", "/"].join(" ")],
  [
    "a force-push to a protected branch",
    ["git", "push", "--force", "origin", "main"].join(" "),
  ],
  ["a disk destroyer", ["dd", "if=/dev/zero", "of=/dev/disk0"].join(" ")],
  ["a forced branch delete", ["git", "branch", "-D", "main"].join(" ")],
  ["a recursive forced delete of home", ["rm", "-rf", "~/"].join(" ")],
];

/** A commit-shaped heredoc: the exact command from sighting 3's failing case. */
const COMMIT_HEREDOC = [
  'git commit -m "$(cat <<EOF',
  "feat: subject line",
  "EOF",
  ')"',
].join("\n");

/**
 * Run the shipped hook over one proposed command. Nothing is executed — the
 * hook is a classifier over a command string handed to it as PreToolUse JSON.
 * @param command - The proposed shell command.
 * @param env - Environment for the hook process.
 * @returns The hook's exit status and stderr.
 */
function classify(
  command: string,
  env: NodeJS.ProcessEnv
): { status: number | null; stderr: string } {
  const result = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [HOOK_PATH],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env,
  });
  return { status: result.status, stderr: result.stderr };
}

/**
 * Build a fixture whose scope scanner fails after the parent has selected an
 * otherwise ordinary recursive delete. This isolates the command-substitution
 * boundary: no earlier grep or guard is broken.
 * @returns The fixture hook path and its temporary directory.
 */
function hookWithFailingScope(): { hookPath: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rm-scope-fail-"));
  const hookPath = path.join(root, "parity-safety-net.sh");
  const source = fs.readFileSync(HOOK_PATH, "utf8");
  const marker = "rm_segments_status=0";
  expect(source).toContain(marker);
  fs.writeFileSync(
    hookPath,
    source.replace(
      marker,
      "rm_scan_scope() { return 37; }\n\nrm_segments_status=0"
    )
  );
  return { hookPath, root };
}

describe("a guard whose scan cannot run denies instead of allowing", () => {
  it.each(DESTRUCTIVE)(
    "still blocks %s when grep cannot answer",
    (_label, command) => {
      // THE regression. Pre-fix every one of these exited 0 — the safety net
      // silently stopped being a safety net the moment the machine could not
      // fork. Fail-closed is the hook's stated contract everywhere else.
      expect(classify(command, withUnanswerableGrep()).status).toBe(
        EXIT_BLOCKED
      );
    }
  );

  it.each(DESTRUCTIVE)(
    "blocks %s under a working grep too — the fix changed nothing here",
    (_label, command) => {
      // The control that keeps the arm above from being satisfied by a hook
      // that refuses everything for an unrelated reason.
      expect(classify(command, process.env).status).toBe(EXIT_BLOCKED);
    }
  );

  it("names the machine rather than the command", () => {
    // The reporting half, and the whole reason #3054 exists. A denial that
    // reads as a verdict on the command sends the operator to edit the command;
    // this one has to say the guard could not be evaluated at all.
    const { stderr } = classify(DESTRUCTIVE[0][1], withUnanswerableGrep());

    expect(stderr).toContain("FAILED TO RUN");
    expect(stderr).toContain("ENVIRONMENT failure");
    expect(stderr).toContain("per-user process limit");
    // And it must NOT claim the command matched a destructive pattern, which is
    // the thing it does not know.
    expect(stderr).not.toContain("matched a destructive-operation guard");
  });

  it("leaves an ordinary command alone under a working grep", () => {
    // The negative control. Without it, a hook that blocked everything would
    // pass every arm above and the suite would be measuring nothing.
    expect(classify("echo hello", process.env).status).toBe(EXIT_ALLOWED);
  });

  it("carries a scope-scan failure out of command substitution and denies in the parent", () => {
    const { hookPath, root } = hookWithFailingScope();
    try {
      const command = ["rm", "-rf", "build"].join(" ");
      const result = boundedSpawnSync({
        label: "parity-safety-net.sh with a failing scope scan",
        command: "/bin/bash",
        args: [hookPath],
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
        env: process.env,
      });

      expect(result.status).toBe(EXIT_BLOCKED);
      expect(result.stderr).toContain("grep exited 37");
      expect(result.stderr).toContain("denying fail-closed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a denial's remediation is never guessed from a scan that failed", () => {
  it("gives the commit remediation for a commit-shaped heredoc", () => {
    // The passing baseline. `block_heredoc` picks between two remediations by
    // grepping the command for a git-commit shape.
    const { status, stderr } = classify(COMMIT_HEREDOC, process.env);

    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain("git commit -F <file>");
  });

  it("reports the scan failure instead of the WRONG remediation", () => {
    // Sighting 3 on CodySwannGT/lisa#3054 was reported as this assertion
    // failing:
    //
    //   expected 'Blocked by safety-net: malformed or a…'
    //     to contain 'git commit -F <file>'
    //
    // and was attributed to a package being transiently unresolvable. It is
    // reproduced exactly by a grep that cannot answer: the git-commit shape
    // check returns >=2, the condition reads that as "not a commit", and the
    // hook prints the Write-tool remediation for a command that is a commit.
    // Pre-fix this case fails on `not.toContain("Write tool")`.
    const { status, stderr } = classify(COMMIT_HEREDOC, withUnanswerableGrep());

    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain("FAILED TO RUN");
    expect(stderr).not.toContain("Write tool");
  });
});

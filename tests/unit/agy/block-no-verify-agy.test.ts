/**
 * Unit tests for plugins/src/base/hooks/block-no-verify.agy.sh.
 *
 * The agy-protocol PreToolUse hook reads agy's stdin JSON
 * (`{ toolCall: { args: { CommandLine } } }`) and prints a JSON decision
 * (`{"decision":"deny"|"allow"}`) on stdout. Since headless firing is
 * quota-blocked, this script-logic test is the real verification. Payloads are
 * hardcoded (no coupling). Requires `jq` on PATH (used across the repo).
 *
 * The hook is invoked via a fixed interpreter (`/bin/bash <script>`), the same
 * way the sibling block-no-verify.test.ts runs the Claude hook. Running the
 * script directly by its absolute path relied on the `#!/usr/bin/env bash`
 * shebang, which adds an extra `execve` of `/usr/bin/env`, a PATH lookup for
 * `bash`, and a load-bearing executable bit. Under the fork/exec pressure of a
 * full `--coverage` run that indirect spawn could transiently fail to start;
 * because `cat` then never drained the stdin pipe, Node surfaced the failed
 * write as an EPIPE/spawn error and the test errored intermittently (it always
 * passed in isolation). Spawning a fixed interpreter removes the shebang, the
 * PATH lookup, and the exec-bit dependency, so the spawn is deterministic.
 * @module tests/unit/agy/block-no-verify-agy
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(
  process.cwd(),
  "plugins",
  "src",
  "base",
  "hooks",
  "block-no-verify.agy.sh"
);

const BASH_PATH = "/bin/bash";

// Run the hook with the given stdin and return the parsed `decision` field.
// Invokes the script through a fixed bash interpreter (not the shebang) so the
// spawn does not depend on the executable bit or a PATH lookup. A spawn failure
// is surfaced explicitly rather than masquerading as a JSON parse error.
const decide = (stdin: string): string => {
  const result = spawnSync(BASH_PATH, [SCRIPT], {
    input: stdin,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  return (JSON.parse(result.stdout) as { decision: string }).decision;
};

// Build an agy PreToolUse stdin payload for a run_command tool call.
const payload = (commandLine: string): string =>
  JSON.stringify({
    toolCall: { name: "run_command", args: { CommandLine: commandLine } },
  });

describe("block-no-verify.agy.sh", () => {
  it("denies a git commit with --no-verify", () => {
    expect(decide(payload("git commit --no-verify -m wip"))).toBe("deny");
  });

  it("denies git push --no-verify", () => {
    expect(decide(payload("git push --no-verify origin main"))).toBe("deny");
  });

  it("allows a normal git commit", () => {
    expect(decide(payload("git commit -m 'real message'"))).toBe("allow");
  });

  it("allows `git commit -n` — the short flag is intentionally NOT guarded", () => {
    // Parity with the Claude hook (only --no-verify); guarding -n false-positives
    // on commit-message prose and unrelated piped commands.
    expect(decide(payload("git commit -n -m wip"))).toBe("allow");
  });

  it("allows -n appearing in a commit message (no false positive)", () => {
    expect(decide(payload('git commit -m "fix the -n flag handling"'))).toBe(
      "allow"
    );
  });

  it("allows non-git commands that contain -n (e.g. echo -n)", () => {
    expect(decide(payload("echo -n hello"))).toBe("allow");
  });

  it("allows an unrelated command", () => {
    expect(decide(payload("ls -la /tmp"))).toBe("allow");
  });

  it("does not match longer flags like --no-verify-ssl", () => {
    expect(decide(payload("curl --no-verify-ssl https://example.com"))).toBe(
      "allow"
    );
  });

  it("denies HUSKY=0 (disables husky hooks)", () => {
    expect(decide(payload("HUSKY=0 git commit -m wip"))).toBe("deny");
  });

  it("denies HUSKY_SKIP_HOOKS=1 (disables husky hooks)", () => {
    expect(decide(payload("HUSKY_SKIP_HOOKS=1 git commit -m wip"))).toBe(
      "deny"
    );
  });

  it("allows HUSKY=1 (enabling husky, not a bypass)", () => {
    expect(decide(payload("HUSKY=1 git commit -m wip"))).toBe("allow");
  });

  it("denies core.hooksPath pointed at /dev/null", () => {
    expect(
      decide(payload("git -c core.hooksPath=/dev/null commit -m wip"))
    ).toBe("deny");
  });

  it("denies core.hooksPath set empty", () => {
    expect(decide(payload("git -c core.hooksPath= commit -m wip"))).toBe(
      "deny"
    );
  });

  it("allows a legit custom core.hooksPath", () => {
    expect(decide(payload("git -c core.hooksPath=.husky commit -m wip"))).toBe(
      "allow"
    );
  });

  it("allows on empty stdin (fail open, no crash)", () => {
    expect(decide("")).toBe("allow");
  });

  it("allows on malformed JSON (fail open, no crash)", () => {
    expect(decide("not json at all")).toBe("allow");
  });

  it("allows when CommandLine is absent", () => {
    expect(decide(JSON.stringify({ toolCall: { name: "run_command" } }))).toBe(
      "allow"
    );
  });
});

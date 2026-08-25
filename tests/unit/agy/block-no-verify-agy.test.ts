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
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

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
// is surfaced by `boundedSpawnSync` rather than masquerading as a JSON parse
// error.
const decide = (stdin: string): string => {
  const result = boundedSpawnSync({
    label: "the agy block-no-verify hook",
    command: BASH_PATH,
    args: [SCRIPT],
    input: stdin,
  });
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

  // The short form. This file was cited BY the Claude variant as the reason -n
  // went unguarded ("grep cannot distinguish a real -n option from prose") —
  // but neither variant greps, both tokenize, so the rationale described a
  // matcher that no longer existed. Measured against real git: `git commit -n`,
  // `-nm msg`, and `-anm msg` all commit with pre-commit never running.
  it("denies a bare `git commit -n`", () => {
    expect(decide(payload("git commit -n"))).toBe("deny");
  });

  it("denies `git commit -n -m wip`", () => {
    expect(decide(payload("git commit -n -m wip"))).toBe("deny");
  });

  it("denies the bundled cluster `-nm`", () => {
    expect(decide(payload('git commit -nm "msg"'))).toBe("deny");
  });

  it.each(["-nam", "-anm", "-an", "-na"])(
    "denies the longer cluster %s, where n is one flag among several",
    cluster => {
      expect(decide(payload(`git commit ${cluster} "msg"`))).toBe("deny");
    }
  );

  it("denies -n arriving after other flags on the invocation", () => {
    expect(decide(payload('git commit -am "wip" -n'))).toBe("deny");
  });

  it("denies -n when git carries global options before the subcommand", () => {
    expect(decide(payload("git -c core.hooksPath=.husky commit -nm wip"))).toBe(
      "deny"
    );
  });

  it("denies -n on the second command of a chain", () => {
    expect(decide(payload("echo hi && git commit -nm x"))).toBe("deny");
  });

  // The false positives the old rationale named. They are what justifies
  // tokenizing rather than widening to a substring match, so they are asserted
  // rather than assumed.
  it("allows a commit message that is exactly -n", () => {
    expect(decide(payload('git commit -m "-n"'))).toBe("allow");
  });

  it("allows -mn, which git reads as the message n", () => {
    expect(decide(payload("git commit -mn"))).toBe("allow");
  });

  it.each(["grep -n pattern file", "sort -n numbers.txt", "tail -n 5 log.txt"])(
    "allows the unrelated command %s",
    command => {
      expect(decide(payload(command))).toBe("allow");
    }
  );

  it("allows -n belonging to a different command in the pipeline", () => {
    expect(decide(payload("git commit -m x && grep -n foo file"))).toBe(
      "allow"
    );
  });

  it.each(["git push -n", "git merge -n topic", "git log -n 5"])(
    "allows %s, where -n is not a hook bypass",
    command => {
      expect(decide(payload(command))).toBe("allow");
    }
  );

  it("allows a pathspec named -n after the -- separator", () => {
    expect(decide(payload("git commit -m x -- -n"))).toBe("allow");
  });

  // A newline ends a command exactly as `;` does, but shlex reads it as plain
  // whitespace — so without normalizing it the two lines merge into one
  // invocation and the second line's -n is charged to the commit. Raised by
  // CodeRabbit on #3025, reproduced before it was fixed.
  it.each([
    "git commit -m x\ngrep -n foo file",
    "git commit -m x\ngit push -n",
  ])("allows a following LINE whose -n belongs to another command", command => {
    expect(decide(payload(command))).toBe("allow");
  });

  it("denies -nm reached across a backslash-newline continuation", () => {
    // The one newline that is NOT a boundary; joining it first is what keeps
    // normalizing the others from hiding a real bypass.
    expect(decide(payload("git commit \\\n  -nm x"))).toBe("deny");
  });

  it("allows --no-verify when it only appears in heredoc payload text", () => {
    expect(
      decide(
        payload(
          "gh issue create --body-file - <<'EOF'\nMention --no-verify in prose.\nEOF"
        )
      )
    ).toBe("allow");
  });

  it("recognizes an explicitly empty heredoc delimiter", () => {
    expect(
      decide(
        payload(
          "gh issue create --body-file - <<''\nMention --no-verify in prose.\n\n"
        )
      )
    ).toBe("allow");
  });

  it("allows --no-verify when it only appears in a message argument", () => {
    expect(
      decide(payload('gh issue comment 1 --body "Mention --no-verify."'))
    ).toBe("allow");
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

  it("denies quoted core.hooksPath pointed at /dev/null", () => {
    expect(
      decide(payload('git -c "core.hooksPath=/dev/null" commit -m wip'))
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

  // Parity with the Claude hook. These vectors reached agy sessions after they
  // were already closed on Claude, which is the failure mode the parity rule
  // exists to prevent: a bypass that survives by picking a different harness.
  it("denies core.hooksPath redirected to a directory that merely has no hooks", () => {
    expect(
      decide(payload("git -c core.hooksPath=/tmp/empty commit -m wip"))
    ).toBe("deny");
  });

  it.each(["CORE.HOOKSPATH", "core.hookspath", "Core.HooksPath"])(
    "denies the case variant %s, since git config names are case-insensitive",
    variable => {
      expect(
        decide(payload(`git -c ${variable}=/var/no-hooks commit -m wip`))
      ).toBe("deny");
    }
  );

  it("denies --config-env=core.hooksPath, which reads the path from an env var", () => {
    expect(
      decide(payload("git --config-env=core.hooksPath=HOOKS commit -m wip"))
    ).toBe("deny");
  });

  // The trailing word names an environment variable, not a path, so spelling
  // it `.husky` turned the hooksPath allowlist itself into the bypass.
  it.each([".husky", ".githooks", "HOOKS"])(
    "denies the separate-token --config-env core.hooksPath=%s",
    envVar => {
      expect(
        decide(
          payload(`git --config-env core.hooksPath=${envVar} commit -m wip`)
        )
      ).toBe("deny");
    }
  );

  it.each(["0", "1", "7", "42"])(
    "denies the GIT_CONFIG_KEY_%s=core.hooksPath env-var config override",
    index => {
      expect(
        decide(
          payload(
            `GIT_CONFIG_COUNT=${Number(index) + 1} GIT_CONFIG_KEY_${index}=core.hooksPath GIT_CONFIG_VALUE_${index}=/dev/null git commit -m wip`
          )
        )
      ).toBe("deny");
    }
  );

  it("allows GIT_CONFIG_KEY_<n> naming an unrelated setting", () => {
    expect(
      decide(
        payload(
          "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=CI git commit -m wip"
        )
      )
    ).toBe("allow");
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

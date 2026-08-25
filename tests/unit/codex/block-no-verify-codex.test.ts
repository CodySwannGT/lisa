/**
 * Unit tests for src/codex/scripts/block-no-verify.sh.
 *
 * The Codex PreToolUse hook reads the same `{ tool_name, tool_input.command }`
 * payload as the Claude hook but answers on stdout with a
 * `hookSpecificOutput.permissionDecision` of "deny", printing nothing at all
 * when the command is permitted. It always exits 0, so the decision — not the
 * status — is what these tests assert.
 *
 * This suite exists because the Codex variant had silently fallen behind the
 * Claude one: it still denylisted the two obvious hooksPath values, matched
 * config names case-sensitively, and knew nothing of `--config-env=` or the
 * `GIT_CONFIG_KEY_<n>` env-var override. A bypass that survives by switching
 * harness is still a bypass, so the vectors below are asserted per-agent rather
 * than assumed to follow from the Claude suite passing.
 *
 * The hook is invoked through a fixed interpreter (`/bin/bash <script>`) for
 * the same reason its agy sibling is: that removes the shebang's extra execve,
 * the PATH lookup, and the dependency on an executable bit, so the spawn is
 * deterministic under the fork/exec pressure of a full coverage run.
 * @module tests/unit/codex/block-no-verify-codex
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.join(
  process.cwd(),
  "src",
  "codex",
  "scripts",
  "block-no-verify.sh"
);

const BASH_PATH = "/bin/bash";

/**
 * Run the hook against one Bash command and report its permission decision.
 *
 * @param command - The Bash command line the hook is asked to vet.
 * @returns "deny" when the hook refuses the command, "allow" when it stays
 *   silent (the Codex protocol's way of permitting a command).
 */
const decide = (command: string): string => {
  const result = boundedSpawnSync({
    label: "block-no-verify.sh",
    command: BASH_PATH,
    args: [SCRIPT],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
  });
  if (result.stdout.trim() === "") {
    return "allow";
  }
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  return parsed.hookSpecificOutput.permissionDecision;
};

describe("block-no-verify.sh (Codex variant)", () => {
  it("denies git commit --no-verify", () => {
    expect(decide("git commit --no-verify -m wip")).toBe("deny");
  });

  it("denies an abbreviation git would accept as --no-verify", () => {
    expect(decide("git commit --no-veri -m wip")).toBe("deny");
  });

  it("recognizes an explicitly empty heredoc delimiter", () => {
    expect(
      decide(
        "gh issue create --body-file - <<''\nMention --no-verify in prose.\n\n"
      )
    ).toBe("allow");
  });

  // The short form, scoped to a `git commit` argv. Parity with the Claude and
  // agy variants, which carry the full rationale: all three tokenize, so the
  // "grep cannot tell an option from prose" argument that kept -n unguarded
  // described a matcher none of them uses.
  it("denies a bare git commit -n", () => {
    expect(decide("git commit -n")).toBe("deny");
  });

  it("denies the bundled cluster -nm", () => {
    expect(decide('git commit -nm "msg"')).toBe("deny");
  });

  it.each(["-nam", "-anm", "-an"])(
    "denies the longer cluster %s, where n is one flag among several",
    cluster => {
      expect(decide(`git commit ${cluster} "msg"`)).toBe("deny");
    }
  );

  it("denies -n arriving after other flags on the invocation", () => {
    expect(decide('git commit -am "wip" -n')).toBe("deny");
  });

  it("denies HUSKY=0", () => {
    expect(decide("HUSKY=0 git commit -m wip")).toBe("deny");
  });

  it("denies core.hooksPath pointed at /dev/null", () => {
    expect(decide("git -c core.hooksPath=/dev/null commit -m wip")).toBe(
      "deny"
    );
  });

  it("denies core.hooksPath redirected to a directory that merely has no hooks", () => {
    // The bypass a denylist of "obviously disabling" values can never catch:
    // any directory containing no hooks disables them as completely as
    // /dev/null, so the permitted destinations are what get enumerated.
    expect(decide("git -c core.hooksPath=/tmp/empty commit -m wip")).toBe(
      "deny"
    );
  });

  it.each(["CORE.HOOKSPATH", "core.hookspath", "Core.HooksPath"])(
    "denies the case variant %s, since git config names are case-insensitive",
    variable => {
      expect(decide(`git -c ${variable}=/var/no-hooks commit -m wip`)).toBe(
        "deny"
      );
    }
  );

  it("denies --config-env=core.hooksPath, which reads the path from an env var", () => {
    expect(decide("git --config-env=core.hooksPath=HOOKS commit -m wip")).toBe(
      "deny"
    );
  });

  // The trailing word names an environment variable, not a path, so spelling
  // it `.husky` turned the hooksPath allowlist itself into the bypass.
  it.each([".husky", ".githooks", "HOOKS"])(
    "denies the separate-token --config-env core.hooksPath=%s",
    envVar => {
      expect(
        decide(`git --config-env core.hooksPath=${envVar} commit -m wip`)
      ).toBe("deny");
    }
  );

  it.each(["0", "1", "7", "42"])(
    "denies the GIT_CONFIG_KEY_%s=core.hooksPath env-var config override",
    index => {
      expect(
        decide(
          `GIT_CONFIG_COUNT=${Number(index) + 1} GIT_CONFIG_KEY_${index}=core.hooksPath GIT_CONFIG_VALUE_${index}=/dev/null git commit -m wip`
        )
      ).toBe("deny");
    }
  );

  it("allows a normal git commit", () => {
    expect(decide("git commit -m 'real message'")).toBe("allow");
  });

  it("allows the in-repo hooks directory .husky", () => {
    expect(decide("git -c core.hooksPath=.husky commit -m wip")).toBe("allow");
  });

  it("allows GIT_CONFIG_KEY_<n> naming an unrelated setting", () => {
    expect(
      decide(
        "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=CI git commit -m wip"
      )
    ).toBe("allow");
  });

  it("allows --no-verify-ssl, a different flag that shares the stem", () => {
    expect(decide("curl --no-verify-ssl https://example.com")).toBe("allow");
  });

  // The -n false positives the old rationale named. Asserted rather than
  // assumed: they are what justifies scoping the match to a `git commit` argv
  // instead of widening it to a substring.
  it("allows a commit message that is exactly -n", () => {
    expect(decide('git commit -m "-n"')).toBe("allow");
  });

  it("allows -mn, which git reads as the message n", () => {
    expect(decide("git commit -mn")).toBe("allow");
  });

  it.each(["grep -n pattern file", "sort -n numbers.txt", "tail -n 5 log.txt"])(
    "allows the unrelated command %s",
    command => {
      expect(decide(command)).toBe("allow");
    }
  );

  it("allows -n belonging to a different command in the pipeline", () => {
    expect(decide("git commit -m x && grep -n foo file")).toBe("allow");
  });

  it.each(["git push -n", "git merge -n topic"])(
    "allows %s, where -n is not a hook bypass",
    command => {
      expect(decide(command)).toBe("allow");
    }
  );

  // A newline ends a command exactly as `;` does, but shlex reads it as plain
  // whitespace. Raised by CodeRabbit on #3025, reproduced before it was fixed.
  it("allows a following LINE whose -n belongs to another command", () => {
    expect(decide("git commit -m x\ngrep -n foo file")).toBe("allow");
  });

  it("denies -nm reached across a backslash-newline continuation", () => {
    // The one newline that is NOT a boundary.
    expect(decide("git commit \\\n  -nm x")).toBe("deny");
  });
});

/**
 * Cross-agent regressions for command-scoped hook configuration and herestrings.
 *
 * Both bugs lived in the shared Python parser but reached three different hook
 * protocols. Running each protocol keeps a source-only fix from leaving one
 * agent's emitted guard behind.
 * @module tests/unit/hooks/block-no-verify-command-config
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** One protocol-normalized guard verdict. */
type Decision = "allow" | "deny";

const BASH = "/bin/bash";
const CLAUDE = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const CODEX = path.resolve("src/codex/scripts/block-no-verify.sh");
const AGY = path.resolve("plugins/lisa/hooks/block-no-verify.agy.sh");

/**
 * Run the Claude protocol, where exit 2 is a refusal.
 * @param command Shell command to inspect.
 * @returns The normalized verdict.
 */
function claude(command: string): Decision {
  const result = boundedSpawnSync({
    label: "Claude no-verify command-config guard",
    command: BASH,
    args: [CLAUDE],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });
  return result.status === 2 ? "deny" : "allow";
}

/**
 * Run the Codex protocol, where a structured stdout decision is a refusal.
 * @param command Shell command to inspect.
 * @returns The normalized verdict.
 */
function codex(command: string): Decision {
  const result = boundedSpawnSync({
    label: "Codex no-verify command-config guard",
    command: BASH,
    args: [CODEX],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });
  if (result.stdout.trim() === "") return "allow";
  const output = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { permissionDecision?: string };
  };
  return output.hookSpecificOutput?.permissionDecision === "deny"
    ? "deny"
    : "allow";
}

/**
 * Run the Antigravity protocol, whose stdout carries allow or deny.
 * @param command Shell command to inspect.
 * @returns The normalized verdict.
 */
function agy(command: string): Decision {
  const result = boundedSpawnSync({
    label: "Antigravity no-verify command-config guard",
    command: BASH,
    args: [AGY],
    input: JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: command } },
    }),
  });
  const output = JSON.parse(result.stdout) as { decision?: string };
  return output.decision === "deny" ? "deny" : "allow";
}

const ADAPTERS = [
  ["Claude", claude],
  ["Codex", codex],
  ["Antigravity", agy],
] as const;

describe.each(ADAPTERS)("%s command-scope no-verify guard", (_name, decide) => {
  it.each([
    `env -S 'bash -c "git commit --no-verify"'`,
    `env -v -S 'bash -c "git commit --no-verify"'`,
    `env -vS 'sh -c "git commit -n"'`,
    `env -S'bash -c "git commit -n"'`,
    `env --split-string 'sh -c "git commit -n"'`,
    `env --split-string='bash -c "git commit -n"'`,
  ])("refuses the ambiguous split-string invocation %s", command => {
    expect(decide(command)).toBe("deny");
  });

  // GNU's getopt_long resolves any prefix that names exactly one option, and
  // nothing but --split-string starts with `s`. Matching the full spelling
  // only meant the vector was reopened by deleting characters: every form
  // below reparses its payload for real and every one was ALLOWED before.
  it.each([
    `env --s 'git commit --no-verify -m x'`,
    `env --sp 'git commit --no-verify -m x'`,
    `env --spl 'git commit -n'`,
    `env --spli 'git commit -n'`,
    `env --split 'git commit --no-verify -m x'`,
    `env --split-s 'git commit -n'`,
    `env --split-str 'git commit -n'`,
    `env --split-strin 'git commit -n'`,
    `env --s='git commit --no-verify -m x'`,
    `env --sp='git commit -n'`,
    `env --split='git commit --no-verify -m x'`,
    `env --ignore-environment --split-s 'git commit --no-verify -m x'`,
  ])("refuses the split-string abbreviation in %s", command => {
    expect(decide(command)).toBe("deny");
  });

  // Wrappers that run whatever FOLLOWS them without changing what it is. The
  // prefix check demanded assignments only, so a single `command` in front of
  // `env` made the whole invocation unclassifiable and it was let through.
  it.each([
    `command env -S 'git commit --no-verify -m x'`,
    `exec env -S 'git commit -n'`,
    `builtin command env -S 'git commit -n'`,
    `nohup env --split-string 'git commit -n'`,
    `setsid env -S 'git commit --no-verify -m x'`,
    `exec -a shell env -S 'git commit -n'`,
    `env -- env -S 'git commit --no-verify -m x'`,
    `env env -S 'git commit -n'`,
    `env -i env --sp 'git commit -n'`,
    `env -u FOO env -S 'git commit -n'`,
    `FOO=1 command env --split 'git commit --no-verify -m x'`,
    `command /usr/bin/env -S 'git commit -n'`,
  ])("refuses the wrapped split-string invocation in %s", command => {
    expect(decide(command)).toBe("deny");
  });

  it("still permits env prefixes that do not reparse an opaque string", () => {
    expect(decide(`env TESTING=1 bash -c 'git commit -m safe'`)).toBe("allow");
    expect(decide(`env -uSOME_VAR bash -c 'git commit -m safe'`)).toBe("allow");
  });

  it.each([
    // Long options that are NOT abbreviations of --split-string.
    `env --version`,
    `env --null`,
    `env --ignore-environment git status`,
    `env --unset=HOME git status`,
    `env --chdir /tmp git status`,
    // Wrappers in front of something benign.
    `command env -i git status`,
    `env -u HUSKY git status`,
    `env -0 printenv`,
    `nohup npm test`,
    // The abbreviation only as prose, never as an argv option.
    `git commit -m 'mention env --sp in the message'`,
  ])("still permits %s", command => {
    expect(decide(command)).toBe("allow");
  });

  it.each([
    `GIT_CONFIG_PARAMETERS="'core.hooksPath'='/dev/null'" git commit -m x`,
    `GIT_CONFIG_PARAMETERS="'core.hooksPath=/tmp/no-hooks'" git commit -m x`,
    `GIT_CONFIG_PARAMETERS="'user.name'='CI' 'CORE.HOOKSPATH'='/tmp/no-hooks'" git commit -m x`,
    `GIT_CONFIG_PARAMETERS+="'core.hooksPath'='/dev/null'" git commit -m x`,
    `GIT_CONFIG_PARAMETERS+="'user.name'='CI' 'CORE.HOOKSPATH'='/tmp/no-hooks'" git commit -m x`,
  ])("refuses a hooksPath parameter in %s", command => {
    expect(decide(command)).toBe("deny");
  });

  it("does not mistake a value that names core.hooksPath for the key", () => {
    for (const assignment of ["=", "+="]) {
      expect(
        decide(
          `GIT_CONFIG_PARAMETERS${assignment}"'user.name'='core.hooksPath'" git commit -m x`
        )
      ).toBe("allow");
    }
  });

  it.each([
    'GIT_CONFIG_PARAMETERS="$PARAMS" git commit -m x',
    'GIT_CONFIG_PARAMETERS="${PARAMS}" git commit -m x',
    'GIT_CONFIG_PARAMETERS="$(printf %s "$PARAMS")" git commit -m x',
    'GIT_CONFIG_PARAMETERS=`printf %s "$PARAMS"` git commit -m x',
  ])("refuses an unresolved parameter assignment in %s", command => {
    expect(decide(command)).toBe("deny");
  });

  it("parses the complete mixed-quote heredoc delimiter word", () => {
    const command = [
      "cat <<EOF'x'",
      "prose",
      "EOF",
      "git commit --no-verify -m hidden-in-heredoc",
      "EOFx",
    ].join("\n");
    expect(decide(command)).toBe("allow");
  });

  it("keeps a bypass after a herestring visible", () => {
    expect(decide('grep -q foo <<<"$value"\ngit commit --no-verify -m x')).toBe(
      "deny"
    );
  });

  it("allows an ordinary command after a herestring", () => {
    expect(decide('grep -q foo <<<"$value"\ngit commit -m x')).toBe("allow");
  });
});

/** Literal display arguments are data; execution and output targets stay guarded. */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const hooks = ["parity-safety-net", "block-instruction-file-edits"] as const;

/**
 * Ask the actual hook to classify text, without executing the proposed command.
 * @param hook Guard name to invoke.
 * @param command Proposed command, passed as data to the guard.
 * @returns The guard's exit status.
 */
function classify(hook: string, command: string): number | null {
  return boundedSpawnSync({
    label: hook,
    command: "/bin/bash",
    args: [path.resolve(`plugins/src/base/hooks/${hook}.sh`)],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      LISA_ALLOW_INSTRUCTION_FILE_WRITE: "",
    },
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  }).status;
}

describe.each(hooks)("%s literal display content", hook => {
  it.each([
    "printf '%s' 'git checkout -- README.md; tee AGENTS.md' > /tmp/notes.md",
    'printf "%s\\n" "git checkout -- README.md; tee CLAUDE.md" >> /tmp/notes.md',
    "echo 'rm -rf /opt/important; sed -i s/a/b/ AGENTS.md'",
    "printf '%s' 'Examples: > CLAUDE.md and git checkout -- README.md' >| /tmp/notes.md",
    "printf '%s' 'literal $(rm -rf /opt/important); tee AGENTS.md' > /tmp/notes.md",
    "printf '%s' 'quoted pipe | bash and tee AGENTS.md' > '/tmp/notes with spaces.md'",
  ])("allows literal output: %s", command => {
    expect(classify(hook, command)).toBe(0);
  });
});

describe("display content cannot hide execution", () => {
  it.each([
    "printf \"$FORMAT\" 'rm -rf /opt/important'",
    "printf '%s' 'rm -rf /opt/important' | bash",
    "printf '%s' notes; rm -rf /opt/important",
    'printf "%s" "$(rm -rf /opt/important)"',
    'printf "%s" "`rm -rf /opt/important`"',
    "printf '%s' notes > >(rm -rf /opt/important)",
    "printf '%s' 'rm -rf /opt/important' > /tmp/script.sh; bash /tmp/script.sh",
    "eval \"printf '%s' notes; rm -rf /opt/important\"",
  ])("retains destructive refusal: %s", command => {
    expect(classify("parity-safety-net", command)).toBe(2);
  });

  it.each([
    "printf '%s' notes > AGENTS.md",
    "printf '%s' notes >> 'CLAUDE.md'",
    "echo notes >| .github/copilot-instructions.md",
    "printf '%s' notes | tee AGENTS.md",
    "printf '%s' notes; tee AGENTS.md",
    'printf "%s" "$(tee AGENTS.md)"',
  ])("retains protected write refusal: %s", command => {
    expect(classify("block-instruction-file-edits", command)).toBe(2);
  });
});

describe("formats that can write or expand keep the original guard input", () => {
  it.each(["%n", "%10n", "$FORMAT", "*", "?", "[a-z]", "~"])(
    "does not project format %s",
    format => {
      const command = `printf ${format} written`;
      const result = boundedSpawnSync({
        label: "literal display classification",
        command: "python3",
        args: [
          path.resolve("plugins/src/base/hooks/parity-safety-net-heredoc.py"),
          "--literal-display",
        ],
        input: command,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(command);
    }
  );
});

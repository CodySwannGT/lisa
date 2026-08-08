/**
 * Tests for block-instruction-file-edits.sh — the PreToolUse guard that refuses
 * agent writes to the session-instruction files (AGENTS.md, CLAUDE.md,
 * .github/copilot-instructions.md).
 *
 * The guard exists because Lisa's prose contract ("CLAUDE.md is human-authored
 * ... apply never writes to any of the three") did not hold: fleet repos
 * accumulated hundreds of lines of agent-appended trap dumps. These tests pin
 * both arms — the edit tools and the Bash write signatures — and, just as
 * importantly, pin the reads and the marker-bounded Lisa writes that must
 * still pass.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-instruction-file-edits.sh"
);
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (
  payload: unknown,
  env: Readonly<Record<string, string>> = {}
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [SCRIPT_PATH], {
    env: { ...process.env, LISA_ALLOW_INSTRUCTION_FILE_WRITE: "", ...env },
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });
  return { status: result.status, stderr: result.stderr };
};

const edit = (toolName: string, filePath: string, newString = "some text") => ({
  tool_name: toolName,
  tool_input: { file_path: filePath, new_string: newString },
});

const bash = (command: string) => ({
  tool_name: "Bash",
  tool_input: { command },
});

describe("block-instruction-file-edits.sh", () => {
  describe("edit tools", () => {
    it.each([
      ["Edit", "AGENTS.md"],
      ["Write", "CLAUDE.md"],
      ["MultiEdit", "/repo/projects/frontend/AGENTS.md"],
      ["Write", ".github/copilot-instructions.md"],
    ])("blocks %s on %s", (tool, file) => {
      const { status } = runHook(edit(tool, file));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks a lowercase agents.md (case-insensitive basename match)", () => {
      const { status } = runHook(edit("Edit", "agents.md"));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows edits to any other markdown file", () => {
      const { status } = runHook(edit("Edit", "wiki/architecture/overview.md"));

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows edits to a vendored copy under node_modules", () => {
      const { status } = runHook(
        edit("Edit", "node_modules/@codyswann/lisa/AGENTS.md")
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("blocks when a MultiEdit carries the path per edit", () => {
      const { status } = runHook({
        tool_name: "MultiEdit",
        tool_input: {
          edits: [{ file_path: "AGENTS.md", new_string: "trap notes" }],
        },
      });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("bash write signatures", () => {
    it.each([
      ["append redirection", "echo 'trap' >> AGENTS.md"],
      ["truncating redirection", "printf '%s' x > CLAUDE.md"],
      ["heredoc into the file", "cat > AGENTS.md <<'EOF'\nnotes\nEOF"],
      ["tee append", "echo note | tee -a projects/frontend/AGENTS.md"],
      ["in-place sed", "sed -i '' 's/a/b/' AGENTS.md"],
      // `>|` overrides noclobber and truncates exactly like `>`. The target
      // character class excludes `|`, so this spelling terminated the match and
      // slipped through.
      ["noclobber-override redirection", "printf '%s' x >| AGENTS.md"],
      ["noclobber-override, no space", "printf '%s' x >|AGENTS.md"],
      ["explicit fd redirection", "printf '%s' x 1> CLAUDE.md"],
    ])("blocks %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_BLOCKED);
    });

    it.each([
      ["cat read", "cat AGENTS.md"],
      ["ripgrep search", "rg 'deploy' AGENTS.md"],
      ["redirecting a read elsewhere", "cat AGENTS.md > /tmp/copy.txt"],
      ["wc read", "wc -l CLAUDE.md"],
    ])("allows %s", (_label, command) => {
      const { status } = runHook(bash(command));

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows an unrelated command that never names the files", () => {
      const { status } = runHook(bash("echo hello >> notes.md"));

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("exemptions", () => {
    it("allows the write when the operator override is set", () => {
      const { status } = runHook(edit("Edit", "AGENTS.md"), {
        LISA_ALLOW_INSTRUCTION_FILE_WRITE: "1",
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a Lisa marker-bounded region (agy learnings bridge)", () => {
      // The marker has to be in the region being REPLACED. A real Edit always
      // carries old_string — the tool schema requires it — so this is the shape
      // the guard actually sees when the bridge's block is rewritten in place.
      const { status } = runHook({
        tool_name: "Edit",
        tool_input: {
          file_path: "AGENTS.md",
          old_string:
            "<!-- LISA_PROJECT_LEARNINGS_START -->\nold\n<!-- LISA_PROJECT_LEARNINGS_END -->",
          new_string:
            "<!-- LISA_PROJECT_LEARNINGS_START -->\nbridge\n<!-- LISA_PROJECT_LEARNINGS_END -->",
        },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("blocks a marker present only in the text being written", () => {
      // The forgery the exemption used to permit. Scanning the whole payload
      // meant any caller could paste `<!-- LISA_` into its new content and walk
      // past the guard; old_string is the only field that attests to what is
      // already on disk.
      const { status } = runHook({
        tool_name: "Edit",
        tool_input: {
          file_path: "AGENTS.md",
          old_string: "some existing prose",
          new_string:
            "<!-- LISA_PROJECT_LEARNINGS_START -->\ninjected\n<!-- LISA_PROJECT_LEARNINGS_END -->\nplus unbounded prose",
        },
      });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks a Write carrying a marker in its content", () => {
      // Write clobbers the whole file and has no old_string, so it is exactly
      // the unbounded case and can never be exempt however it is marked.
      const { status } = runHook({
        tool_name: "Write",
        tool_input: {
          file_path: "AGENTS.md",
          content:
            "<!-- LISA_PROJECT_LEARNINGS_START -->\nwhole new file\n<!-- LISA_PROJECT_LEARNINGS_END -->",
        },
      });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("refusal message", () => {
    it("names the file, the reason, and all four routing destinations", () => {
      const { stderr } = runHook(edit("Edit", "AGENTS.md"));

      expect(stderr).toContain("AGENTS.md");
      expect(stderr).toContain("session-instruction file");
      expect(stderr).toContain("/lisa:persist-learning");
      expect(stderr).toContain("SKILL.md");
      expect(stderr).toContain("/lisa:cross-pollinate");
      expect(stderr).toContain("LISA_ALLOW_INSTRUCTION_FILE_WRITE=1");
    });
  });

  describe("unrelated payloads", () => {
    it("ignores tools it does not guard", () => {
      const { status } = runHook({
        tool_name: "Read",
        tool_input: { file_path: "AGENTS.md" },
      });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

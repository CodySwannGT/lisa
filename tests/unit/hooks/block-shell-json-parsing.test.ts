/**
 * Tests for the block-shell-json-parsing.sh hook behavior.
 *
 * The hook blocks structural JSON parsing with text tools (grep/sed/cut/awk)
 * on *.json inputs — the executable control promoted from the PROJECT_RULES.md
 * "always use jq" prose (gardener issue #1787). It must stay precision-first:
 * plain text search over JSON files, .jsonl streams, non-JSON files, and any
 * command that already invokes jq are all allowed.
 * @module tests/unit/hooks/block-shell-json-parsing
 */
import { spawnSync } from "child_process";
import path from "path";

const HOOK_PATH = path.resolve(
  "plugins/lisa/hooks/block-shell-json-parsing.sh"
);
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (
  toolName: string,
  command: string
): { status: number | null; stderr: string } => {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  });

  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    input,
    encoding: "utf-8",
  });

  return { status: result.status, stderr: result.stderr };
};

describe("block-shell-json-parsing.sh", () => {
  describe("blocks structural JSON extraction with text tools", () => {
    it("blocks grep piped onward to cut with a quote delimiter", () => {
      const { status, stderr } = runHook(
        "Bash",
        `grep '"version"' package.json | cut -d'"' -f4`
      );
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("Use jq");
      expect(stderr).toContain("jq -r '.field' file.json");
    });

    it("blocks sed -i on a .json file", () => {
      const { status } = runHook("Bash", "sed -i 's/x/y/' config.json");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks sed with an s/// program on a .json file", () => {
      const { status } = runHook("Bash", `sed 's/"old"/"new"/' settings.json`);
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks awk field extraction with -F on a .json file", () => {
      const { status } = runHook("Bash", `awk -F: '{print $2}' data.json`);
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks awk $N field programs on a json-derived stream", () => {
      const { status } = runHook(
        "Bash",
        `cat package.json | grep name | awk '{print $2}'`
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks cut with a structural delimiter reading a .json redirection", () => {
      const { status } = runHook("Bash", "cut -d: -f2 < package.json");
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks grep -o value extraction on a .json file", () => {
      const { status } = runHook(
        "Bash",
        `grep -o '"version": "[^"]*"' package.json`
      );
      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows compliant and search-only usage", () => {
    it("allows jq reads", () => {
      const { status } = runHook("Bash", "jq -r '.version' package.json");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows mixed pipelines that invoke jq anywhere", () => {
      const { status } = runHook(
        "Bash",
        "jq -r '.items[].name' data.json | grep -c widget"
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows plain grep search over a .json file (no extraction)", () => {
      const { status } = runHook("Bash", "grep version package.json");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows grep -l file discovery over .json globs", () => {
      const { status } = runHook("Bash", "grep -l pattern config.json");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows cat piped to plain grep (search, not extraction)", () => {
      const { status } = runHook("Bash", "cat package.json | grep version");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows rg over .json files (not a blocked tool)", () => {
      const { status } = runHook("Bash", "rg version package.json");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows text tools over .jsonl streams", () => {
      const { status } = runHook("Bash", "cat data.jsonl | grep foo");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows sed on non-JSON files", () => {
      const { status } = runHook("Bash", `sed 's/foo/bar/' README.md`);
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows --json CLI flags (not a file reference)", () => {
      const { status } = runHook("Bash", "gh issue list --json number,body");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows commands with no .json reference at all", () => {
      const { status } = runHook("Bash", "git status");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("ignores .json mentions inside heredoc payload text", () => {
      const command = [
        "cat > notes.txt <<'EOF'",
        "see sed -i tricks for package.json parsing",
        "EOF",
      ].join("\n");
      const { status } = runHook("Bash", command);
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("envelope handling", () => {
    it("ignores non-Bash tools", () => {
      const { status } = runHook("Read", "sed -i 's/x/y/' config.json");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows empty commands", () => {
      const { status } = runHook("Bash", "");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

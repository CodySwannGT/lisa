/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks agent writes to the session-instruction files (`AGENTS.md`,
 * `CLAUDE.md`, `.github/copilot-instructions.md`). These are human-authored and
 * curated: every line is loaded into every agent's context in every future
 * session for the project. Agents appending their own findings is how they grow
 * into hundreds of lines of stale, ticket-specific trivia.
 *
 * Port of Lisa's canonical hook `block-instruction-file-edits.sh`. OpenCode
 * exposes only `edit` / `write` filesystem tools (no `apply_patch`), so the file
 * path comes straight from `output.args.filePath`. Throwing in
 * `tool.execute.before` cancels the tool call and surfaces the message to the
 * agent.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export /**
 *
 */
const LisaBlockInstructionFileEdits = async () => {
  const INSTRUCTION_FILES = new Set([
    "agents.md",
    "claude.md",
    "copilot-instructions.md",
  ]);
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: { filePath?: string; content?: string } }
    ) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(output.args?.filePath ?? "");
      if (!filePath) return;
      if (/(^|\/)(node_modules|dist)\//.test(filePath)) return;
      // The operator's explicit override, named in the refusal below.
      if (process.env["LISA_ALLOW_INSTRUCTION_FILE_WRITE"]) return;
      // Lisa's own marker-bounded regions replace in place and cannot grow the
      // file, so they are never the unbounded append this guard exists to stop.
      if (String(output.args?.content ?? "").includes("<!-- LISA_")) return;
      const base = (filePath.split("/").pop() ?? "").toLowerCase();
      if (!INSTRUCTION_FILES.has(base)) return;
      throw new Error(
        [
          `block-instruction-file-edits: refusing to write ${filePath}.`,
          "",
          "WHY: this is a session-instruction file, not a place to record what",
          "you just learned. Every line in it loads into the context of every",
          "agent, in every future session, in this project, forever. It is",
          "human-curated on purpose.",
          "",
          "WHERE IT GOES INSTEAD — take the first one that fits:",
          "",
          "1. Every agent needs it every session, only in this project? That is a",
          "   project rule — capture it with /lisa:persist-learning so it lands in",
          "   the learnings ledger. The gardener (/lisa:learnings:audit) proposes",
          "   promotion into the host-rules directory .agents/rules/ as a human-gated ticket.",
          "2. It changes how an existing skill behaves? Edit that skill's SKILL.md.",
          "3. It is true beyond this project? Propose it upstream via",
          "   /lisa:cross-pollinate, or open an issue on CodySwannGT/lisa.",
          "4. Otherwise it is background, not a standing instruction — write it",
          "   into the project documentation (wiki/ or docs/).",
          "",
          "If a human explicitly asked for this edit, re-run with",
          "LISA_ALLOW_INSTRUCTION_FILE_WRITE=1 set.",
        ].join("\n")
      );
    },
  };
};

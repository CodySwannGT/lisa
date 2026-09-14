/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks agent writes to the session-instruction files (`AGENTS.md`,
 * `CLAUDE.md`, `.github/copilot-instructions.md`). These are human-authored and
 * curated: every line is loaded into every agent's context in every future
 * session for the project. Agents appending their own findings is how they grow
 * into hundreds of lines of stale, ticket-specific trivia.
 *
 * Adapter for Lisa's hook `block-instruction-file-edits.sh`. This adapter
 * handles `edit` / `write`; shell screening belongs to the shell dispatcher
 * where installed. The file path comes from `output.args.filePath`. Throwing in
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
      // Existing operator-configured override; not proof of conversation approval.
      if (process.env["LISA_ALLOW_INSTRUCTION_FILE_WRITE"]) return;
      // Existing parity gap: this adapter accepts a content marker; the shell
      // guard requires bounded old/new replacement pairs. Do not describe this
      // weaker exemption as authorization or proof that an edit cannot grow.
      if (String(output.args?.content ?? "").includes("<!-- LISA_")) return;
      const base = (filePath.split("/").pop() ?? "").toLowerCase();
      if (!INSTRUCTION_FILES.has(base)) return;
      throw new Error(
        [
          `block-instruction-file-edits: refusing to write ${filePath}.`,
          "",
          "WHY: this session-instruction file is loaded into future agent sessions.",
          "Appending incidental findings makes every later session carry those notes.",
          "This adapter cannot read or authenticate conversation approval.",
          "",
          "If an operator already requested a standing-rule edit, that authorization",
          "is enough for the requested change. Use the relevant topic file in",
          ".agents/rules/ when no other destination was specified. All six agents",
          "read it through the existing AGENTS.md pointer. Edit it directly; do not",
          "require learning capture, another ticket, or repeated approval.",
          "",
          "If the operator explicitly named this guarded file, preserve that target",
          "and use the runtime's authorized edit path, or report this restriction.",
          "Do not silently move the edit, switch tools to evade this refusal, or",
          "set an override yourself. The existing operator-configured",
          "LISA_ALLOW_INSTRUCTION_FILE_WRITE=1 escape hatch is not proof of consent.",
          "",
          "For an agent's own finding, first decide whether it is worth maintaining.",
          "Decline one-off trivia and unnecessary rules. Durable project knowledge",
          "can use /lisa:persist-learning; procedures belong with their SKILL.md;",
          "background belongs in existing documentation. Use /lisa:cross-pollinate",
          "only for a material, reusable upstream improvement.",
        ].join("\n")
      );
    },
  };
};

/**
 * Lisa-managed OpenCode plugin (tool.execute.before).
 *
 * Blocks edits to TypeORM migration files. Use `bun run migration:generate`
 * to regenerate from entity diffs instead — hand-written migrations drift from
 * entity metadata and break the schema/migration contract.
 *
 * Port of Lisa's Codex hook `block-migration-edits.sh`. OpenCode exposes only
 * `edit` / `write` filesystem tools (no `apply_patch`), so the file path comes
 * straight from `output.args.filePath`. Throwing in `tool.execute.before`
 * cancels the tool call and surfaces the message to the agent (verified-by-run
 * on opencode 1.16.2).
 * This adapter does not delegate to a project's migration-provenance check;
 * unlike the Claude and Codex adapters, it cannot permit those exceptions.
 * It neither verifies human approval nor inspects Bash writes.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export /**
 *
 */
const LisaBlockMigrationEdits = async () => {
  const MIGRATION_RE = /\/migrations\/[^/]*\d[^/]*-[^/]*\.ts$/;
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: { filePath?: string } }
    ) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(output.args?.filePath ?? "");
      if (!filePath || !MIGRATION_RE.test(filePath)) return;
      throw new Error(
        [
          `block-migration-edits: refusing to modify ${filePath}.`,
          "",
          "TypeORM migrations must be regenerated from entity diffs:",
          "  bun run migration:generate -- src/database/migrations/<descriptive-name>",
          "",
          "Out-of-band migrations (backfills, seed data, maintenance) cannot",
          "always come from entity diffs. Document their rationale and verification.",
          "",
          "This OpenCode adapter only inspects edit/write and cannot verify",
          "human approval. It does not yet support the project migration-provenance",
          "exception check available in the Claude and Codex adapters, so it keeps",
          "refusing this edit. Do not switch tools to evade the refusal.",
        ].join("\n")
      );
    },
  };
};

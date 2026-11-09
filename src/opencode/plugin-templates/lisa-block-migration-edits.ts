/**
 * Lisa-managed OpenCode plugin (tool.execute.after).
 *
 * WARNS after an edit/write to a TypeORM migration file; it never cancels the
 * edit. The name is historical — renaming it would orphan installed copies.
 *
 * Why a warning (operator decision, 2026-11-08): the risk of a hand-written
 * migration is drift from the entity definitions, and it only exists when the
 * change could have been expressed in an entity. View options, grants,
 * functions, policies, backfills and seed data cannot be, so refusing every
 * migration edit blocked legitimate work.
 *
 * Port of Lisa's Codex hook `block-migration-edits.sh`. `tool.execute.before`
 * can only cancel a call (by throwing) — it has no channel for a message that
 * lets the call proceed — so the warning moves to `tool.execute.after`, which
 * appends it to the tool's output text, the part the agent reads. Appending to
 * `output.output` is the documented plugin API but is NOT yet verified-by-run
 * here; when the field is not a string the plugin stays silent rather than
 * failing a write it was only meant to annotate.
 * This adapter does not delegate to a project's migration-provenance check.
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
    "tool.execute.after": async (
      input: { tool: string; args?: { filePath?: string } },
      output: { output?: unknown }
    ) => {
      if (input.tool !== "edit" && input.tool !== "write") return;
      const filePath = String(input.args?.filePath ?? "");
      if (!filePath || !MIGRATION_RE.test(filePath)) return;
      if (typeof output.output !== "string") return;
      output.output = [
        output.output,
        "",
        `block-migration-edits: you wrote a TypeORM migration directly (${filePath}). This is allowed, but check:`,
        "- Entity files are the source of truth for the database schema.",
        "- If this change can be expressed in an entity (columns, indexes, relations, constraints), edit the entity instead and run: bun run migration:generate --name=<Name>",
        "- If it can't (view options, grants, functions, policies, backfills, seed data), writing the migration directly is fine.",
        "- If you write it by hand, document why in the migration's class comment (a generated migration needs no such note).",
      ].join("\n");
    },
  };
};

#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# PreToolUse hook: block Write/Edit on TypeORM migration files.
# NestJS projects must use `bun run migration:generate` to create migrations
# from entity diffs. Hand-written migrations drift from entity metadata and
# break the schema/migration contract.
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Exit code 2 blocks the tool call and surfaces stderr to Claude.

JSON_INPUT=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "⚠ block-migration-edits: jq not available, allowing edit" >&2
  exit 0
fi

FILE_PATH=$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  */migrations/*.ts|*/migrations/*.js)
    cat >&2 <<EOF
❌ Blocked: Direct edits to TypeORM migration files are not allowed.

File: $FILE_PATH

Entity files (src/database/entities/*.ts) are the single source of
truth for the database schema in this project. Migrations are a derived
artifact — generate them from entity diffs:

  1. Edit the entity to express the desired schema.
  2. Run: bun run migration:generate --name=<DescriptiveName>
  3. Review the generated migration; commit entity + migration together.

If a schema change cannot be expressed via the entity model, the entity
model is wrong — fix the entity, do not hand-write the migration.

OUT-OF-BAND MIGRATIONS (seed data, backfills, data transformations,
one-off cleanup): these genuinely cannot come from entity diffs. They
are legitimate but they bypass the entity-as-source-of-truth contract.

If you believe this edit is an out-of-band migration:
  1. STOP and tell the user what change is needed and why it cannot
     be expressed via the entity model.
  2. Get explicit approval before proceeding.
  3. Document the rationale in the migration's class comment.

Do NOT silently hand-write a migration. See the nestjs-rules skill
for the full rationale.
EOF
    exit 2
    ;;
esac

exit 0

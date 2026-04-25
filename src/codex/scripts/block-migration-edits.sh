#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Edit|Write|apply_patch).
# Blocks edits to TypeORM migration files. Use `bun run migration:generate`
# to regenerate from entity diffs instead — hand-written migrations drift
# from entity metadata and break the schema/migration contract.
#
# Codex blocks the tool call when stdout has hookSpecificOutput.permissionDecision
# set to "deny", or when the script exits non-zero with a deny message.
set -euo pipefail

JSON_INPUT="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # Without jq we can't reliably parse — fail open (allow the edit)
  exit 0
fi

FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"

[ -n "${FILE_PATH}" ] || exit 0

# Match any path containing a migrations directory and a TypeORM-style filename
# (`<timestamp>-<name>.ts` is the convention)
case "${FILE_PATH}" in
  */migrations/*[0-9]*-*.ts)
    cat <<EOF >&2
⚠ block-migration-edits: refusing to modify ${FILE_PATH}.

TypeORM migrations must be regenerated from entity diffs:
  bun run migration:generate -- src/database/migrations/<descriptive-name>

Hand-written migrations drift from entity metadata and break the schema
contract. Modify the entity, run the generator, then commit the result.
EOF
    exit 2
    ;;
esac

exit 0

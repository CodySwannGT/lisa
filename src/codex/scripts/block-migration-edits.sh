#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Edit|Write|apply_patch).
# Blocks edits to TypeORM migration files. Use `bun run migration:generate`
# to regenerate from entity diffs instead — hand-written migrations drift
# from entity metadata and break the schema/migration contract.
#
# Codex blocks the tool call when the script exits non-zero with a deny message
# on stderr (exit 2). The shared extractor resolves every target path from the
# tool envelope — including multi-file apply_patch patches — so an edit can't
# slip a migration change past this guard.
set -uo pipefail

JSON_INPUT="$(cat)"

# Without jq we can't reliably parse — fail open (allow the edit). This matches
# the project rule against grep/sed/cut/awk-based JSON parsing.
command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# Walk every candidate path; deny on the first migration match.
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
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
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit 0

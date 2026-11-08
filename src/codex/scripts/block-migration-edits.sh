#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Edit|Write|apply_patch).
# WARNS on edits to TypeORM migration files and lets them through. The name is
# historical; renaming it would orphan installed copies and declarations.
#
# WHY A WARNING AND NOT A REFUSAL (operator decision, 2026-11-08). The risk a
# hand-written migration carries is drift from the entity definitions, and it
# only exists when the change COULD have been expressed in an entity. View
# options, grants, functions, policies, backfills and seed data cannot be, and
# refusing them blocked legitimate work. Same decision as the Claude copy.
#
# THE WARNING IS NOT KNOWN TO REACH THE MODEL ON THIS SURFACE. Codex honours
# `hookSpecificOutput.additionalContext` on SessionStart, UserPromptSubmit and
# PostToolUse, but it was measured NOT to on PreToolUse, and stderr on exit 0
# is not documented as model-visible either. So the warning goes to stderr,
# where it is at least in the hook transcript, and the gap is recorded in the
# nestjs-rules skill rather than papered over with an output shape Codex was
# never seen to read.
#
# The shared extractor resolves every target path from the tool envelope —
# including multi-file apply_patch patches — so each migration touched is
# named, and a declared gate judges each one.
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule: never parse JSON with grep/sed/cut/awk — use jq.
#
# Without jq the extractor cannot resolve any path. This used to fail closed,
# which was right while the in-scope answer was "refuse": a bail-out permitted
# exactly the edit the hook existed to stop. The answer is now "permit with a
# warning", so permitting loses only the warning, while refusing would block
# every write because a warning could not be delivered.
if ! command -v jq >/dev/null 2>&1; then
  echo "block-migration-edits: jq is not installed, so this write was not inspected and is permitted without the migration warning. Install jq (brew install jq / apt-get install jq) to restore it." >&2
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# A missing extractor means no path can be resolved: permit, for the same
# reason as a missing jq, and say so — a sourced file that is absent fails
# quietly under `set -uo pipefail` (there is no `-e`), so nothing else would.
if ! declare -F lisa_extract_edit_paths >/dev/null 2>&1; then
  echo "block-migration-edits: _extract-edit-paths.sh is missing beside this hook, so this write was not inspected. Re-run \`lisa apply\` to reinstall the hook helpers." >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Gate façade. A project that declares `migration-provenance` at `pre-tool`
# decides these edits itself: the declared task's non-zero exit refuses the
# write. Full contract in lisa-edit-gate.sh beside this file.
#
# Scoped to the migration paths this hook acts on, the same way the Claude copy
# is: outside them the hook does nothing, so there is nothing for a declaration
# to take over. Codex hooks run with the project as the working directory, so
# there is no `cd` here — the Claude copy needs one because a PreToolUse hook
# there establishes none.
# ---------------------------------------------------------------------------
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/lisa-edit-gate.sh"
if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks pre-tool migration-provenance)"; then
  LISA_GATE_STATUS=0
  while IFS= read -r LISA_GATE_FILE; do
    [ -n "${LISA_GATE_FILE}" ] || continue
    case "${LISA_GATE_FILE}" in
      */migrations/*[0-9]*-*.ts) ;;
      *) continue ;;
    esac
    lisa_edit_gate_run "${LISA_GATE_FILE}" "$LISA_GATE_COMMANDS" ||
      LISA_GATE_STATUS=2
  done <<LISA_GATE_PATHS
$(lisa_extract_edit_paths "$JSON_INPUT")
LISA_GATE_PATHS
  exit "$LISA_GATE_STATUS"
fi

# Walk every candidate path; warn for each migration touched, never refuse.
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  case "${FILE_PATH}" in
    */migrations/*[0-9]*-*.ts)
      cat <<EOF >&2
block-migration-edits: you are writing a TypeORM migration directly (${FILE_PATH}). This is allowed, but check first:

- Entity files are the source of truth for the database schema.
- If this change can be expressed in an entity (columns, indexes, relations, constraints), edit the entity instead and run: bun run migration:generate --name=<Name>
- If it can't (view options, grants, functions, policies, backfills, seed data), writing the migration directly is fine.
- Either way, document the rationale in the migration's class comment.
EOF
      ;;
  esac
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit 0

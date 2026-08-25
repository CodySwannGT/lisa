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
#
# WHAT A REFUSAL HOOK OWES THAT AN ON-EDIT HOOK DOES NOT. The PostToolUse
# scripts on this surface may bail out when they cannot run: the write has
# already happened and a skipped lint is a missed report. This one decides
# whether the write happens at all, so a bail-out is a PERMIT. Every exit below
# is out of scope, judged by the declared task, or judged by the built-in.
# "Could not judge" refuses.
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule: never parse JSON with grep/sed/cut/awk — use jq.
#
# FAIL CLOSED, reversed from the `exit 0` this shipped with. Without jq the
# extractor returns an EMPTY path list, the loop below runs zero times, and the
# script exits 0 — a guard that inspected nothing and reported success. Unscoped
# for the same reason: with no parse there is no path to scope the refusal to.
if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'MSG'
⚠ block-migration-edits: refusing this write — it cannot be inspected.

`jq` is not installed, so the tool payload cannot be parsed and this hook cannot
tell whether the write targets a TypeORM migration. It refuses rather than
permitting an edit it was unable to check.

Install jq (`brew install jq`, `apt-get install jq`), or declare the
`migration-provenance` gate at `pre-tool` in .lisa.config.json to have your own
check decide instead.
MSG
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# FAIL CLOSED on a missing extractor, for the same reason as jq and with the
# same consequence: an absent `lisa_extract_edit_paths` makes every loop below
# iterate over nothing, so the hook waves the write through having examined no
# path at all. A sourced file that is not there fails quietly under
# `set -uo pipefail` — there is no `-e` — so nothing else would notice.
if ! declare -F lisa_extract_edit_paths >/dev/null 2>&1; then
  cat >&2 <<'MSG'
⚠ block-migration-edits: refusing this write — it cannot be inspected.

`_extract-edit-paths.sh` is missing beside this hook, so the paths this tool
call touches cannot be resolved. It refuses rather than permitting an edit it
was unable to check. Re-run `lisa apply` to reinstall the hook helpers.
MSG
  exit 2
fi

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE the built-in refuses.
# Full contract, and why an undeclared project sees no change at all, in
# lisa-edit-gate.sh beside this file.
#
# Scoped to the migration paths this hook acts on, the same way the Claude copy
# is: outside them the hook does nothing, so there is nothing for a declaration
# to take over. Codex hooks run with the project as the working directory, so
# there is no `cd` here — the Claude copy needs one because a PreToolUse hook
# there establishes none.
#
# ONE PROPERTY, so there is no all-or-nothing question here: this hook proves
# `migration-provenance` and nothing else.
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

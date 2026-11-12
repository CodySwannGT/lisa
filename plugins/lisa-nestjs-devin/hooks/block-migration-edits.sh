#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# PreToolUse hook: WARN on Write/Edit to TypeORM migration files, then let the
# edit through. The name is historical; renaming it would orphan every
# installed copy and every `migration-provenance` declaration that points here.
#
# WHY A WARNING AND NOT A REFUSAL (operator decision, 2026-11-08). The risk a
# hand-written migration carries is drift from the entity definitions, and
# that risk only exists when the change COULD have been expressed in an
# entity. Plenty of migrations cannot be: view options, grants, functions,
# policies, backfills, seed data. Refusing all of them blocked legitimate work
# without making the entity route any more likely, so the hook now tells the
# agent where the change belongs and trusts it to choose.
# Reference: https://code.claude.com/docs/en/hooks#pretooluse-decision-control
#
# HOW THE WARNING REACHES THE MODEL. stderr on exit 0 is not shown to the
# model, so the warning is printed as PreToolUse JSON on stdout, in
# `hookSpecificOutput.additionalContext`. No `permissionDecision` is emitted:
# "allow" would also skip the user's permission prompt, which is a wider
# grant than "this edit is not refused" and not one this hook is entitled to
# make. Without a decision the call continues through the normal permission
# flow.

JSON_INPUT=$(cat)

# Project rule (host rules, .agents/rules/): never parse JSON in shell with
# grep/sed/cut/awk — always use jq.
#
# Without jq the payload cannot be parsed, so this hook cannot tell a migration
# edit from any other write, and cannot emit the JSON warning either. It used
# to fail closed here, which was right while the in-scope answer was "refuse":
# a bail-out would have permitted exactly the edit the hook existed to stop.
# The in-scope answer is now "permit with a warning", so permitting here loses
# only the warning, while refusing would block every write in the project
# because a WARNING could not be delivered. The stderr note names jq so the
# operator can see why the warning (and a declared gate) went unconsulted.
if ! command -v jq >/dev/null 2>&1; then
  echo "block-migration-edits: jq is not installed, so this write was not inspected and is permitted without the migration warning, and a declared migration-provenance gate was NOT consulted. Install jq (brew install jq / apt-get install jq) to restore both." >&2
  exit 0
fi

FILE_PATH=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Scope. Outside a migration path this hook does nothing at all, so there is
# nothing here for a declaration to take over — the same reason the sibling
# on-edit hook filters by file type and source directory BEFORE it consults.
case "$FILE_PATH" in
  */migrations/*.ts | */migrations/*.js) ;;
  *) exit 0 ;;
esac

# Where this script lives, resolved BEFORE any `cd`. `$0` is the path the
# harness invoked, and the façade helper ships beside it.
LISA_HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

# ---------------------------------------------------------------------------
# Gate façade. A project that declares `migration-provenance` at `pre-tool`
# decides these edits itself, and its decision is a real one: the declared
# task's non-zero exit refuses the write, a zero exit permits it. Full
# contract in lisa-edit-gate.sh beside this file.
#
# THE WORKING DIRECTORY IS PART OF THE WIRING HERE. The helper resolves
# .lisa.config.json and the gate registry RELATIVE to the current directory,
# and a PreToolUse hook establishes none, so without the `cd` it would read
# whatever directory the harness launched in and report "nothing declared" for
# a project that had declared. The built-in below reads only the path out of
# the payload, so the `cd` cannot change what it does.
# ---------------------------------------------------------------------------
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] &&
  [ -f "$LISA_HOOK_DIR/lisa-edit-gate.sh" ] &&
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null; then
  # shellcheck source=/dev/null
  . "$LISA_HOOK_DIR/lisa-edit-gate.sh"
  if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks pre-tool migration-provenance)"; then
    lisa_edit_gate_run "$FILE_PATH" "$LISA_GATE_COMMANDS"
    exit $?
  fi
fi

WARNING="block-migration-edits: you are writing a TypeORM migration directly (${FILE_PATH}). This is allowed, but check first:

- Entity files are the source of truth for the database schema.
- If this change can be expressed in an entity (columns, indexes, relations, constraints), edit the entity instead and run: bun run migration:generate --name=<Name>
- If it can't (view options, grants, functions, policies, backfills, seed data), writing the migration directly is fine.
- If you write it by hand, document why in the migration's class comment (a generated migration needs no such note)."

jq -n --arg ctx "$WARNING" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0

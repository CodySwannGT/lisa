#!/usr/bin/env bash
# This adapter covers run_command only. Other-tool/after-response adapters are
# unimplemented here; this does not assert agy lacks PostToolUse events.
set -uo pipefail
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '{"decision":"deny","reason":"tool-missing: Install the documented Node runtime before affected work."}'
  exit 0
fi
ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
INPUT=$(cat)
PAYLOAD=$(printf '%s' "$INPUT" | node -e 'const fs=require("node:fs");try{const p=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(JSON.stringify({hook_event_name:"PreToolUse",cwd:p.cwd||process.cwd(),tool_name:"Bash",tool_input:{command:p.toolCall?.args?.CommandLine}}));}catch{process.stdout.write("{}");}')
if RESULT=$(printf '%s' "$PAYLOAD" | bash "$ROOT/hooks/secrets-preflight.sh" --task-hook 2>&1); then
  case "$RESULT" in
    NATIVE_OWNER_REQUIRED:*) printf '%s\n' '{"decision":"deny","reason":"Native required access remains unproven; the ordinary action is withheld."}' ;;
    *) printf '%s\n' '{"decision":"allow"}' ;;
  esac
else
  printf '%s\n' '{"decision":"deny","reason":"Required task access is unproven. Run the shared readiness check and follow its safe recovery action before affected work."}'
fi

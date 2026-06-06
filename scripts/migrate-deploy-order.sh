#!/usr/bin/env bash
#
# migrate-deploy-order.sh — backfill `deploy.order` into workspace projects and,
# where provably safe, switch their back-sync wrapper from a hardcoded `chain`
# to the config-derived one.
#
# Context: `reusable-claude-sync-down-branches.yml` now derives its source->target
# chain from `.lisa.config.json` `deploy.order` + `deploy.branches`. An explicit
# `chain:` in a project's `claude-sync-down-branches.yml` wrapper still overrides
# the derived value, so this migration is OPT-IN and non-breaking.
#
# Per project (read from .lisa.workspaces.json):
#   1. If no wrapper file → SKIP.
#   2. If no deploy.branches in config → SKIP (cannot derive; keep explicit chain).
#   3. If single-env → propose removing the (redundant) wrapper chain ONLY when it
#      derives to the same value; otherwise REVIEW (drift — chain targets envs the
#      config doesn't declare).
#   4. If multi-env:
#        - Determine deploy.order (existing, or derive conventionally dev<staging<production).
#        - Compute the derived chain.
#        - SAFE  → derived chain == current wrapper chain: add deploy.order (if missing)
#                  and drop the wrapper `chain:` line. Behavior provably unchanged.
#        - REVIEW → derived chain != wrapper chain, or env rank unknown: report, change nothing.
#
# Default mode is DRY RUN. Pass --apply to write changes.
#
# Usage:
#   scripts/migrate-deploy-order.sh                 # dry run, all workspace projects
#   scripts/migrate-deploy-order.sh --apply         # write changes
#   scripts/migrate-deploy-order.sh --workspaces /path/to/.lisa.workspaces.json

set -euo pipefail

APPLY=false
WS="${HOME}/workspace/lisa/.lisa.workspaces.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --workspaces) WS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
[ -f "$WS" ] || { echo "Workspaces file not found: $WS" >&2; exit 1; }

# Conventional env rank (low -> high). Unknown env names => REVIEW.
env_rank() {
  case "$1" in
    dev|develop|development) echo 10 ;;
    qa|test) echo 20 ;;
    staging|stage|stg) echo 30 ;;
    preprod|preproduction|uat) echo 40 ;;
    prod|production|prd) echo 50 ;;
    *) echo "" ;;
  esac
}

# Derive deploy.order (JSON array, low->high) from deploy.branches keys by rank.
# Echoes the array on success, or "ERR_UNKNOWN:<env>" if a key has no known rank.
derive_order() {
  local cfg="$1" envs e r pairs
  envs=$(jq -r '(.deploy.branches // {}) | keys[]' "$cfg")
  pairs=""
  while IFS= read -r e; do
    [ -z "$e" ] && continue
    r=$(env_rank "$e")
    [ -z "$r" ] && { echo "ERR_UNKNOWN:$e"; return 0; }
    pairs+="$r $e"$'\n'
  done <<< "$envs"
  printf '%s' "$pairs" | sort -n | awk '{print $2}' | jq -R . | jq -sc .
}

# Compute derived chain JSON from a config that already has branches+order.
derive_chain() {
  jq -e -r '
    (.deploy.branches // {}) as $b | (.deploy.order // []) as $o
    | ($b|keys|sort) as $bk | ($o|sort) as $ok
    | if ($b|length)<=1 then "{}" elif ($o|length)==0 then "ERR_NO_ORDER"
      elif ($bk!=$ok) then "ERR_MISMATCH"
      else ($o|reverse) as $hl
        | [ range(0;($hl|length)-1) | {($b[$hl[.]]):$b[$hl[.+1]]} ] | add | tojson end
  ' "$1" 2>/dev/null || echo "ERR_PARSE"
}

# Extract the explicit chain JSON from a wrapper file, or empty string if none.
wrapper_chain() {
  grep -oE "chain:[[:space:]]*'[^']*'" "$1" 2>/dev/null | head -1 | sed -E "s/chain:[[:space:]]*'(.*)'/\1/" || true
}

SAFE=0; REVIEW=0; SKIP=0
echo "Mode: $([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)"
echo "Workspaces: $WS"
echo

while IFS= read -r proj; do
  dir="${proj/#\~/$HOME}"
  cfg="$dir/.lisa.config.json"
  wrap="$dir/.github/workflows/claude-sync-down-branches.yml"

  [ -f "$wrap" ] || { printf "SKIP    %-45s (no wrapper)\n" "$proj"; SKIP=$((SKIP+1)); continue; }
  [ -f "$cfg" ] || { printf "SKIP    %-45s (no .lisa.config.json — keep explicit chain)\n" "$proj"; SKIP=$((SKIP+1)); continue; }

  nb=$(jq -r '(.deploy.branches // {}) | length' "$cfg" 2>/dev/null || echo 0)
  [ "$nb" -ge 1 ] 2>/dev/null || { printf "SKIP    %-45s (no deploy.branches — keep explicit chain)\n" "$proj"; SKIP=$((SKIP+1)); continue; }

  cur_chain=$(wrapper_chain "$wrap")
  has_order=$(jq -r 'has("deploy") and (.deploy|has("order"))' "$cfg" 2>/dev/null || echo false)

  if [ "$has_order" = "true" ]; then
    order_json=$(jq -c '.deploy.order' "$cfg")
  else
    order_json=$(derive_order "$cfg")
    if [[ "$order_json" == ERR_UNKNOWN:* ]]; then
      printf "REVIEW  %-45s (unknown env name '%s' — set deploy.order manually)\n" "$proj" "${order_json#ERR_UNKNOWN:}"
      REVIEW=$((REVIEW+1)); continue
    fi
  fi

  # Compute derived chain against a config that has both branches and the order.
  tmp=$(mktemp)
  jq --argjson o "$order_json" '.deploy.order = $o' "$cfg" > "$tmp"
  derived=$(derive_chain "$tmp")

  case "$derived" in
    ERR_*) printf "REVIEW  %-45s (%s computing chain)\n" "$proj" "$derived"; REVIEW=$((REVIEW+1)); rm -f "$tmp"; continue ;;
  esac

  # Normalise both chains for comparison (sorted keys).
  norm() { echo "$1" | jq -cS . 2>/dev/null || echo "$1"; }
  d_norm=$(norm "$derived"); c_norm=$([ -n "$cur_chain" ] && norm "$cur_chain" || echo '""')

  if [ -z "$cur_chain" ]; then
    # No explicit wrapper chain already → just ensure deploy.order is present.
    if [ "$has_order" = "true" ]; then
      printf "SKIP    %-45s (already config-driven, deploy.order set)\n" "$proj"; SKIP=$((SKIP+1))
    else
      printf "SAFE    %-45s add deploy.order=%s (wrapper already chain-less)\n" "$proj" "$order_json"
      SAFE=$((SAFE+1))
      if [ "$APPLY" = true ]; then mv "$tmp" "$cfg"; tmp=""; fi
    fi
  elif [ "$d_norm" = "$c_norm" ]; then
    printf "SAFE    %-45s derived==wrapper (%s); add order + drop wrapper chain\n" "$proj" "$derived"
    SAFE=$((SAFE+1))
    if [ "$APPLY" = true ]; then
      [ "$has_order" = "true" ] || { mv "$tmp" "$cfg"; tmp=""; }
      # Drop the `chain:` line and the now-orphaned `with:` if it becomes empty.
      perl -0pi -e 's/^[[:space:]]*with:\n[[:space:]]*chain:[[:space:]]*'"'"'[^'"'"']*'"'"'\n//m; s/^[[:space:]]*chain:[[:space:]]*'"'"'[^'"'"']*'"'"'\n//m;' "$wrap"
    fi
  else
    printf "REVIEW  %-45s derived=%s != wrapper=%s\n" "$proj" "$derived" "$cur_chain"
    REVIEW=$((REVIEW+1))
  fi
  [ -n "${tmp:-}" ] && rm -f "$tmp" || true
done < <(jq -r 'keys[]' "$WS")

echo
echo "Summary: SAFE=$SAFE  REVIEW=$REVIEW  SKIP=$SKIP"
[ "$APPLY" = false ] && echo "(dry run — re-run with --apply to write)"

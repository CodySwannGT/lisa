#!/usr/bin/env bash
# Fails if any plugin's rules/eager/X.md is missing its rules/reference/X.md
# pair (or vice versa). The eager/reference split documents the contract that
# every eager head points at a reference body for the long-form detail; an
# unpaired file means either a head without a body (broken breadcrumb) or a
# body without a head (orphaned, never injected).
#
# Bootstrap files are exempt: rules/eager/00-bootstrap.md (and any other file
# matching rules/eager/00-*.md) is allowed to have no reference pair. The
# leading "00-" prefix marks files that are eager-only by design.
#
# Skip rule: a rule may opt out of pairing by listing its basename in
# rules/.pair-exempt — one filename per line, comments start with `#`. Use
# sparingly; the default expectation is that every eager file pairs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

failed=0

check_plugin() {
  local rules_dir="$1"
  local eager_dir="$rules_dir/eager"
  local reference_dir="$rules_dir/reference"

  # Skip plugins that haven't adopted the split yet (no eager/ subdir).
  [ -d "$eager_dir" ] || return 0

  # Build the opt-out list, if present.
  local exempt_file="$rules_dir/.pair-exempt"
  local exempt_pattern=""
  if [ -f "$exempt_file" ]; then
    exempt_pattern="$(grep -v '^[[:space:]]*#' "$exempt_file" | grep -v '^[[:space:]]*$' || true)"
  fi

  # Every eager/X.md (except 00-bootstrap-style files and explicit exemptions)
  # must have a reference/X.md pair.
  while IFS= read -r eager_file; do
    local base
    base="$(basename "$eager_file")"
    # Built-in exemption for bootstrap files.
    case "$base" in
      00-*) continue ;;
    esac
    # User-declared exemptions.
    if [ -n "$exempt_pattern" ] && echo "$exempt_pattern" | grep -qxF "$base"; then
      continue
    fi
    if [ ! -f "$reference_dir/$base" ]; then
      echo "✗ Missing reference body for eager rule: $eager_file" >&2
      echo "  Expected: $reference_dir/$base" >&2
      failed=1
    fi
  done < <(find "$eager_dir" -maxdepth 1 -type f -name '*.md' | sort)

  # Every reference/X.md must have an eager/X.md pair (catch orphans on the
  # other side: a reference body with no breadcrumb pointing to it is dead).
  if [ -d "$reference_dir" ]; then
    while IFS= read -r ref_file; do
      local base
      base="$(basename "$ref_file")"
      if [ -n "$exempt_pattern" ] && echo "$exempt_pattern" | grep -qxF "$base"; then
        continue
      fi
      if [ ! -f "$eager_dir/$base" ]; then
        echo "✗ Orphaned reference body (no eager head): $ref_file" >&2
        echo "  Expected: $eager_dir/$base" >&2
        failed=1
      fi
    done < <(find "$reference_dir" -maxdepth 1 -type f -name '*.md' | sort)
  fi
}

# Check every plugins/*/rules and plugins/src/*/rules directory.
while IFS= read -r rules_dir; do
  check_plugin "$rules_dir"
done < <(find "$ROOT_DIR/plugins" -type d -name rules | sort)

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "  Every rules/eager/X.md must have a paired rules/reference/X.md" >&2
  echo "  (and vice versa) so the eager head's breadcrumb to the full" >&2
  echo "  reference body resolves. To exempt a file, either name it" >&2
  echo "  00-*.md (bootstrap convention) or list its basename in" >&2
  echo "  <plugin>/rules/.pair-exempt (one per line)." >&2
  exit 1
fi

echo "✓ Every eager rule has its paired reference body (and vice versa)."

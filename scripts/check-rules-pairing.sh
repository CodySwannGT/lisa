#!/usr/bin/env bash
# Fails when a rule body is unreachable, in either direction.
#
# Forward (unchanged): every rules/eager/X.md must have its rules/reference/X.md,
# because the head's breadcrumb points at that body and a broken pointer is a
# defect.
#
# Reverse (#3992): every rules/reference/X.md must be pointed at by SOMETHING
# eager — its own head, or a line in rules/eager/00-rule-index.md. This used to
# demand a dedicated head, which made writing any long-form contract compel a
# permanent per-session payload; the eager tier grew 7.6x on that incentive.
# The property being protected is reachability, and an index line provides it.
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

  # The eager rule index, when this plugin has one. It is itself a 00-* file, so
  # it is exempt from needing a body of its own.
  local index_file=""
  if [ -f "$eager_dir/00-rule-index.md" ]; then
    index_file="$eager_dir/00-rule-index.md"
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

  # Every reference/X.md must be POINTED AT by something eager — either its own
  # eager/X.md head, or a line in the eager rule index. The invariant is
  # reachability, not pairing: a body nothing names is dead, and that is what
  # this arm has always been protecting.
  #
  # The index satisfies it because #3992 changed the mechanism. Requiring a
  # dedicated head made authoring any long-form contract compel an always-on
  # per-session payload, and the tier grew from 26,540 to 201,083 bytes on that
  # incentive alone — `credential-substrate-precedence.md` was added purely to
  # turn this check green. One index line carries the same pointer at ~1% of the
  # context cost, so the cheap way to satisfy the gate is now also the right one.
  if [ -d "$reference_dir" ]; then
    while IFS= read -r ref_file; do
      local base
      base="$(basename "$ref_file")"
      if [ -n "$exempt_pattern" ] && echo "$exempt_pattern" | grep -qxF "$base"; then
        continue
      fi
      if [ -f "$eager_dir/$base" ]; then
        continue
      fi
      if [ -n "$index_file" ] && grep -qF "reference/$base" "$index_file"; then
        continue
      fi
      echo "✗ Unreachable reference body: $ref_file" >&2
      echo "  Nothing eager points at it. Give it either:" >&2
      echo "    - a paired head at $eager_dir/$base, or" >&2
      echo "    - a line naming reference/$base in $eager_dir/00-rule-index.md" >&2
      echo "  Prefer the index — a head is loaded into every session and every" >&2
      echo "  subagent, whether or not anything asks for it." >&2
      failed=1
    done < <(find "$reference_dir" -maxdepth 1 -type f -name '*.md' | sort)
  fi
}

# Check every plugins/*/rules and plugins/src/*/rules directory.
while IFS= read -r rules_dir; do
  check_plugin "$rules_dir"
done < <(find "$ROOT_DIR/plugins" -type d -name rules | sort)

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "  Every rules/eager/X.md must have a paired rules/reference/X.md so" >&2
  echo "  its breadcrumb resolves, and every rules/reference/X.md must be" >&2
  echo "  reachable from either its own head or the eager rule index." >&2
  echo "  To exempt a file, either name it" >&2
  echo "  00-*.md (bootstrap convention) or list its basename in" >&2
  echo "  <plugin>/rules/.pair-exempt (one per line)." >&2
  exit 1
fi

echo "✓ Every eager rule has its paired reference body (and vice versa)."

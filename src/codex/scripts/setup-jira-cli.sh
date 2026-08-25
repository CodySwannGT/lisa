#!/usr/bin/env bash
# Lisa-managed Codex hook script (SessionStart).
# Writes jira-cli configuration from environment variables when available.
# Gated on `tracker: "jira"` in .lisa.config*.json — a project on another tracker
# gets nothing. Fails closed when the tracker cannot be read: absent or
# malformed config, or a missing jq, is reported on stderr with a non-zero exit
# rather than exiting 0 as though the project had declared nothing.
set -euo pipefail

# Drain the hook envelope before any config-dependent early return.
cat >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# WHERE THE CONFIG IS READ FROM.
#
# The write target has always been absolute (`${PROJECT_DIR}/.lisa/jira-cli`)
# while the reads were relative to the process working directory. A session
# launched anywhere but the project root therefore read a different directory
# than it wrote, and `jq` on a missing file yields empty, which every consumer
# below treats as "not configured" — so the hook reported success having
# configured nothing. Both ends now resolve against PROJECT_DIR, matching the
# OpenCode implementation, which has always resolved against the worktree root
# it is handed.
#
# CLAUDE_PROJECT_DIR first (the harness's own declaration of the root, and
# inert on harnesses that never set it), then the git toplevel, then pwd. This
# block is deliberately identical in both shell implementations: two copies of
# one resolution rule, allowed to drift, is what produced the Codex half of
# this defect in the first place.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# WHO READS WHAT THIS WRITES — and why no per-harness env export is needed.
#
# `${PROJECT_DIR}/.lisa/jira-cli/.config.yml` had NO reader at all until
# CodySwannGT/lisa#2767: the hook wrote a file, every consumer looked at
# `${HOME}/.config/.jira/.config.yml` instead, and the hook was therefore an
# inert control that reported success while feeding nothing. It now has three
# consumers, all Lisa-owned:
#
#   * lisa-jira-evidence/scripts/post-evidence.sh — greps `server:`/`login:`
#     out of this YAML, then passes `--config <path>` to `jira issue move`.
#   * lisa-jira-read-ticket/scripts/download-attachment.sh — greps the same two
#     keys, but ONLY when JIRA_SERVER/JIRA_LOGIN are unset. Env still wins; a
#     headless runner with those exported never opens this file.
#   * SKILL prose (lisa-jira-add-journey, base-rules) — types
#     `jira --config .lisa/jira-cli/.config.yml issue view <KEY>`.
#
# #2767 framed the blocking question as "can a SessionStart hook export an
# environment variable into the agent's later tool invocations, and does that
# differ per harness?" That question is MOOT for every consumer above, because
# none of them needs an export:
#
#   - Two of the three parse this YAML themselves, in Lisa-owned shell.
#   - The one real jira-cli invocation passes `--config`, an ARGUMENT. It
#     crosses no process boundary, so it behaves identically on Claude Code,
#     Codex, Cursor, Copilot, OpenCode and Antigravity. There is no per-harness
#     capability to record because no harness capability is used.
#
# The only surface where an export could still have mattered is a freehand
# `jira ...` an agent types from SKILL prose. That is compensated at the same
# rung rather than dropped: the prose types `--config` too. `JIRA_CONFIG_FILE`
# is deliberately exported NOWHERE in Lisa — an unexported variable is another
# inert control, and the flag makes the export unnecessary.
#
# jira-cli's own resolution order, MEASURED against v1.7.0 (darwin/arm64)
# rather than taken from its README:
#
#   1. `--config`/`-c <path>`               (highest; accepted either before or
#                                            after the subcommand)
#   2. `JIRA_CONFIG_FILE=<path>`
#   3. `${HOME}/.config/.jira/.config.yml`  (default)
#
# A path named by (1) or (2) that does not exist FAILS CLOSED: jira-cli prints
# "Missing configuration file." and exits 1 — it does NOT fall back to (3).
# That is what makes passing `--config` safe rather than a silent no-op.
#
# This hook never writes to `${HOME}/.config/.jira`. That is a developer's
# personal jira-cli state; consumers read it as an ANNOUNCED fallback only.
# ---------------------------------------------------------------------------
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "${PROJECT_DIR}" || ! -d "${PROJECT_DIR}" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
LISA_CONFIG_LOCAL="${PROJECT_DIR}/.lisa.config.local.json"
LISA_CONFIG_MAIN="${PROJECT_DIR}/.lisa.config.json"

# A project with no Lisa config at all is genuinely unconfigured: nothing to
# read, nothing to write. That case exits silently, exactly as it always has —
# it is the control that keeps this change from being a behavior change for
# every non-Lisa directory a harness might launch in.
if [[ ! -f "${LISA_CONFIG_LOCAL}" && ! -f "${LISA_CONFIG_MAIN}" ]]; then
  exit 0
fi

# FAIL CLOSED FROM HERE. A config file exists, so anything that stops us
# reading it is a failure, not an answer. Reporting "no tracker configured"
# because jq is absent or the JSON is malformed is the silent-inert-control
# failure this hook family keeps producing; it is now visible on stderr and
# non-zero rather than an exit 0 that claims the project configured nothing.
if ! command -v jq &>/dev/null; then
  printf '%s\n' \
    "setup-jira-cli: cannot read ${LISA_CONFIG_MAIN}: jq is not installed." \
    "setup-jira-cli: refusing to report this project as unconfigured. Install jq." >&2
  exit 1
fi

for lisa_config_candidate in "${LISA_CONFIG_LOCAL}" "${LISA_CONFIG_MAIN}"; do
  if [[ -f "${lisa_config_candidate}" ]] &&
    ! jq empty "${lisa_config_candidate}" >/dev/null 2>&1; then
    printf '%s\n' \
      "setup-jira-cli: ${lisa_config_candidate} is not valid JSON." \
      "setup-jira-cli: refusing to report this project as unconfigured." >&2
    exit 1
  fi
done

# Reads the first non-empty value for `query` across the local override and the
# committed config, both resolved from PROJECT_DIR. A jq failure returns
# non-zero so the caller can fail closed; it never degrades to an empty string.
read_lisa_config() {
  local query="$1"
  local value=""
  local candidate

  for candidate in "${LISA_CONFIG_LOCAL}" "${LISA_CONFIG_MAIN}"; do
    [[ -f "${candidate}" ]] || continue
    if ! value="$(jq -r "${query} // empty" "${candidate}")"; then
      printf '%s\n' \
        "setup-jira-cli: failed to read ${query} from ${candidate}." >&2
      return 1
    fi
    [[ -n "${value}" ]] && break
  done

  printf '%s' "${value}"
}

# Tracker gate: do nothing unless this project actually runs on JIRA. An
# unreadable tracker is a hard stop, not a "no".
if ! LISA_TRACKER="$(read_lisa_config '.tracker')"; then
  exit 1
fi
if [[ "${LISA_TRACKER}" != "jira" ]]; then
  exit 0
fi

if [[ -z "${JIRA_SERVER:-}" ]]; then
  if ! ATLASSIAN_SITE="$(read_lisa_config '.atlassian.site')"; then
    exit 1
  fi
  if [[ -n "${ATLASSIAN_SITE}" ]]; then
    if [[ "${ATLASSIAN_SITE}" == http://* || "${ATLASSIAN_SITE}" == https://* ]]; then
      JIRA_SERVER="${ATLASSIAN_SITE}"
    else
      JIRA_SERVER="https://${ATLASSIAN_SITE}"
    fi
  fi
fi

if [[ -z "${JIRA_PROJECT:-}" ]]; then
  if ! JIRA_PROJECT="$(read_lisa_config '.jira.project')"; then
    exit 1
  fi
fi

# Skip config write if required vars are missing. These are identity/secret
# values supplied by the environment, never by .lisa.config*.json, so their
# absence is an unconfigured environment rather than an unreadable one.
if [[ -z "${JIRA_SERVER:-}" || -z "${JIRA_LOGIN:-}" ]]; then
  exit 0
fi

config_dir="${PROJECT_DIR}/.lisa/jira-cli"
config_file="${config_dir}/.config.yml"
mkdir -p "$config_dir"

cat > "$config_file" << EOF
installation: ${JIRA_INSTALLATION:-cloud}
server: ${JIRA_SERVER}
login: ${JIRA_LOGIN}
project: ${JIRA_PROJECT:-}
board: "${JIRA_BOARD:-}"
auth_type: basic
epic:
  name: Epic Name
  link: Epic Link
EOF

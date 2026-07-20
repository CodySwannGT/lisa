#!/usr/bin/env bash
# Enforces the /lisa:implement completion gate: the lead session may not stop
# while an implement flow is active until an independent, machine-readable
# verification verdict proves every acceptance criterion passed.
#
# This carries over the most valuable property of the native `/goal` primitive
# (Claude Code v2.1.139, Codex 0.128.0): a NON-BYPASSABLE completion gate where
# the agent doing the work cannot self-certify "done". Unlike `/goal`'s small
# evaluator model — which only reads the transcript and cannot run tools — this
# gate is deterministic and judges a structured artifact the
# verification-specialist writes from REAL tool output, so it is both stronger
# and not foolable by a prose claim of success.
#
# Intentionally Claude-specific (like enforce-team-first.sh). Other harnesses
# may not fire a Stop hook; they fall back to the prose completion gate in
# skills/lisa-implement/SKILL.md.
#
# Triggered on four hook events:
#   - UserPromptSubmit : arm enforcement when the prompt starts with
#                        /lisa:implement (or /implement)
#   - PreToolUse       : arm enforcement when the Skill tool loads lisa-implement
#                        (covers nested/programmatic invocation, e.g. intake)
#   - SubagentStart    : mark teammate sessions exempt — teammates inherit the
#                        lead's flow and must not be gated on their own stop
#   - Stop             : block the lead stop unless a FRESH terminal verdict
#                        (status pass|blocked, all criteria pass) exists, bounded
#                        by a per-session block counter so a genuinely-stuck flow
#                        ESCALATES instead of looping forever.
#
# The verdict artifact lives at "$CLAUDE_PROJECT_DIR/.lisa/verification-status.json".
#
# SCHEMA v2 (current) binds every claim to a boundary and to the evidence kinds
# that reach it, per the claim-evidence-mapping contract:
#   {
#     "schema_version": 2,
#     "plan": "<plan-name>",
#     "artifact": { "repository": "owner/repo", "base_sha": "...", "head_sha": "...",
#                   "build_id": "...", "environment": "...", "observed_at": "<ISO8601 UTC>" },
#     "claims": [
#       { "claim_id": "AC-1", "statement": "...", "boundary": "browser",
#         "required_for_gate": true, "required_evidence_kinds": ["screenshot","recording"],
#         "status": "established" | "not-established", "evidence_refs": ["EV-1"],
#         "not_established": ["<what this claim does NOT cover>"] }
#     ],
#     "evidence": [
#       { "evidence_id": "EV-1", "kind": "screenshot", "locator": "evidence/1836/x.png",
#         "sha256": "...", "captured_at": "<ISO8601 UTC>", "artifact_head_sha": "..." }
#     ],
#     "not_established_reviewed": true,
#     "criteria": [ ... legacy, display-only ... ],
#     "status": "pass" | "fail" | "blocked" | "in_progress",
#     "updated_at": "<ISO8601 UTC>"
#   }
#
# SCHEMA v1 (legacy, still accepted during the compatibility window) omits
# "schema_version" or sets it to 1, and carries only:
#   {
#     "plan": "<plan-name>",
#     "status": "pass" | "fail" | "blocked" | "in_progress",
#     "criteria": [
#       { "task": "...", "criterion": "...", "status": "pass" | "fail" | "blocked", "evidence": "..." }
#     ],
#     "updated_at": "<ISO8601 UTC>"
#   }
#
# In BOTH schemas, status "pass" (all criteria pass) or "blocked" (flow recorded
# a blocker and is stopping deliberately) are terminal and release the gate.
# "fail"/"in_progress" or a missing/stale file keep it closed.
#
# Compatibility window: the gate branches on "schema_version". Absent or 1 takes
# the v1 path unchanged — byte-for-byte the pre-v2 decision. 2 takes the v1 path
# PLUS the claim->evidence checks below. Legacy "criteria" is display-only under
# v2 and can never establish a v2 claim.
#
# v2 claim checks (only ever applied to an overall "pass"; a deliberate
# "blocked" stop is terminal on the v1 conditions alone):
#   - every claim with "required_for_gate": true is "status": "established"
#   - each such claim's "evidence_refs" resolve to "evidence[]" entries, at
#     least one of whose "kind" is in the claim's "required_evidence_kinds"
#   - "not_established_reviewed": true is present (the list may be empty, but
#     the flag may never be omitted)
#   - "artifact.head_sha" exists and no evidence entry declares a different
#     "artifact_head_sha" (reconciliation with the MERGED head is BCE-4)
#   - every evidence entry that records BOTH a "sha256" and a "locator"
#     resolving to a file on disk still hashes to that digest
#     ("evidence_digest_mismatch"). A locator that is not on disk at stop time
#     is NOT judged here: the Stop hook sees only the working tree, and evidence
#     may legitimately live outside it. The absent-artifact arm of that check
#     belongs to the read-side review surfaces, which see the committed
#     evidence directory.
#   - the claim/evidence structure is EVALUABLE at all: a v2 verdict whose
#     "claims"/"evidence"/"artifact" are not the shapes the schema defines
#     (claims as a string, evidence as a scalar) is reported as
#     could-not-evaluate. Could-not-evaluate is NOT the same as no-violations:
#     a verdict the gate cannot read may never be treated as a clean one, or a
#     structurally-wrong verdict would sail past the gate the moment
#     enforcement is ratcheted on.
#
# ADVISORY-FIRST: those v2 checks report to stderr but do NOT block unless
# "verification.gate.enforceBoundaries" is true in .lisa.config.json (default
# false at ship, promoted via the threshold ratchet). While it is false, a v2
# verdict releases on exactly the v1-equivalent conditions.
#
# Per-session state lives under "$STATE_DIR" as flag files keyed by session_id.
# Stale state (>24h) is cleaned on each invocation.
#
# Fail-open: a missing field degrades to the LESS strict outcome rather than
# inventing a new hard failure, and the MAX_BLOCKS escalation below guarantees
# the gate always releases eventually. A broken gate must never brick a session.
#
# That fail-open posture bounds the BLAST RADIUS of a gate failure; it is not a
# licence to read an unreadable verdict as a clean one. So a v2 verdict whose
# claim structure cannot be evaluated is reported like any other violation —
# advisory while the ratchet is off, blocking (still MAX_BLOCKS-bounded, so it
# can never hard-wedge a session) once it is on.

set -uo pipefail

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

STATE_DIR="${TMPDIR:-/tmp}/lisa-verification-gate"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

ARM_FLAG="${STATE_DIR}/${SESSION_ID}.armed"
SUBAGENT_FLAG="${STATE_DIR}/${SESSION_ID}.subagent"
COUNT_FILE="${STATE_DIR}/${SESSION_ID}.blocks"

# Best-effort cleanup of stale state files. Errors are ignored.
find "$STATE_DIR" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true

# How many consecutive blocks before the gate releases (with escalation) to
# avoid an infinite stop loop. Mirrors /goal's "or stop after N turns" clause.
MAX_BLOCKS=8

arm_once() {
  # Arm without bumping mtime if already armed — the arm time is the freshness
  # baseline for the verdict, so re-arming on a later prompt must not make an
  # already-written verdict look stale.
  [ -f "$ARM_FLAG" ] || touch "$ARM_FLAG" 2>/dev/null || true
}

case "$HOOK_EVENT" in
  SubagentStart)
    touch "$SUBAGENT_FLAG" 2>/dev/null || true
    exit 0
    ;;

  UserPromptSubmit)
    PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
    if [ -n "$PROMPT" ]; then
      LEADING=$(printf '%s' "$PROMPT" | sed -n '1p' | sed -E 's/^[[:space:]]*//')
      case "$LEADING" in
        /lisa:implement*|/implement*)
          arm_once
          ;;
      esac
    fi
    exit 0
    ;;

  PreToolUse)
    TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
    if [ "$TOOL_NAME" = "Skill" ]; then
      SKILL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null || true)
      case "$SKILL_NAME" in
        lisa-implement|implement)
          arm_once
          ;;
      esac
    fi
    exit 0
    ;;

  Stop)
    : # fall through to enforcement
    ;;

  *)
    exit 0
    ;;
esac

# --- Stop enforcement path ---

# Teammates inherit the lead's flow; never gate a subagent stop.
if [ -f "$SUBAGENT_FLAG" ]; then
  exit 0
fi

# No implement flow armed — nothing to gate.
if [ ! -f "$ARM_FLAG" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
VERDICT_FILE="${PROJECT_DIR}/.lisa/verification-status.json"

# Set by the v2 path when a claim/evidence violation is what closed the gate,
# so the block message can state the real reason instead of the v1 fallback.
V2_BLOCK_REASON=""

# A terminal verdict (pass or blocked) with no failing criterion, written AFTER
# the flow was armed, releases the gate. This is the v1 decision, unchanged, and
# it remains the floor for v2 as well.
verdict_is_terminal_v1() {
  [ -f "$VERDICT_FILE" ] || return 1

  local status fails
  status=$(jq -r '.status // empty' "$VERDICT_FILE" 2>/dev/null || true)
  case "$status" in
    pass|blocked) : ;;
    *) return 1 ;;
  esac

  fails=$(jq -r '[.criteria[]? | select((.status // "") == "fail")] | length' "$VERDICT_FILE" 2>/dev/null || echo 1)
  [ "$fails" = "0" ] || return 1

  # Reject a stale verdict left over from a previous plan in this session.
  if [ "$VERDICT_FILE" -ot "$ARM_FLAG" ]; then
    return 1
  fi

  return 0
}

# True when the project has ratcheted the v2 claim checks from advisory to
# blocking. Default false: a missing/unreadable config is advisory-only.
boundary_enforcement_enabled() {
  local config_file value
  config_file="${PROJECT_DIR}/.lisa.config.json"
  [ -f "$config_file" ] || return 1
  value=$(jq -r '.verification.gate.enforceBoundaries // false' "$config_file" 2>/dev/null || printf 'false')
  [ "$value" = "true" ]
}

# Prints the sha256 of a file using whichever tool this machine has. Prints
# nothing when neither exists — an unrecomputable digest is not a violation.
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  fi
}

# Emits one line per evidence entry whose bytes no longer hash to the digest the
# verdict recorded. Only entries recording BOTH a sha256 and a locator that
# resolves to a file on disk are judged; see the header for why an absent
# locator is out of this hook's scope.
v2_digest_violations() {
  jq -r '
    (.evidence // [])[]
    | select(((.sha256 // "") | length) > 0)
    | select(((.locator // "") | length) > 0)
    | "\(.evidence_id // "?")\t\(.locator)\t\(.sha256)"
  ' "$VERDICT_FILE" 2>/dev/null | while IFS=$'\t' read -r eid locator recorded; do
    evidence_path="${PROJECT_DIR}/${locator}"
    [ -f "$evidence_path" ] || continue
    actual=$(sha256_of "$evidence_path")
    [ -n "$actual" ] || continue
    [ "$actual" = "$recorded" ] && continue
    echo "evidence ${eid} (${locator}) no longer matches its recorded digest: recorded ${recorded}, bytes now hash to ${actual}"
  done
}

# Emits one line per v2 claim->evidence contract violation. Empty output means
# the verdict satisfies the contract. A jq evaluation failure is NOT empty
# output — see v2_evaluate_contract, which turns it into its own violation.
v2_contract_violations() {
  jq -r '
    . as $v
    | ($v.evidence // []) as $ev
    | (($v.artifact // {}).head_sha // "") as $head
    | [
        (if ($v.not_established_reviewed == true) then empty
         else "not_established_reviewed is absent or not true - the flag may never be omitted" end),
        (if ($head | length) > 0 then empty
         else "artifact.head_sha is missing - required for a v2 pass" end),
        ( $ev[]
          | select(($head | length) > 0)
          | select(((.artifact_head_sha // "") | length) > 0)
          | select(.artifact_head_sha != $head)
          | "evidence \(.evidence_id // "?") was captured at \(.artifact_head_sha) but artifact.head_sha is \($head)" ),
        ( ($v.claims // [])[]
          | select((.required_for_gate // false) == true)
          | . as $c
          | ($c.claim_id // "?") as $cid
          | ($c.boundary // "?") as $bnd
          | ($c.required_evidence_kinds // []) as $req
          | ($req | join(", ")) as $reqs
          | ([ ($c.evidence_refs // [])[] as $r | $ev[] | select((.evidence_id // "") == $r) ]) as $res
          | (
              (if (($c.status // "") == "established") then empty
               else "claim \($cid) [boundary \($bnd)] is not established (status: \($c.status // "missing"); required kinds: \($reqs))" end),
              (if ($res | length) == 0
               then "claim \($cid) [boundary \($bnd)] cites no resolvable evidence (required kinds: \($reqs))"
               elif ([ $res[].kind // "" ] | map(select(. as $k | $req | index($k))) | length) == 0
               then "claim \($cid) [boundary \($bnd)] cited evidence kinds [\([$res[].kind // "?"] | join(", "))] do not reach the boundary (required kinds: \($reqs))"
               else empty end)
            )
        )
      ]
    | .[]
  ' "$VERDICT_FILE" 2>/dev/null
}

# Set by v2_evaluate_contract: every violation line, or empty when the verdict
# satisfies the contract. A global rather than a return value because a command
# substitution would swallow the could-not-evaluate signal along with it.
V2_VIOLATIONS=""

# Evaluates the full v2 contract into V2_VIOLATIONS.
#
# The load-bearing distinction: jq returns NOTHING on an evaluation error, which
# is byte-identical to "this verdict is clean". A parseable v2 verdict whose
# claims/evidence are the wrong SHAPE (claims as a string, evidence as a scalar)
# therefore used to read as violation-free — harmless while advisory, a genuine
# bypass of the gate the moment enforcement is ratcheted on. So a non-zero jq
# exit becomes its own, named violation.
v2_evaluate_contract() {
  local structural digests
  structural=$(v2_contract_violations)
  if [ "$?" -ne 0 ]; then
    V2_VIOLATIONS="the v2 claim/evidence structure could not be evaluated - \"claims\" and \"evidence\" must be arrays of objects and \"artifact\" an object. A verdict the gate cannot read is not a verdict with no violations"
    return 0
  fi

  digests=$(v2_digest_violations)
  V2_VIOLATIONS=$(printf '%s\n%s' "$structural" "$digests" | sed '/^[[:space:]]*$/d')
}

# v2 = the v1 decision PLUS the claim->evidence contract, the latter advisory
# until verification.gate.enforceBoundaries is ratcheted on.
verdict_is_terminal_v2() {
  verdict_is_terminal_v1 || return 1

  # Only a "pass" asserts that claims are established. A deliberate "blocked"
  # stop records an outcome and is terminal on the v1 conditions alone.
  local status violations
  status=$(jq -r '.status // empty' "$VERDICT_FILE" 2>/dev/null || true)
  [ "$status" = "pass" ] || return 0

  v2_evaluate_contract
  violations="$V2_VIOLATIONS"
  [ -n "$violations" ] || return 0

  if boundary_enforcement_enabled; then
    # Hand the diagnosis to the block message below so the operator reads one
    # coherent reason instead of this plus a generic v1-shaped fallback.
    V2_BLOCK_REASON=$(printf '%s\n' "$violations" | sed 's/^/  - /')
    return 1
  fi

  {
    echo "Verification gate (advisory): the v2 claim/evidence contract is not"
    echo "satisfied. Releasing anyway because verification.gate.enforceBoundaries"
    echo "is false. These become blocking when the flag is ratcheted on:"
    printf '%s\n' "$violations" | sed 's/^/  - /'
  } >&2
  return 0
}

# Compatibility window: branch on schema_version. Absent or 1 -> the v1 decision
# unchanged; 2 -> v1 plus the claim->evidence contract. An unrecognized or
# unparseable value degrades to v1 rather than to a new failure mode.
verdict_is_terminal() {
  [ -f "$VERDICT_FILE" ] || return 1

  local schema_version
  schema_version=$(jq -r '.schema_version // empty' "$VERDICT_FILE" 2>/dev/null || true)
  case "$schema_version" in
    2) verdict_is_terminal_v2 ;;
    *) verdict_is_terminal_v1 ;;
  esac
}

if verdict_is_terminal; then
  # Gate satisfied — disarm so a follow-up stop in the same session is not
  # re-gated against the now-consumed verdict, and allow the stop.
  rm -f "$ARM_FLAG" "$COUNT_FILE" 2>/dev/null || true
  exit 0
fi

# Verdict missing, failing, or stale — block, but bound the loop.
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$COUNT" in
  ''|*[!0-9]*) COUNT=0 ;;
esac
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNT_FILE" 2>/dev/null || true

if [ "$COUNT" -gt "$MAX_BLOCKS" ]; then
  rm -f "$ARM_FLAG" "$COUNT_FILE" 2>/dev/null || true
  cat >&2 <<EOF
Verification gate: still no passing verdict after ${MAX_BLOCKS} attempts.
Releasing the stop gate to avoid an infinite loop. The /lisa:implement Verify
flow did NOT prove completion. Do NOT claim this work is verified — escalate to
a human, or file a build-ready fix ticket and move the work item to blocked.
EOF
  exit 0
fi

REASON_DETAIL=""
if [ -f "$VERDICT_FILE" ]; then
  REASON_DETAIL=$(jq -r '[.criteria[]? | select((.status // "") != "pass") | "  - \(.task // "?"): \(.criterion // "?") [\(.status // "missing")]"] | .[]' "$VERDICT_FILE" 2>/dev/null || true)
fi

{
  echo "Blocked: /lisa:implement may not stop until verification is proven."
  echo
  if [ ! -f "$VERDICT_FILE" ]; then
    echo "No verification verdict found at .lisa/verification-status.json."
    echo "The Verify flow must run the verification-specialist (run the actual"
    echo "system, observe results) and write a machine-readable verdict — schema"
    echo "in skills/lisa-implement/SKILL.md — with status \"pass\" and every"
    echo "acceptance criterion proven."
    echo
    echo "If you are stopping deliberately because of a blocker (readiness gate"
    echo "failed, base branch missing, unresolved dependency), write the verdict"
    echo "with status \"blocked\" and the reason instead. That records the"
    echo "outcome and releases this gate."
  elif [ -n "$V2_BLOCK_REASON" ]; then
    echo "The verdict claims to pass, but its evidence does not establish every"
    echo "claim the gate requires:"
    printf '%s\n' "$V2_BLOCK_REASON"
    echo
    echo "A claim counts only when the evidence cited for it is of a kind that"
    echo "reaches that claim's boundary — a unit test log does not prove a"
    echo "button works in a browser. Capture the reaching evidence and"
    echo "re-verify, or — if genuinely blocked — set status \"blocked\" with the"
    echo "reason."
  else
    echo "The verification verdict is not terminal-and-passing. Outstanding:"
    if [ -n "$REASON_DETAIL" ]; then
      printf '%s\n' "$REASON_DETAIL"
    else
      echo "  (status is not pass/blocked, or the verdict is older than this run)"
    fi
    echo
    echo "Fix the failing criteria and re-verify, or — if genuinely blocked —"
    echo "set status \"blocked\" with the reason."
  fi
  echo
  echo "(Attempt ${COUNT}/${MAX_BLOCKS} — the gate releases after ${MAX_BLOCKS} to avoid a loop.)"
} >&2
exit 2

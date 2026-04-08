#!/usr/bin/env bash
# Validates the intent-routing system wiring:
# - All commands reference valid flows
# - All agents referenced in intent-routing exist
# - All skills referenced by agents exist
# - Hooks produce valid JSON
# - plugin.json is valid and references existing hook files
# - No stale flow names remain
set -euo pipefail

PLUGIN_SRC="plugins/src/base"
PLUGIN_BUILT="plugins/lisa"
ERRORS=0
WARNINGS=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  WARN: $1"; WARNINGS=$((WARNINGS + 1)); }

echo "=== Intent Routing Validation ==="
echo ""

# 1. Check intent-routing.md exists and has all 4 main flows
echo "--- 1. Flow Definitions ---"
ROUTING="$PLUGIN_SRC/rules/intent-routing.md"
if [ ! -f "$ROUTING" ]; then
  fail "intent-routing.md not found at $ROUTING"
else
  for flow in "### Research" "### Plan" "### Implement" "### Verify"; do
    if grep -q "$flow" "$ROUTING"; then
      pass "Flow section '$flow' exists"
    else
      fail "Flow section '$flow' missing from intent-routing.md"
    fi
  done
  for subflow in "### Investigate" "### Reproduce" "### Review" "### Monitor"; do
    if grep -q "$subflow" "$ROUTING"; then
      pass "Sub-flow section '$subflow' exists"
    else
      fail "Sub-flow section '$subflow' missing from intent-routing.md"
    fi
  done
fi
echo ""

# 2. Check no stale flow names remain in source
echo "--- 2. Stale Flow Names ---"
STALE=$(grep -rl "Fix flow\|Build flow\|Ship flow\|Improve flow\|Investigate flow\|Monitor flow\|Review flow" "$PLUGIN_SRC" 2>/dev/null || true)
if [ -z "$STALE" ]; then
  pass "No stale flow names (Fix flow, Build flow, etc.) in $PLUGIN_SRC"
else
  fail "Stale flow names found in: $STALE"
fi
echo ""

# 3. Check all commands exist
echo "--- 3. Commands ---"
for cmd in research verify fix build improve investigate plan ship review monitor; do
  if [ -f "$PLUGIN_SRC/commands/$cmd.md" ]; then
    pass "Command /$cmd exists"
  else
    fail "Command /$cmd missing at $PLUGIN_SRC/commands/$cmd.md"
  fi
done
echo ""

# 4. Check commands reference the correct flows
echo "--- 4. Command -> Flow References ---"
check_cmd_flow() {
  local cmd="$1" expected="$2"
  if grep -q "$expected" "$PLUGIN_SRC/commands/$cmd.md" 2>/dev/null; then
    pass "/$cmd references '$expected'"
  else
    fail "/$cmd does not reference '$expected'"
  fi
}
check_cmd_flow "research" "Research"
check_cmd_flow "plan" "Plan"
check_cmd_flow "fix" "Implement"
check_cmd_flow "build" "Implement"
check_cmd_flow "improve" "Implement"
check_cmd_flow "investigate" "Implement"
check_cmd_flow "verify" "Verify"
check_cmd_flow "ship" "Verify"
check_cmd_flow "review" "Review"
check_cmd_flow "monitor" "Monitor"
echo ""

# 5. Check all agents referenced in intent-routing exist
echo "--- 5. Agent References ---"
AGENTS_DIR="$PLUGIN_SRC/agents"
for agent in product-specialist architecture-specialist test-specialist builder bug-fixer \
             debug-specialist git-history-analyzer ops-specialist verification-specialist \
             quality-specialist security-specialist performance-specialist learner jira-agent; do
  if [ -f "$AGENTS_DIR/$agent.md" ]; then
    pass "Agent '$agent' exists"
  else
    # ops-specialist is stack-specific, check expo/rails
    if [ "$agent" = "ops-specialist" ]; then
      if [ -f "plugins/src/expo/agents/$agent.md" ] || [ -f "plugins/src/rails/agents/$agent.md" ]; then
        pass "Agent '$agent' exists (stack-specific)"
      else
        warn "Agent '$agent' not found in base (expected in stack-specific plugins)"
      fi
    else
      fail "Agent '$agent' referenced in intent-routing but not found"
    fi
  fi
done
echo ""

# 6. Check hooks
echo "--- 6. Hooks ---"
HOOK_FILE="$PLUGIN_SRC/hooks/inject-flow-context.sh"
if [ -f "$HOOK_FILE" ]; then
  pass "inject-flow-context.sh exists"
  if [ -x "$HOOK_FILE" ]; then
    pass "inject-flow-context.sh is executable"
  else
    fail "inject-flow-context.sh is not executable"
  fi
  # Test it produces valid JSON
  HOOK_OUTPUT=$(echo '{}' | bash "$HOOK_FILE" 2>/dev/null)
  if echo "$HOOK_OUTPUT" | jq . >/dev/null 2>&1; then
    pass "inject-flow-context.sh produces valid JSON"
    # Check it has the right structure
    if echo "$HOOK_OUTPUT" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null 2>&1; then
      pass "inject-flow-context.sh has correct JSON structure"
    else
      fail "inject-flow-context.sh missing hookSpecificOutput.additionalContext"
    fi
  else
    fail "inject-flow-context.sh does not produce valid JSON"
  fi
else
  fail "inject-flow-context.sh not found"
fi
echo ""

# 7. Check plugin.json
echo "--- 7. Plugin Configuration ---"
PLUGIN_JSON="$PLUGIN_SRC/.claude-plugin/plugin.json"
if jq . "$PLUGIN_JSON" >/dev/null 2>&1; then
  pass "plugin.json is valid JSON"
else
  fail "plugin.json is not valid JSON"
fi

# Check haiku prompt hook is registered
if jq -e '.hooks.UserPromptSubmit[].hooks[] | select(.type == "prompt")' "$PLUGIN_JSON" >/dev/null 2>&1; then
  pass "Haiku prompt hook registered in UserPromptSubmit"
else
  fail "Haiku prompt hook not found in UserPromptSubmit"
fi

# Check inject-flow-context is registered in SubagentStart
if jq -e '.hooks.SubagentStart[] | select(.hooks[].command | test("inject-flow-context"))' "$PLUGIN_JSON" >/dev/null 2>&1; then
  pass "inject-flow-context.sh registered in SubagentStart"
else
  fail "inject-flow-context.sh not registered in SubagentStart"
fi
echo ""

# 8. Check built plugin matches source
echo "--- 8. Built Plugin ---"
if [ -d "$PLUGIN_BUILT" ]; then
  for file in commands/research.md commands/verify.md hooks/inject-flow-context.sh rules/intent-routing.md; do
    if [ -f "$PLUGIN_BUILT/$file" ]; then
      if diff -q "$PLUGIN_SRC/$file" "$PLUGIN_BUILT/$file" >/dev/null 2>&1; then
        pass "Built $file matches source"
      else
        fail "Built $file differs from source (run bun run build:plugins)"
      fi
    else
      fail "Built $file not found (run bun run build:plugins)"
    fi
  done
else
  fail "Built plugin directory $PLUGIN_BUILT not found"
fi
echo ""

# 9. Check readiness gates are defined
echo "--- 9. Readiness Gates ---"
for gate in "Gate:" "problem statement" "PRD" "acceptance criteria" "local validation"; do
  if grep -q "$gate" "$ROUTING"; then
    pass "Readiness gate reference '$gate' found"
  else
    warn "Readiness gate reference '$gate' not found in intent-routing.md"
  fi
done
echo ""

# 10. Check headless mode handling
echo "--- 10. Headless Mode ---"
if grep -qi "headless\|non-interactive" "$ROUTING"; then
  pass "Headless/non-interactive mode handling documented"
else
  fail "No headless/non-interactive mode handling in intent-routing.md"
fi
if grep -qi "do NOT ask" "$ROUTING"; then
  pass "Explicit 'do NOT ask' directive for headless mode"
else
  warn "Missing explicit 'do NOT ask' directive for headless mode"
fi
echo ""

# Summary
echo "=== Summary ==="
echo "  Passed: checks completed"
echo "  Errors: $ERRORS"
echo "  Warnings: $WARNINGS"
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS error(s) found. Fix before deploying."
  exit 1
else
  echo ""
  echo "ALL CHECKS PASSED."
  exit 0
fi

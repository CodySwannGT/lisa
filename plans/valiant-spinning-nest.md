# Fix: Surgical cleanup of stale hook references in postinstall

## Context

Lisa migrated all hook scripts from `.claude/hooks/` (project-level) to the plugin system (`${CLAUDE_PLUGIN_ROOT}/hooks/` in `plugin.json`). The old scripts are deleted via `all/deletions.json`, but the `$CLAUDE_PROJECT_DIR/.claude/hooks/` references in `.claude/settings.json` persist because:

1. Merge templates (expo, typescript, etc.) have **no `hooks` key** — so the merge strategy just preserves the project's existing stale hooks
2. The postinstall cleanup in `install-claude-plugins.sh` (lines 30-43) deletes the **entire `hooks` key**, which is too blunt — it also kills legitimate inline hooks (`command -v entire ...`, `echo 'REMINDER...'`, etc.)

This causes "No such file or directory" errors for every downstream project on update.

## Fix

Update the python3 cleanup in `scripts/install-claude-plugins.sh` (lines 30-43) to surgically remove only hook entries whose `command` contains `$CLAUDE_PROJECT_DIR/.claude/hooks/`, then clean up empty structures.

### File: `scripts/install-claude-plugins.sh` (lines 30-43)

Replace the current blunt `del d["hooks"]` with:

```python
import json, sys

path = sys.argv[1]
with open(path) as f:
    d = json.load(f)

if "hooks" not in d:
    sys.exit(0)

changed = False
for category in list(d["hooks"]):
    matchers = d["hooks"][category]
    for matcher_block in matchers:
        original = matcher_block.get("hooks", [])
        filtered = [h for h in original if "$CLAUDE_PROJECT_DIR/.claude/hooks/" not in h.get("command", "")]
        if len(filtered) != len(original):
            matcher_block["hooks"] = filtered
            changed = True
    # Remove matcher blocks with no hooks left
    d["hooks"][category] = [m for m in matchers if m.get("hooks")]
    # Remove empty categories
    if not d["hooks"][category]:
        del d["hooks"][category]
        changed = True

# Remove hooks key entirely if empty
if not d["hooks"]:
    del d["hooks"]
    changed = True

if changed:
    with open(path, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
```

**What this preserves:**
- `command -v entire >/dev/null 2>&1 && entire hooks claude-code ...` (entire CLI)
- `echo 'REMINDER: ...'` (project-specific reminders)
- Any other non-file-path hooks projects may have added

**What this removes:**
- `$CLAUDE_PROJECT_DIR/.claude/hooks/notify-ntfy.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-edit.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/sg-scan-on-edit.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/install-pkgs.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/setup-jira-cli.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/sync-tasks.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/enforce-plan-rules.sh`
- `$CLAUDE_PROJECT_DIR/.claude/hooks/debug-hook.sh`
- Any other `$CLAUDE_PROJECT_DIR/.claude/hooks/` reference

## Verification

1. Run `bun run test` in Lisa repo — ensure existing tests pass
2. Create a temp project with a settings.json containing both stale and legitimate hooks, run the postinstall script, verify only stale entries are removed
3. Integration: run `bun update @codyswann/lisa` in propswap/frontend and confirm no hook errors

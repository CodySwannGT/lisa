# Plan: Add Impeccable Design Plugin to Expo and Rails Projects

## Context

Impeccable (pbakaus/impeccable) is a Claude Code plugin that provides design skills and commands for frontend UI development. It includes a `frontend-design` skill with 7 reference docs (typography, color/contrast, spatial design, motion, interaction, responsive, UX writing) and 20 steering commands (`/audit`, `/polish`, `/critique`, etc.).

We want Expo and Rails projects (which have frontend UI) to get this plugin automatically via Lisa's settings.json merge.

## Changes

### 1. Modify `expo/merge/.claude/settings.json`

Add to `enabledPlugins`:
```json
"impeccable@impeccable": true
```

Add to `extraKnownMarketplaces`:
```json
"pbakaus/impeccable": {
  "source": {
    "source": "github",
    "repo": "pbakaus/impeccable"
  }
}
```

### 2. Modify `rails/merge/.claude/settings.json`

Same two additions.

## Files

| # | Action | File |
|---|--------|------|
| 1 | MODIFY | `expo/merge/.claude/settings.json` |
| 2 | MODIFY | `rails/merge/.claude/settings.json` |

## Verification

1. Run `lisa` on a downstream Expo project and verify `impeccable@impeccable` appears in the merged `.claude/settings.json`
2. Open Claude Code in the project and verify `/audit`, `/polish`, etc. are available as commands

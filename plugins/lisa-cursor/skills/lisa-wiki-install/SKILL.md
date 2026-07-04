---
name: lisa-wiki-install
description: "Bootstrap the LLM Wiki kernel (lisa-wiki plugin) in a host project. Solves the chicken-and-egg gap: the base lisa plugin can install the wiki plugin so its setup skill becomes discoverable. Edits .claude/settings.json to enable lisa-wiki@lisa and confirm the CodySwannGT/lisa marketplace, then for Codex verifies whether the .codex/skills/lisa overlay already carries lisa-wiki-* skills (printed by Lisa's apply) and nudges the user to refresh the overlay if missing. Idempotent. Never auto-runs `lisa apply`. After this skill, reload the runtime and run /setup:wiki (Claude) or $lisa-wiki-setup (Codex) to scaffold the wiki itself."
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---

# Install the LLM Wiki kernel

This skill makes the `lisa-wiki` plugin visible in the current project so its scaffolder (`/setup:wiki` / `$lisa-wiki-setup`) can run. It does **not** scaffold the wiki itself — that is the wiki plugin's job. This skill only flips the install bit and verifies the Codex overlay carries the kernel.

## Why this skill exists

`lisa-wiki` is published as `AVAILABLE` (not `INSTALLED_BY_DEFAULT`) in Lisa's marketplace. A downstream project that never enabled it has no way to discover the wiki's setup command — a chicken-and-egg bootstrap gap. Because the base `lisa` plugin is auto-enabled everywhere, putting the bootstrap here is what makes the wiki reachable.

## Asymmetry note

The two runtimes work differently:

- **Claude Code** loads plugin skills per-project through `.claude/settings.json` `enabledPlugins`. The wiki skills are invisible until `lisa-wiki@lisa` is enabled there. This skill makes that edit.
- **Codex** loads Lisa skills through an overlay path (`src/codex/skills-installer.ts` runs from `Lisa.apply()` and copies every built `plugins/<p>/skills/<n>/` into `.codex/skills/lisa/`). Wiki skills land in that overlay automatically every time the project re-applies Lisa. This skill does not mutate Codex config — it only checks whether the overlay carries `lisa-wiki-setup` and tells the user how to refresh if missing.

## Workflow

### Step 1 — Verify we are in a project, not Lisa itself

```bash
cwd="$(pwd)"
if [ -f "$cwd/.lisa-source" ] || { [ -d "$cwd/plugins/src/base" ] && [ -f "$cwd/.claude-plugin/marketplace.json" ]; }; then
  echo "This is the Lisa monorepo itself — the base plugin's wiki kernel already lives here."
  echo "Run /setup:wiki to scaffold a wiki, or invoke this skill from inside a downstream project."
  exit 0
fi
```

### Step 2 — Enable lisa-wiki@lisa in the Claude project settings

Read `<cwd>/.claude/settings.json` (create with `{}` if absent). Then, using the **Edit** or **Write** tool with valid JSON (not jq one-liners that risk corrupting comments / formatting):

1. Ensure `enabledPlugins` is an object.
2. Set `enabledPlugins["lisa-wiki@lisa"] = true`.
3. Ensure `extraKnownMarketplaces` is an object containing the entry below if it is not already present (do **not** overwrite an existing entry):

   ```json
   "CodySwannGT/lisa": {
     "source": {
       "source": "github",
       "repo": "CodySwannGT/lisa"
     }
   }
   ```

4. Pretty-print the file with 2-space indentation and a trailing newline.

If `enabledPlugins["lisa-wiki@lisa"]` was already `true`, log "Claude: lisa-wiki@lisa already enabled — no change." If not, log "Claude: enabled lisa-wiki@lisa in .claude/settings.json."

**Do not** edit `.claude/settings.local.json` — that file is per-user and is not the right surface for a project-level enablement.

### Step 3 — Verify the Codex overlay carries lisa-wiki

```bash
codex_wiki_setup=".codex/skills/lisa/lisa-wiki-setup/SKILL.md"
if [ -f "$codex_wiki_setup" ]; then
  echo "Codex: lisa-wiki overlay already present (found $codex_wiki_setup). Nothing to do for Codex."
else
  echo "Codex: lisa-wiki skills not found in .codex/skills/lisa/."
  if [ -d ".agents" ] || [ -d ".codex" ]; then
    echo "  → This project appears Codex-wired but its overlay is stale or predates lisa-wiki."
    echo "  → Refresh it by running your project's Lisa apply command, e.g.:"
    echo "       npx lisa --harness=codex ."
    echo "    (or whatever shape your project uses to apply Lisa for Codex)."
  else
    echo "  → This project does not have a Codex installation yet (no .agents/ or .codex/). Skip if Codex parity is not needed."
  fi
fi
```

**Do not** invoke `lisa apply` automatically. `lisa apply` rewrites more than the wiki overlay; it must remain the user's explicit choice.

### Step 4 — Hand off

Print:

```
Wiki kernel install complete.

Next steps:
  • Reload your runtime so it picks up the newly-enabled plugin (Claude: /reload or restart the session; Codex: restart `codex`).
  • Then run /setup:wiki (Claude) or $lisa-wiki-setup (Codex) to scaffold wiki/ in this project.
```

## Rules

- Idempotent. Re-running produces no spurious changes once both flags are set.
- Project-scoped only. Never touch `~/.codex/config.toml` or any user-global config.
- Never run `lisa apply` on the user's behalf.
- Never edit `.claude/settings.local.json` — it is user-scoped overrides.
- Preserve human-authored content. Only flip the enablement key and add the marketplace entry if missing.

## Related

`lisa-wiki-setup` (the actual scaffolder, lives in the `lisa-wiki` plugin once enabled), `lisa-wiki-doctor`, `lisa-wiki-usage`.

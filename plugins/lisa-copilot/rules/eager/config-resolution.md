# Config Resolution (load-bearing)

**The resolved configuration is already in your context.** `inject-resolved-config.sh` runs at every session and subagent start and injects the EFFECTIVE values — `.lisa.config.local.json` already merged over `.lisa.config.json` — inside a `<lisa-resolved-config>` block, which **names the directory it resolved for** and marks anything that is a Lisa built-in rather than something that directory declared. Read the values there and act on them, and do not act against them.

They are resolved for **that working directory only**. For work in it, do not re-derive them from the files — that is the saving this block exists for. If your work targets a **different** repository, the block does not describe it: read that repository's config instead. A block with no name on it is how six agent cycles acted on one repository's settings while doing another's work.

That block replaces the paragraph that used to sit here saying where configuration lives and which file wins. Restating it is what nine eager rules were already doing while agents acted against a config they never opened; if the block is ever missing, the two files are the source and the local one wins where they overlap.

Two things the block deliberately does not carry, so they stay here:

- **Writing identity.** Developer-specific identity (`atlassian.email`, etc.) MUST go in the local file, never the committed one. The injected block omits identity entirely, so it will never show you that this is broken.
- **Everything below**, which is behaviour keyed off config rather than the values themselves.

## Atlassian access — assistant-level rule

When the user asks about Atlassian (Jira / Confluence) connection state, or you are about to run a Jira/Confluence operation, and `acli` is installed:

1. Run `acli auth status` and read the active `Site:`.
2. Read `atlassian.site` from `.lisa.config.json` (and `atlassian.email` from `.lisa.config.local.json` if present).
3. **If the active site does not match config, do NOT report "not connected." Run:**
   ```sh
   acli auth switch --site "$ATLASSIAN_SITE" --email "$ATLASSIAN_EMAIL"
   ```
   acli supports multiple authenticated profiles; the switch is fast and non-interactive when a profile already exists.
4. Only after the switch fails (no matching profile) should you report not-connected and suggest `/lisa:setup:atlassian` to add one.

This applies before declaring connection state, before running any `acli jira *` / `acli confluence *` command, and before falling back to the Atlassian MCP or curl substrates. Identity mismatch is treated as silent-misroute risk, not as a hard not-connected.

## Tracker selection

Project tracker (`jira` / `github` / `linear`) is read from `.lisa.config.json` `tracker`. Vendor-neutral skills MUST dispatch through the configured tracker, never infer it from arguments. Missing `tracker` → stop and instruct the user to run the matching `/lisa:setup:*` skill.

## Repo identity

`repo:<name>` is the canonical label for which repo a work item belongs to. Resolve current-repo identity in this priority order: `.lisa.config.local.json` `repo` → `.lisa.config.json` `repo` → `.lisa.config.json` `github.repo` → `basename -s .git "$(git remote get-url origin)"`. If none resolve, stop with a clear error.

Full reference (tracker status vocabulary, project rules and learnings, the optional Kane provider, the `Target Backend Environment` grammar, and env-keyed `done` promotion completeness): [reference/config-resolution.md](../reference/config-resolution.md).

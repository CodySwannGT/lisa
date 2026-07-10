---
name: lisa-wiki-setup
description: "Scaffold, repair, verify, or…"
---

# lisa-wiki-setup

Bring a repo's `wiki/` into conformance with the canonical structure from
`wiki/lisa-wiki.config.json`. Safe to re-run: it creates what is missing and repairs drift, but
never overwrites human-authored content.

## When to use
- First-time setup of the wiki in a repo.
- Repairing a wiki that fails `/doctor` structural checks.
- Upgrading after a new `lisa-wiki` release (`--upgrade`): re-render the contract snapshot and run a
  compatibility report before writing.
- `--with-ci`: also install the optional GitHub Action validator (`ci/lisa-wiki-validate.yml`).

## Workflow
1. **Config.** Read `wiki/lisa-wiki.config.json`, or create it interactively. Ask for: `org`,
   `displayName`, **`purpose`** (one paragraph — what this wiki is for), `mode`
   (`embedded|wrapper|standalone|subdir`), `categories`, source layout, connectors, sensitivity,
   `sourceRetention`, and the **README mode** (`rich` default | `stub` | `preserve` — always ask;
   never select `stub` implicitly). If `staff` is absent, seed the **standard roster** (below) as the
   default — every wiki gets the standard operating team unless the user opts out or edits it. Union
   each role's owned categories into `config.categories`. Validate with `scripts/validate-config.mjs`.
2. **Structure.** Scaffold the canonical tree per `schema/wiki-structure.schema.json`:
   `wiki/{index.md, log.md, start-here.md, schema/, sources/, state/, staff/, <category dirs>}`.
   Create only what is missing.
3. **Contract.** Render `wiki/schema/llm-wiki-contract.md` from the plugin templates + config via
   `scripts/render-contract.mjs`, stamping the `kernelVersion`. This snapshot keeps the wiki
   self-describing without the plugin installed.
4. **Gitignore.** Merge the lisa-wiki gitignore block into the project's `.gitignore` via
   `scripts/ensure-gitignore.mjs`. The block (delimited by `# BEGIN: AI GUARDRAILS WIKI` /
   `# END: AI GUARDRAILS WIKI`) covers transient per-session worktrees and Lisa backup snapshots
   (`.claude/worktrees/`, `.codex/worktrees/`, `.lisabak/`). Idempotent: re-running produces no
   diff once the block is present. The block coexists with the base lisa plugin's
   `# BEGIN: AI GUARDRAILS` block — both can be installed without overwriting each other because
   the copy-contents strategy keys on the marker suffix. Wiki-wrapper repos (mode `wrapper` /
   `standalone`) typically don't enable the base lisa plugin, so this step is the only path by
   which they get the worktree-ignore patterns.
5. **Pointers.** Ensure `AGENTS.md` / `CLAUDE.md` point at the contract + plugin (thin pointers only).
6. **Staff.** For each `config.staff[]` entry (the standard roster by default), generate the role's
   `wiki/staff/<role>.md` page and its dual-runtime subagents by delegating to `lisa-wiki-add-role`
   (running the subagents is out of scope).
7. **README.** Apply the chosen README mode (ingest the old README first; `rich` keeps install/usage +
   adds the onboarding line; `stub` is the minimal pointer; `preserve` leaves it).
8. **Verify.** Run `lisa-wiki-doctor` and report the verdict + any blocking items.

## Standard roster
The default operating team seeded into `config.staff[]` for every new wiki (Chief of Staff plus six
domain agents). Each role becomes a `wiki/staff/<id>.md` page and a dual-runtime subagent; the human
owner talks to Chief, who routes to the others. Owned categories are unioned into `config.categories`.

| id | role | owns (categories) | sensitivity |
|---|---|---|---|
| `chief` | Chief of Staff | `projects`, `decisions`, `playbooks`, `open-questions` | confidential |
| `sally` | Sales | `sales` | internal |
| `mark` | Marketing | `marketing` | internal |
| `felix` | Finance | `finance` | confidential |
| `casey` | Customer Success | `customers` | internal |
| `parker` | People | `people` | confidential |
| `lex` | Legal & Compliance | `legal` | confidential |

Projects may add, remove, or rename roles afterward; the standard roster is the starting point, not a
constraint.

## Rules
- Idempotent; re-running produces no spurious changes.
- Never overwrite human content; only create/repair structure and the rendered snapshot. The README is
  rewritten only after its old content has been ingested, and only per the chosen `readme.mode`.
- Project-scoped only; never stage secrets/OAuth artifacts; honor `mode` safety (wrapper/standalone).

## Related
`lisa-wiki-add-role`, `lisa-wiki-doctor`, `lisa-wiki-migrate`, `lisa-wiki-usage`.

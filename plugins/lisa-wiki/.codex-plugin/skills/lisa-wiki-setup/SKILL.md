---
name: lisa-wiki-setup
description: "Scaffold, repair, verify, or…"
---
Scaffold, repair, verify, or upgrade this repository's LLM Wiki at wiki/. Use when setting up the wiki in a repo, fixing a broken structure, or upgrading the wiki kernel. Idempotent and non-destructive.


# lisa-wiki-setup

Bring this repo's `wiki/` into conformance with the canonical structure from
`wiki/lisa-wiki.config.json`. Every repository owns its own wiki at `wiki/`; there is no shared or
mirrored wiki. Safe to re-run: it creates what is missing and repairs drift, but never overwrites
human-authored content.

## When to use
- First-time setup of the wiki in a repo (`/lisa:agent-ready` calls this for brownfield projects).
- Repairing a wiki that fails `/doctor` structural checks.
- Upgrading after a new `lisa-wiki` release (`--upgrade`): re-render the contract snapshot and run a
  compatibility report before writing.
- `--with-ci`: also install the optional GitHub Action validator (`ci/lisa-wiki-validate.yml`).

## Workflow
1. **Config.** Read `wiki/lisa-wiki.config.json`, or create it. Ask for (or derive, when running
   unattended): `org`, `displayName`, **`purpose`** (one paragraph — what this wiki is for),
   `categories`, source layout, connectors, sensitivity, `sourceRetention`, and the **README mode**
   (`rich` default | `stub` | `preserve` — never select `stub` implicitly). Validate with
   `scripts/validate-config.mjs`.
2. **Structure.** Scaffold the canonical tree per `schema/wiki-structure.schema.json`:
   `wiki/{index.md, log.md, start-here.md, schema/, sources/, state/, <category dirs>}`.
   Create only what is missing. `start-here.md` carries a **Related repositories** section: plain
   pointers (`org/repo` and one line on what it owns) to the other repositories this product is built
   from, including any wiki-only repo for product-wide knowledge. Leave it empty when there are none.
3. **Contract.** Render `wiki/schema/llm-wiki-contract.md` from the plugin templates + config via
   `scripts/render-contract.mjs`, stamping the `kernelVersion`. This snapshot keeps the wiki
   self-describing without the plugin installed.
4. **Pointers.** Ensure `AGENTS.md` / `CLAUDE.md` point at the contract + plugin (thin pointers only).
5. **README.** Apply the chosen README mode (ingest the old README first; `rich` keeps install/usage;
   `stub` is the minimal pointer; `preserve` leaves it).
6. **Verify.** Run `lisa-wiki-doctor` and report the verdict + any blocking items.

## Rules
- Idempotent; re-running produces no spurious changes.
- Never overwrite human content; only create/repair structure and the rendered snapshot. The README is
  rewritten only after its old content has been ingested, and only per the chosen `readme.mode`.
- Project-scoped only; never stage secrets or credential artifacts.

## Related
`lisa-wiki-doctor`, `lisa-wiki-migrate`, `lisa-wiki-usage`.

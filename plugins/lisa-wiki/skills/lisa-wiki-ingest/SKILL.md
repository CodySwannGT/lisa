---
name: lisa-wiki-ingest
description: Ingest source material into the LLM Wiki. With an argument (URL, file path, or prompt) it ingests that one source; with no argument it runs a full ingest across every enabled non-external-write source. Routes to the right connector, then runs the ordered pipeline (source note → synthesis → index → log → verify → state → commit/PR). Use whenever new knowledge should enter the wiki.
---

# lisa-wiki-ingest

The single entry point for getting knowledge into the wiki. It is a **router**: it never reimplements
synthesis per source — it selects a connector to produce a sanitized source note, then the kernel
performs the shared, ordered pipeline.

## Modes
- **Targeted:** `/ingest <url|file|prompt>` — ingest one source. Classify the input and pick the
  matching connector.
- **Full:** `/ingest` (no argument, or "do a full ingest") — iterate **every enabled connector whose
  side-effect policy permits unattended ingest**: self + other registered projects' git/PR history,
  project-scoped memory, roles, plus read-only registered sources (notion, jira, confluence,
  quickbooks, …). `external-write` connectors (Slack OAuth, CRM writeback) are **skipped unless the
  run includes explicit external-write intent**.
- **Dry run:** `/ingest --dry-run` — list the sources a full ingest would run; perform no writes.

## Before ingesting — sync the branch (once per run)

Run this **once per ingest invocation, before any source is processed** (skip for `--dry-run`, which
writes nothing). The point is to ingest on top of fresh state, never stale state.

1. **Resolve the default remote branch** — `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`,
   or `git remote show origin | sed -n 's/.*HEAD branch: //p'`, or the `origin/HEAD` symbolic ref. If
   the repo has no remote, note "no remote — skipping branch sync" and proceed.
2. **Fetch** — `git fetch <remote>` to update remote-tracking refs.
3. **Bring the working branch up to date with the default remote branch** so the ingest lands on
   current state:
   - On the default branch → fast-forward to `<remote>/<default>` (`git pull --ff-only`).
   - On a non-default branch → merge or rebase `<remote>/<default>` in (per the project's convention)
     so the branch is not behind the default.
4. If the sync cannot complete cleanly (merge conflict, diverged history, or a dirty tree that would
   conflict), **stop and surface it** rather than ingesting on top of stale or conflicted state — the
   human resolves and re-runs. **Never discard unrelated working-tree changes** to force a sync.

## The ordered pipeline (per source) — never reorder
1. **Connector** validates (tenant guard + auth), reads its state cursor (first-run vs incremental),
   fetches read-only, and writes a sanitized **source note** under `wiki/sources/<system>/` plus run
   metadata. A connector writes *only* its source note + metadata — never synthesis/index/log/state.
2. **Synthesis** (kernel): distill durable knowledge into the appropriate category pages, with
   citations back to the source note. Weak/uncertain material → `wiki/open-questions/`, never asserted.
3. **Index**: update `wiki/index.md`.
4. **Log**: append a `wiki/log.md` entry (fixed operation vocabulary).
5. **Verify**: `git diff --check`, secret/tenant/contamination scans, touched-file guard.
6. **State**: advance the connector's `wiki/state/<system>/*.json` cursor — only now, after 1–5 pass.
7. **Commit/PR**: commit only the ingestion changes per `config.git` policy. If the ingest started on
   the default branch, create a dedicated ingestion branch first — never commit ingestion straight to
   the default. Push the branch and **open a PR targeting the default remote branch** (via the host's
   PR mechanism — e.g. `gh pr create --base <default>`), then **enable auto-merge when possible**
   (`gh pr merge --auto`, or the host's equivalent). `external-write` runs and sensitive content are
   the exception — open the PR **without** auto-merge so a human reviews them before it lands. If
   auto-merge cannot be enabled (the host doesn't support it, or branch protection forbids it), leave
   the PR open and note that a human must merge.

## Rules
- **Bookend every ingest with git hygiene:** sync the branch with the default remote branch *before*
  writing (see "Before ingesting"), and *after* a successful ingest open a PR to the default remote
  branch with auto-merge enabled when possible — never auto-merging `external-write`/sensitive runs.
  `--dry-run` does neither (it writes nothing).
- Source-note-before-synthesis; state advanced **only** after verification.
- Project-scoped only; memory ingestion never touches global/Codex-global stores.
- Respect `sourceRetention` and `sensitivity`; do not invent facts.
- Connector execution and the connector contract are detailed in the connector skills (M2+); this
  router defines and enforces the ordering and side-effect rules above.

## Related
`lisa-wiki-add-ingest` (scaffold a custom front-door that chains here), `lisa-wiki-query`,
`lisa-wiki-lint`, `lisa-wiki-doctor`.

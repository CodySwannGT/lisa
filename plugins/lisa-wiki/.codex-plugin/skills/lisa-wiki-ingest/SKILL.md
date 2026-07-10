---
name: lisa-wiki-ingest
description: "Ingest source material into the…"
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

## Step 0 — resolve the wiki root (once per run)

Before anything else, run `node scripts/ensure-wiki.mjs --json` and use the returned `wikiRoot` as the
base for the whole pipeline — never hardcode `wiki/`. This is mode-agnostic by design:

- **Local wiki** (no `wiki.source` in `.lisa.config.json`) — resolves the in-repo wiki root instantly;
  the branch sync below proceeds against **this** repo's remote, exactly as before.
- **Remote wiki** (`wiki.source.url` set) — `ensure-wiki` mirrors/refreshes the gitignored working copy
  of the canonical wiki repo and returns its path. In this mode the "sync the branch" step below, and
  the Commit/PR step (7), operate against the **wiki repo's own remote** (the mirror), not the host
  project's `origin`. The host project repo is never written to.

## Before ingesting — sync the branch (once per run)

Run this **once per ingest invocation, before any source is processed** (skip for `--dry-run`, which
writes nothing). The point is to ingest on top of fresh state, never stale state. Operate in the wiki
root resolved in Step 0 — the host repo for a local wiki, the mirror for a remote one.

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
   PR mechanism — e.g. `gh pr create --base <default>`). Before enabling auto-merge, feed the safety
   scan output into `createWikiIngestPublicationPolicy` from `scripts/wiki-safety.mjs`. Enable
   auto-merge only when `autoMergeAllowed` is true. `external-write` runs, redacted runs, and any run
   with sensitive findings are the exception — open the PR **without** auto-merge so a human reviews
   them before it lands. The PR summary must include the policy's safe review summary: counts and
   entity types only, never raw values, ranges, tokens, source snippets, or scanner output. If
   auto-merge cannot be enabled (the host doesn't support it, branch protection forbids it, or the
   policy requires review), leave the PR open and note that a human must merge.

## Rules
- **Bookend every ingest with git hygiene:** sync the branch with the default remote branch *before*
  writing (see "Before ingesting"), and *after* a successful ingest open a PR to the default remote
  branch with auto-merge enabled when possible — never auto-merging `external-write`/sensitive runs.
  `--dry-run` does neither (it writes nothing).
- Source-note-before-synthesis; state advanced **only** after verification.
- Project-scoped only; memory ingestion never touches global/Codex-global stores.
- Respect `sourceRetention` and `sensitivity`; do not invent facts.
- Before advancing state or committing, run the generated-output safety gate
  (`scripts/verify-wiki-safety.mjs`) against the wiki files/source notes produced by
  the ingest. The default built-in scan blocks unredacted private keys, tokens, and
  common financial/person identifiers without printing raw values. Projects may
  select `--scanner gitleaks` for local parity with Gitleaks, and may use
  `--scanner trufflehog` as a stricter optional verification pass when installed;
  if a selected scanner is unavailable, keep the ingest blocked for review.
- Redaction and review policy is centralized in `scripts/wiki-safety.mjs`. Treat
  `reviewRequired` or any summarized finding as a hard auto-merge stop. Use the
  generated PR summary text as-is or preserve its shape so reviewers see entity
  types and counts without raw sensitive values.
- Connector execution and the connector contract are detailed in the connector skills (M2+); this
  router defines and enforces the ordering and side-effect rules above.

## Related
`lisa-wiki-add-ingest` (scaffold a custom front-door that chains here), `lisa-wiki-query`,
`lisa-wiki-lint`, `lisa-wiki-doctor`.

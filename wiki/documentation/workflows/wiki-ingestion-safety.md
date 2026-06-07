---
type: documentation
created: 2026-06-06
updated: 2026-06-06
---

# Wiki Ingestion Safety

Lisa wiki ingestion preserves reader-safe source notes under `wiki/sources/` before synthesis. Source notes must be useful for future readers without exposing secrets, credentials, financial identifiers, private personal identifiers, or raw sensitive source snippets.

## Safety Model

Wiki connectors must sanitize source-note text before writing it. The shared helper in `plugins/src/wiki/scripts/wiki-safety.mjs` redacts built-in sensitive classes such as private keys, access tokens, API keys, passwords, SSNs, credit cards, bank account numbers, and routing numbers. The safety result stores safe metadata only: entity type, confidence, count, and source identity. It must not store raw values.

Before committing an ingest, run the generated-output safety gate against the touched wiki output. The built-in scanner is dependency-free. Projects may also select Gitleaks for local parity, or TruffleHog as a stricter optional pass when installed. If a required scanner is unavailable, keep the ingest blocked for review instead of writing around the check.

## Review And Auto-Merge

Redacted or sensitive ingest PRs require human review. The PR publisher must call `createWikiIngestPublicationPolicy` with the safety scan results before enabling auto-merge.

- Clean, non-external-write ingest: auto-merge may be enabled when verification passes.
- External-write ingest: auto-merge stays disabled.
- Redacted ingest: auto-merge stays disabled.
- Sensitive finding summary present: auto-merge stays disabled.

The PR summary should report only safe metadata: total counts and entity types. It must not include raw values, scanner excerpts, token strings, secret fragments, or source snippets. Reviewers should inspect the sanitized source notes and the originating system if they need to decide whether the redactions are acceptable.

## Local Overrides

Local scanner selection belongs in operator commands or project-local configuration. Use local overrides to require an installed scanner, to add a stricter optional scanner, or to force dry-run behavior while evaluating a new source. Do not commit local secrets, OAuth artifacts, or scanner credentials to the repository.

When a local override marks a scanner as required and the scanner is unavailable, ingestion should remain blocked. The correct repair is to install the scanner, relax the local requirement intentionally, or run a dry run that writes nothing.

## False Positives And False Negatives

For false positives, keep the redacted source note and document the reviewer decision in the PR. A reviewer may allow the PR to merge manually after confirming that no useful raw sensitive value was lost or exposed. Do not replace placeholders with raw values just to preserve source fidelity.

For false negatives, add a focused fixture or scanner rule before re-running the ingest. The source-note contract favors conservative redaction over perfect recall. If a raw sensitive value reaches generated wiki output, treat it as blocking until the output is rewritten safely and the safety gate passes.

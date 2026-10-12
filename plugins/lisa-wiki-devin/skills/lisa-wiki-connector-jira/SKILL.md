---
name: lisa-wiki-connector-jira
description: Produce sanitized JIRA source notes for lisa-wiki ingest via the Atlassian MCP. Use only when lisa-wiki-ingest routes to the jira connector. Read-only; tenant-guarded.
---

# lisa-wiki-connector-jira

Skill-driven connector (Atlassian MCP). Writes ONLY source notes under `wiki/sources/jira/` and emits
a proposed cursor; the kernel does synthesis/index/log/verify/state/PR.

## Flow
1. Confirm `connectors.jira.enabled` and `sideEffects: read-only-ingest`.
2. **Tenant guard:** verify the active Atlassian connection resolves to
   `connectors.jira.tenantGuard.site` / `cloudId`. If it resolves to a different account/tenant,
   **abort** (do not ingest) — this is the cross-tenant contamination guard.
3. **Window:** read `wiki/state/jira/*.json`. First run → last 4 months (or configured window);
   incremental → issues `updated >=` the cursor watermark. Scope to `connectors.jira.projects[]`.
4. **Fetch (read-only)** via the Atlassian MCP (JQL search + issue read). Never write to JIRA.
5. **Write source notes** under `wiki/sources/jira/<YYYY-MM-DD>-jira-ingest.md` — reader-safe, with
   frontmatter (`type: source`, dates, `source_system: jira`) and citations (`Source: <issue key>`).
   Redact secrets; honor `sourceRetention`/`sensitivity`.
6. **Emit run metadata** (proposed cursor: latest `updated` watermark, counts) to the handoff file,
   then return to `lisa-wiki-ingest`.

## Rules
- Abort on tenant mismatch; never invent issues/PRs/people; weak evidence → open-questions.
- If the Atlassian MCP is absent, the connector is disabled (see `scripts/mcp-doctor.mjs`).
- Writes only source notes + handoff meta; the kernel advances state.

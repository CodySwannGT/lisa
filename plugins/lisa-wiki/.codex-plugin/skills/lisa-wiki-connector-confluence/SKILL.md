---
name: lisa-wiki-connector-confluence
description: "Produce sanitized Confluence…"
---

# lisa-wiki-connector-confluence

Skill-driven connector (Atlassian MCP). Writes ONLY source notes under `wiki/sources/confluence/` and
emits a proposed cursor; the kernel does the rest.

## Flow
1. Confirm `connectors.confluence.enabled` and `sideEffects: read-only-ingest`.
2. **Tenant guard:** verify the Atlassian connection matches `connectors.confluence.tenantGuard`
   (same site/cloudId discipline as jira). Abort on mismatch.
3. **Window:** read `wiki/state/confluence/*.json`. First run → configured window; incremental →
   pages updated since the cursor. Scope to the configured spaces.
4. **Fetch (read-only)** page content + metadata via the Atlassian MCP. Never edit Confluence.
5. **Write source notes** under `wiki/sources/confluence/<YYYY-MM-DD>-confluence-ingest.md` with
   frontmatter and citations (`Source: <space>/<page>`). Redact secrets; honor retention/sensitivity.
6. **Emit run metadata** (proposed cursor, counts) to the handoff file; return to `lisa-wiki-ingest`.

## Rules
- Abort on tenant mismatch; do not invent pages/decisions; weak evidence → open-questions.
- Disabled if the Atlassian MCP is absent (`scripts/mcp-doctor.mjs`).
- Writes only source notes + handoff meta; the kernel advances state.

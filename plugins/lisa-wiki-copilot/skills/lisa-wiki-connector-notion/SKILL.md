---
name: lisa-wiki-connector-notion
description: Produce sanitized Notion source notes for lisa-wiki ingest via the Notion MCP. Use only when lisa-wiki-ingest routes to the notion connector. Read-only; teamspace-guarded.
---

# lisa-wiki-connector-notion

Skill-driven connector (Notion MCP). Writes ONLY source notes under `wiki/sources/notion/` and emits a
proposed cursor; the kernel does the rest.

## Flow
1. Confirm `connectors.notion.enabled` and `sideEffects: read-only-ingest`.
2. **Tenant guard:** verify the Notion connection resolves to
   `connectors.notion.tenantGuard.teamspace` / `teamspaceId`. Abort on a different workspace/teamspace.
3. **Window:** read `wiki/state/notion/*.json`. First run → configured window; incremental → pages
   edited since the cursor.
4. **Fetch (read-only)** via the Notion MCP. Never edit Notion.
5. **Write source notes** under `wiki/sources/notion/<YYYY-MM-DD>-notion-ingest.md` with frontmatter
   and citations (`Source: <notion page>`). Redact secrets; honor retention/sensitivity.
6. **Emit run metadata** (proposed cursor, counts) to the handoff file; return to `lisa-wiki-ingest`.

## Rules
- Abort on teamspace mismatch; do not invent pages; weak evidence → open-questions.
- Disabled if the Notion MCP is absent (`scripts/mcp-doctor.mjs`).
- Writes only source notes + handoff meta; the kernel advances state.

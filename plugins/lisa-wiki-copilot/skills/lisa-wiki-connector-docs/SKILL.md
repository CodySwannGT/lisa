---
name: lisa-wiki-connector-docs
description: Ingest a local document (PDF, DOCX, Markdown, text) into a sanitized source note for lisa-wiki ingest. Use only when lisa-wiki-ingest routes to the docs connector (a file-path input). Uses available local converters; no heavy bundled dependency.
---

# lisa-wiki-connector-docs

Skill-driven connector. Converts a local document to markdown using whatever converter is available,
writes a source note, and hands off; the kernel does the rest.

## Converters (no bundled heavy dependency)
- **Markdown / text**: ingest directly.
- **PDF**: `pdftotext` (Poppler) if available, else `pandoc`.
- **DOCX**: `pandoc` if available, else `textutil` (macOS).
If no suitable converter is installed, **skip that source and record a `docs` doctor finding** (the
file could not be converted) so the user can install a converter — a targeted `/ingest <file>` reports
the skip rather than pretending success. Missing converters are connector-specific, never a
plugin-install blocker.

## Flow
1. Confirm `connectors.docs.enabled` and `sideEffects: read-only-ingest`.
2. Resolve the input file; pick the converter by extension; convert to markdown (read-only).
3. Write a source note under `wiki/sources/docs/<YYYY-MM-DD>-<slug>.md` with frontmatter
   (`type: source`, dates, `source_system: docs`, original filename) and the converted, reader-safe
   text. Redact secrets; honor `sourceRetention`/`sensitivity`.
4. Emit run metadata (source-note path) to the handoff file; return to `lisa-wiki-ingest`.

## Rules
- Read-only on the source document; never modify the original.
- Writes only the source note + handoff meta; the kernel advances state.

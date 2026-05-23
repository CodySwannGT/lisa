---
description: "Scaffold a project-specific front-door ingest skill that does something unique (classify a source, fetch from a special system, stamp domain frontmatter) and then chains into /ingest. Extends ingestion without forking the kernel."
argument-hint: "<short name for the new ingest path>"
---

Use the lisa-wiki-add-ingest skill to generate a thin, registered front-door ingest skill: interview the project for the source type, bucket, frontmatter, and side-effect class; emit a lisa-wiki-local-<name> skill that enriches then chains into /ingest; and register it under customConnectors. $ARGUMENTS

# Documentation Source Paths

Do not treat `docs/`, `research/`, `transcripts/`, or other source-material directories as disposable duplicates just because the Lisa monorepo also has `wiki/`.

Before moving, absorbing, or deleting documentation-like paths:

1. Classify each path as one of: durable wiki content, reader-safe source note, executable test fixture, runtime scratch/input path, generated output, or obsolete material.
2. Use `rg` to find every code, test, script, config, README, rule, skill, agent, and wiki reference to the path.
3. Preserve executable fixtures and runtime inputs outside the wiki. They are project behavior, not documentation.
4. When absorbing documentation into `wiki/`, also update source notes, indexes, logs, README links, rule references, and any runtime defaults that pointed at the old path.
5. Delete a source path only after references are updated and verification proves the project no longer reads it.

For Lisa wiki work specifically, `wiki/` is the durable knowledge source, but `docs/`, `research/`, `docs/wiki-inbox/`, and `transcripts/` may still be ingestion inputs, historical source evidence, fixtures, or runtime scratch locations. Preserve reader-safe evidence under `wiki/sources/` and record successful ingestions in `wiki/log.md`.

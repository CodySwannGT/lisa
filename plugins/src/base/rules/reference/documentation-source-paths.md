# Documentation Source Paths

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Documentation Source Paths (load-bearing)

Do not treat `docs/`, `research/`, `transcripts/`, or other source-material directories as disposable duplicates just because a project also has a `wiki/`. They may be ingestion inputs, executable fixtures, runtime inputs, or historical evidence.

Before moving, absorbing, or deleting documentation-like paths:

1. Classify each path: durable wiki content, reader-safe source note, executable test fixture, runtime scratch/input, generated output, or obsolete.
2. Use `rg` to find every code, test, script, config, README, rule, skill, agent, and wiki reference to the path.
3. Preserve executable fixtures and runtime inputs OUTSIDE the wiki — they are project behavior, not documentation.
4. When absorbing into `wiki/`, update source notes, indexes, logs, README links, rule references, and runtime defaults that pointed at the old path.
5. Delete a path only AFTER references are updated and verification proves the project no longer reads it.

---

Do not treat `docs/`, `research/`, `transcripts/`, or other source-material directories as disposable duplicates just because a project also has a `wiki/`.

Before moving, absorbing, or deleting documentation-like paths:

1. Classify each path as one of: durable wiki content, reader-safe source note, executable test fixture, runtime scratch/input path, generated output, or obsolete material.
2. Use `rg` to find every code, test, script, config, README, rule, skill, agent, and wiki reference to the path.
3. Preserve executable fixtures and runtime inputs outside the wiki. They are project behavior, not documentation.
4. When absorbing documentation into `wiki/`, also update source notes, indexes, logs, README links, rule references, and any runtime defaults that pointed at the old path.
5. Delete a source path only after references are updated and verification proves the project no longer reads it.

For Lisa wiki work specifically, `wiki/` is the durable knowledge source, but `docs/`, `research/`, `docs/wiki-inbox/`, and `transcripts/` may still be ingestion inputs, historical source evidence, fixtures, or runtime scratch locations. Preserve reader-safe evidence under `wiki/sources/` and record successful ingestions in `wiki/log.md`.

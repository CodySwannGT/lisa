---
name: lisa-ingest
description: "Ingest source material into the…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:ingest`
- Codex invocation: `$lisa-ingest` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[url | file path | prompt]   (omit for a full ingest)`

Use the lisa-wiki-ingest skill to ingest into the wiki: route the input to the right connector (or, with no argument, run a full ingest across all enabled non-external-write sources), then run the ordered pipeline — sanitized source note, synthesis with citations, index, log, verification, and state advancement, then commit/PR per policy. Use the user's surrounding request as this command's arguments.

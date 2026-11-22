---
description: "Add knowledge to the LLM Wiki. With a URL, file, or prompt it ingests that source; with no argument it runs a full ingest of every enabled source."
argument-hint: "[url | file path | prompt]   (omit for a full ingest)"
---

Use the lisa-wiki-ingest skill to ingest into the wiki: route the input to the right connector (or, with no argument, run a full ingest across all enabled non-external-write sources), then run the ordered pipeline — sanitized source note, synthesis with citations, index, log, verification, and state advancement, then commit/PR per policy. $ARGUMENTS

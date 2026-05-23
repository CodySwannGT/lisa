---
description: "Verify that the wiki is correctly set up and (after migration) fully functional. Runs deterministic checks plus functional smoke tests, writes a doctor report, and returns an overall verdict (READY / READY_WITH_WARNINGS / NOT_READY). The final gate of /migrate; re-runnable anytime."
argument-hint: "[--migration]"
---

Use the lisa-wiki-doctor skill to run the post-migration/post-setup verification checklist: structure & config, integrity & safety, no-loss/parity, runtime surfaces on both runtimes, functional smoke tests (no extra PR), mode-specific, and git/CI/distribution. Write wiki/state/migration/doctor-report.json and report the verdict + blocking items. $ARGUMENTS

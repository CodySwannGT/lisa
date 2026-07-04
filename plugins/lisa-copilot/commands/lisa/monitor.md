---
description: "Monitor application health AND audit observability completeness for the current repo, then file build-ready tickets for anomalies and instrumentation gaps. Health/logs/errors/performance via the stack ops-specialist or stack-agnostic base probing; repo-scoped, idempotent, capped; files by default, --dry-run previews."
argument-hint: "[environment] [--dry-run] [--report-only] [--all-gaps] [max_candidates=<n>]"
---

Use the /lisa-monitor skill to check application health, logs, errors, and performance for the named environment, audit observability completeness, and file build-ready tickets for the anomalies and gaps it finds. Use `--dry-run` to preview without filing, `--report-only` for a health/audit summary with no filing, or `--all-gaps` to also file recommended-tier gaps (session replay, product analytics). $ARGUMENTS

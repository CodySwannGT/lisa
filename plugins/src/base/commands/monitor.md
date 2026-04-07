---
description: "Monitor application health. Checks health endpoints, logs, errors, and performance across environments."
argument-hint: "[environment]"
---

Read `.claude/rules/intent-routing.md` and execute the **Monitor** sub-flow.

This sub-flow is also invoked as part of the Verify flow's remote verification step. Delegates to `ops-specialist` for health checks, log inspection, error monitoring, and performance analysis.

$ARGUMENTS

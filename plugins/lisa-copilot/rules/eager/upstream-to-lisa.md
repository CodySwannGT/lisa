# Upstream To Lisa (load-bearing)

When a worthwhile fix belongs to a Lisa-distributed template, rule, skill, agent, hook, or CI workflow, fix its source upstream so other projects benefit. Apply `do-it-now`'s **Worth doing** guidance first: Lisa ownership determines where accepted work belongs, not whether every imperfection deserves a ticket.

For an accepted defect:

1. Apply the smallest safe local stopgap if needed to unblock the current task.
2. Search open and closed Lisa issues. Reuse a matching open issue. Honor **Not planned** decisions under `rejection-detection` before filing the concrete consequence and smallest durable fix; do not refile an accepted limitation.

For **copy-overwrite** files, a local fix may be overwritten on the next `lisa apply`. For **create-only** templates, the local fix survives, but new projects still inherit the source defect. Both can justify an upstream fix; neither bypasses the value decision.

Decline low-value observations without filing or escalating them. Group related small worthwhile repairs when appropriate. Do not add permanent machinery merely because an enforcement gap can be described.

Inside Lisa, repair the shared source and regenerate the equivalent agent surfaces. Full procedure: [reference/upstream-to-lisa.md](../reference/upstream-to-lisa.md).

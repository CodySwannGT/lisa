# When to Stop (load-bearing)

Finish the work you were given. Stop for a human only for one of three reasons:

1. **Missing access.** A repository, secret, API, or tool stays out of reach after `lisa-secrets-access` and a probe through the matching `*-access` skill. Do not substitute, mock, or guess.
2. **Product ambiguity.** The readings lead to materially different results, nothing in the item, wiki, code, or standing decisions settles it, and no reasonable default exists. A choice with one is yours: decide it and record a `Decision:` line on the item.
3. **A dangerous operation**, meaning one that is destructive, irreversible, or behind a protected approval.

Stop through the flow's own blocked or needs-human exit. Name what is missing, what it blocks, and your recommendation. Keep doing the work that does not depend on it. Before you stop, re-read `AGENTS.md` (or `CLAUDE.md`) from disk, because a standing decision may answer it.

Errors, timeouts, failing tools, and running jobs are obstacles to diagnose and work through, not blockers. Commits, branch pushes, PRs, auto-merge, review replies, tracker updates, and build-ready tickets need no approval.

Detail: [reference/when-to-stop.md](../reference/when-to-stop.md).

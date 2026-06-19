# Observability Audit (load-bearing)

The **audit + file** arm of `lisa:monitor`. On top of its existing live-signal sweep, `monitor` audits how well the **current repo** is instrumented and files build-ready tickets for what it finds. `monitor` is **manual** (no cron) and **files only** — it never fixes; the `intake` / `tracker-build-intake` cron implements what it files.

## Invariants

- **Repo-scoped two ways.** Audit only the rubric dimensions in scope for the repo's detected profile (`frontend` / `backend` / `infra` — a frontend repo never evaluates backend tracing), and stamp every filed ticket `repo:<CURRENT_REPO>` as a single-repo leaf (resolve the repo via the `config-resolution` ladder; cannot resolve → report, do not file).
- **Two finding types → build-ready leaves.** A live signal over the conservative bar → a `Bug` leaf; an in-scope MISSING instrumentation dimension (gap, e.g. "no DB/query analytics") → a `Task`/`Improvement` leaf. Always via `lisa:tracker-write` with `build_ready: true` (never a vendor write skill directly); never an Epic/container (gate S15).
- **Conservative by default.** Only high-signal anomalies (over the documented thresholds) and `core` missing dimensions are filed. `--all-gaps` widens gap filing to `recommended` tiers; nothing lowers the anomaly bar.
- **Idempotent.** Every ticket carries a `<!-- lisa-monitor-finding: <fingerprint> -->` sentinel; search-before-create (including closed tickets) means a re-run never duplicates a live or just-resolved finding.
- **Capped.** At most `monitor.maxCandidates` tickets per run (default 20), highest-severity first; report filed-vs-dropped (and list the dropped) — never silently truncate.
- **Gate-passing.** Each ticket is a real authored artifact: three-audience description, Gherkin AC, single-repo, Target Backend Environment, and a Validation Journey with a unique kebab-case `[EVIDENCE: <name>]` marker — so `tracker-validate` (S1–S15) accepts it. A finding that cannot be made into a credible ticket is reported, not filed.
- **Verify guard.** When `monitor` is the post-deploy step of `lisa:verify` it runs **report-only** — Verify invokes it as `lisa:monitor <env> --report-only`, so it never files there. Filing is a standalone-only action.

Full reference (profile detection, the rubric table, anomaly thresholds, ticket templates, idempotency contract, the cap, dry-run/report-only semantics): [reference/observability-audit.md](../reference/observability-audit.md).

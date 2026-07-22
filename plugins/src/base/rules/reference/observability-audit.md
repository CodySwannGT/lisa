# Observability Audit (load-bearing)

This rule is the single source of truth for the **audit + file** arm of the `lisa-monitor` skill. The `monitor` skill collects live signals (errors, logs, performance, health) via the stack `ops-specialist` exactly as before; this rule adds two things on top, both **repo-scoped**:

1. **Audit** — score the repo against an observability-completeness rubric for its detected type, so a frontend repo is never dinged for missing backend tracing.
2. **File** — turn both *anomalies* (a real bad live signal) and *gaps* (an in-scope observability dimension that isn't wired) into **build-ready leaf tickets** so the existing `intake` / `tracker-build-intake` cron picks them up and fixes them. `monitor` files only; it never fixes.

`monitor` is **manual** — there is no cron for it. It is run by a human against a named environment.

## Scope discipline (why this is repo-scoped)

`monitor` runs **inside one repo** and audits/files **only for that repo**. Two mechanisms enforce it:

- **Type-scoped rubric.** Only the dimensions in-scope for the detected repo type are audited (table below). A frontend-only repo never evaluates X-Ray tracing or DB-query analytics; a backend repo never evaluates Web Vitals or session replay.
- **`repo:<name>` stamping.** Every filed ticket is a single-repo leaf stamped `repo:<CURRENT_REPO>` (per `repo-scope-split`). Resolve `CURRENT_REPO` with the standard ladder from `config-resolution` ("Current-repo resolution"): config `repo` → `github.repo` → `basename` of the git remote. If it cannot be resolved, **report and skip filing** rather than filing un-scoped tickets.

## Repo-type detection (stack-agnostic)

`monitor` is a base skill that ships to every project, so detection must not assume a stack plugin is present. Detect the repo's observability **profile** by reading manifests and key files — never by assuming. Classify into one or more of `frontend`, `backend`, `infra`. A repo may be more than one (a Rails or Next.js app is `frontend`+`backend` = "fullstack"); audit the union of the matched profiles' in-scope dimensions.

| Profile | Positive signals (any) |
|---|---|
| `frontend` | `package.json` deps incl. `expo`, `react-native`, `next`, `react`, `vue`, `@angular/core`, `svelte`, `vite`; an `app.json` / `app/` route dir / `public/index.html`; a web/mobile build script |
| `backend` | `package.json` deps incl. `@nestjs/core`, `express`, `fastify`, `koa`, `@apollo/server`; a `serverless.yml` / Lambda handlers; a `Gemfile` with `rails`; a `Procfile`; an API/server entrypoint |
| `infra` | `aws-cdk-lib` + `cdk.json`; Terraform `*.tf`; Pulumi; a `serverless.yml` with no application code; a deploy-only repo |

When the Lisa stack overlay is present its mapping is a strong prior (`expo`→frontend, `nestjs`→backend, `cdk`→infra, `rails`→frontend+backend, `typescript`→infer from the signals above), but always confirm against the actual files — the overlay is a hint, the files are truth.

## The observability-completeness rubric

Each dimension is **in scope** (`●`) or **out of scope** (`–`) per profile, and carries a **tier**: `core` (a blind spot here is a real operational risk → file when missing) or `recommended` (valuable but optional → file only when `--all-gaps` is passed; otherwise report as a WARN row, do not ticket).

| Dimension | Tier | FE | BE | Infra | Detect via (presence ⇒ wired) |
|---|---|:--:|:--:|:--:|---|
| Error monitoring | core | ● | ● | – | `@sentry/*`, `.sentryclirc`, Sentry DSN in `.env*`; Bugsnag/Rollbar deps |
| Structured logging | core | ● | ● | ● | `pino`/`winston`/`bunyan`; Rails `lograge`; CloudWatch log groups exist |
| Distributed tracing | core | – | ● | ● | `aws-xray-sdk*`, OpenTelemetry deps/gems; X-Ray traces present |
| Metrics & alarms | core | – | ● | ● | CloudWatch custom metrics + `describe-alarms` returns alarms; Datadog/Prometheus |
| Health checks | core | ● | ● | – | a `/health`/`/up` endpoint; NestJS Terminus; uptime check config |
| RUM / Web Vitals | recommended | ● | – | – | Sentry performance/browser tracing, `web-vitals`, Firebase Performance |
| Product analytics | recommended | ● | – | – | `posthog-js`/`posthog-node`, Firebase Analytics, Amplitude, Segment |
| Session replay / frustration | recommended | ● | – | – | Jam, PostHog session replay, LogRocket, Sentry replay |
| DB / query analytics | recommended | – | ● | ● | slow-query logging, RDS/Aurora Performance Insights, query-timing middleware |
| Synthetic / smoke UAT | recommended | ● | ● | – | Playwright/Cypress e2e, k6/Artillery load scripts, synthetic canaries |

**Detection is read-then-probe, never assume.** For each in-scope dimension: read `package.json` deps + scripts (and `Gemfile`, `serverless.yml`, `docker-compose.yml`, `config/initializers/*`, `.env*`, `.sentryclirc`, `cdk.json`), then — only when credentials/tooling are already available — probe the live source (`command -v sentry-cli`, `aws sts get-caller-identity` before any `aws` call). Mirror the `ops-specialist` "Project Discovery" table where the stack overlay exists. **Absence of every signal for an in-scope dimension is the gap finding.** A dimension that is present but unreachable this run (e.g. PostHog wired but no API key available) is reported `PRESENT (unverified)`, **not** a gap.

### Tools Lisa does not wire

PostHog, Jam, and Firebase have **no Lisa MCP**. Detect them statically (deps/config) and pull their data only where a first-party API + credentials are already present in the environment (e.g. the PostHog API with a project key). Never invent credentials, and never treat "Lisa has no MCP for it" as "the repo lacks it" — judge by the repo's own deps/config.

## Live-signal anomalies (conservative thresholds)

Collect live signals via the stack `ops-specialist` when present (Expo/Rails), else via inline base probing (Sentry CLI/REST, `aws logs`, `aws cloudwatch`, `aws xray`, the Playwright MCP for client-side console/network). An observation becomes a **fileable anomaly** only when it clears the conservative bar — high-signal only, to keep the Ready queue clean. Defaults below (the keys live under `monitor.thresholds.*` in `config-resolution`; per-run nothing overrides them — tune in config):

| Signal | Fileable when |
|---|---|
| Error event | Unresolved error/fatal signal **and** events in last 24h ≥ `monitor.thresholds.minEvents24h` (default 1). Skip resolved, ignored, muted, and below-floor noise. |
| Error-rate spike | error rate ≥ `errorRateSpikeMultiplier`× (default 2×) the prior-window baseline **and** above an absolute floor (not 1-of-2 requests). |
| Latency regression | p95 ≥ `p95LatencyMs` (default 1000ms) sustained, **or** p95 up ≥ 50% vs the prior window. |
| CloudWatch alarm | any alarm in `ALARM` state. |
| Fault rate | fault observations > `monitor.thresholds.faultRatePct` (default 5%) of observations in the window. |
| Client-side (Playwright) | repeated console `error` or a 5xx network response on a smoke flow. |

Everything below the bar is reported (so the human sees it) but **not** ticketed. `--all-gaps` does not lower anomaly thresholds — it only widens *gap* tiers.

## Two finding types → build-ready leaf tickets

Both finding types are filed through the vendor-neutral `lisa-tracker-write` shim with `build_ready: true` (never a vendor write skill directly — that is what keeps the destination switchable). Both are **leaf** work units (`Bug` for anomalies, `Task`/`Improvement` for gaps) — never an Epic or container (gate S15). Each must pass the `tracker-validate` gates S1–S15, so each ticket is a real authored artifact, not a template dump.

### Required fields (so the gates pass)

- **Three-audience description** (S3): coding-assistant (technical: stack trace / Sentry link / occurrence count / the missing dimension and how to wire it), developer (where it surfaces, suspected cause/affected files, the fix skill to reach for), stakeholder (user/SLO impact).
- **Gherkin acceptance criteria** (S4).
- **Single repo** (S10): stamped `repo:<CURRENT_REPO>`; scope the description to this repo only.
- **Target Backend Environment** (S8) + **Validation Journey** carrying at least one typed `[EVIDENCE: <artifact-type>: <name>]` marker (S11/S14) — both anomaly fixes and gap wiring are runtime changes, so both need an env and a journey that proves the fix. The bracketed typed form is what the validator scans for; a bare `EVIDENCE:` line or an untyped assertion label (`[EVIDENCE: alert-fixed]`) fails S14 — for observability work the natural types are `log-snippet` and `state-dump`. Prefer two markers (a success and an error/edge case).
- **Relationship search before write** (S13) — doubles as the dedup guard (next section).
- **No parent/Epic required.** These are build-ready standalone leaves; S7's parent requirement is waived for a `build_ready: true` leaf (the leaf carve-out in `leaf-only-lifecycle` / `tracker-validate`). Do not fabricate an Epic parent.
- A **priority** ordered by tier and severity: `core` gap / high-event anomaly → higher; `recommended` gap → lower.

### Anomaly ticket (type: Bug)

Title: `[observability] <signal summary> (<source>)` — e.g. `[observability] Unhandled TypeError in CheckoutScreen (Sentry)`. The coding-assistant section carries the Sentry/CloudWatch/X-Ray link, fingerprint, first/last seen, and occurrence count. AC: *Given* the repro context, *When* the action runs, *Then* the source reports zero new events for the fingerprint. The fix-skill hint points at `root-cause-analysis` / `reproduce-bug`.

### Gap ticket (type: Task or Improvement)

Title: `[observability-gap] Add <dimension> (<profile>)` — e.g. `[observability-gap] Add distributed tracing (backend)`. The description states which dimension is missing, **why the audit needed it** (the blind spot it leaves), and how to wire it — chaining the existing fix skills where they apply (`parity-sentry-sdk-setup` for error monitoring; the nestjs `typeorm-patterns` skill's `observability-patterns` reference for X-Ray/CloudWatch DB-query tracing; OTel→X-Ray for tracing). AC: *Given* the app runs in `<env>`, *When* the relevant signal occurs, *Then* the newly-wired dimension captures it (dashboard/endpoint/trace shows data).

## Idempotency (do not re-file the same finding)

A manual re-run next week must not duplicate last week's tickets. Mirror the `repair-intake` marker discipline:

1. **Stable fingerprint per finding.**
   - Anomaly: `sha1("<source>:<stable-signature>:<CURRENT_REPO>")` (12 hex chars). `stable-signature` is the Sentry issue short-id (or culprit), the CloudWatch alarm name, or `errorType@location` — something that survives between runs, **never** the human title or occurrence count.
   - Gap: the literal `gap:<dimension>:<CURRENT_REPO>` (a dimension is missing-or-not; no hash needed).
2. **Sentinel in the body.** Embed `<!-- lisa:monitor-finding: <fingerprint> -->` in every filed ticket.
3. **Search before create** (this IS gate S13). Before filing, search the tracker for the fingerprint string. The search **MUST include closed/resolved tickets** (`gh issue list --search <fp> --state all` for GitHub; JQL with no status filter for JIRA; all states for Linear) — otherwise a just-closed match is invisible and the backoff and decline checks below can't fire. If an **open** ticket carries the fingerprint → skip (optionally link). Otherwise classify a closed match by **how** it closed:
   - **Closed as _not planned_ — a permanent decline** (`rejection-detection` **Proposal rejection memory**). GitHub `stateReason == "not_planned"`; the config-resolved won't-do/canceled equivalent on JIRA/Linear (never a hardcoded lane string). This is a durable human "no", not a time-boxed guard: **suppress the finding regardless of age**, and re-file only with evidence that **postdates the decline**. The new ticket MUST carry BOTH the machine token (`declined <date>; recurred <date> in <ref>`) and the human acknowledgment sentence (`You declined this on <date>. It has recurred (<date>, <ref>), so we're raising it once more for your review.`). This layers *on top of* the backoff below — a not_planned close outlives any window.
   - **Closed as _completed_ within the recently-resolved backoff window** (`monitor.backoffHours`, default **24h** — matching the 24h Sentry event window; this is **not** the 2h `intake.repair.staleAfterHours`) → skip, to avoid re-filing a just-fixed regression before its signal has drained. A completed close **older** than the window is not a decline — a genuine recurrence is a regression and may file.

   Only file when no live match, no recently-resolved completed match, and no prior not_planned decline exists.

## The cap

File **at most `max_candidates` tickets per run** (default **20**; config `monitor.maxCandidates`; per-run `max_candidates=<n>` always wins). Rank candidates before applying the cap — `core` gaps and highest-occurrence anomalies first — so the cap drops the least-important findings, never the most. When the cap truncates, **list every dropped finding** in the report (title + fingerprint, not just a count) — silent truncation reads as "all clear" when it isn't, and a high-signal anomaly that fell just below the cap must still be visible to the human.

## Filing modes and the Verify guard

- **Default (standalone `monitor <env>`): files.** A plain manual run audits, reports, dedupes, and files up to the cap.
- **`--dry-run`:** does everything except call `tracker-write` — prints exactly which tickets *would* be filed (title, type, fingerprint, dedup verdict) so the human can preview.
- **`--report-only`:** produces the health/audit summary only — no filing and no would-file analysis. This is the mode Verify uses (below).
- **Invoked as `lisa-verify`'s post-deploy step: never files — enforced mechanically, not inferred.** `lisa-verify` step 6 invokes monitor as `lisa-monitor <env> --report-only`; monitor must never file when `--report-only` (or `--dry-run`) is set. This is load-bearing **today** — Verify already routes its remote verification through the `monitor` skill, so without the passed flag the new file-by-default behavior would create tickets during every verify run. As a belt-and-suspenders default, if monitor is invoked via the Skill tool from within a Verify flow and no filing flag was passed, treat it as `--report-only` rather than filing.

## Output

A single report: the health/anomaly summary (existing monitor behavior) + an audit table (each in-scope dimension with `OK` / `WARN` / `MISSING` / `PRESENT (unverified)`) + a filing summary (tickets filed with their refs and fingerprints, tickets skipped as duplicates, and the dropped count if the cap truncated). In `--dry-run`, the filing summary lists would-file tickets instead.

## Rules

- File only — never fix. The `intake` / `tracker-build-intake` cron implements what `monitor` files.
- Always through `tracker-write` with `build_ready: true`; never a vendor write skill directly.
- Conservative by default — high-signal anomalies and `core` missing dimensions only. `--all-gaps` widens gap tiers; nothing lowers the anomaly bar.
- Repo-scoped always — type-scoped rubric + `repo:<CURRENT_REPO>` single-repo leaves. Cannot resolve the repo → report, do not file.
- Idempotent always — fingerprint sentinel + search-before-create; a re-run never duplicates a live or just-resolved finding.
- Never file without a real, gate-passing description and Validation Journey. A finding that cannot be made into a credible ticket is reported, not filed.
- Read config with `jq` (local-overrides-global) per `config-resolution`; never hand-parse JSON. Never run an `aws`/`sentry-cli` probe without first confirming credentials.

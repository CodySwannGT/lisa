---
name: lisa-doctor
description: "Audit whether the current repository is ready to use Lisa. Runs grouped read-only checks across project detection, Lisa config, runtime distribution surfaces, tracker/source preflight access, automation prerequisites, optional GitHub Project coordination, and optional wiki delegation, then reports PASS/WARN/FAIL/SKIP results plus an overall readiness verdict (`READY`, `READY_WITH_WARNINGS`, or `NOT_READY`)."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Doctor: $ARGUMENTS

Run a read-only Lisa readiness audit for the current repository.

## Purpose

`/lisa:doctor` is the deterministic answer to "is this repo actually ready to use Lisa?" It audits
the repository in grouped sections, reports each check as `PASS`, `WARN`, `FAIL`, or `SKIP`, and
emits one overall verdict: `READY`, `READY_WITH_WARNINGS`, or `NOT_READY`.

The command is repository-scoped. It validates only what can be observed from the current repo,
current machine, and current runtime. It does **not** create automations, labels, tracker items, or
other external state as part of the default audit path.

## Inputs

- Optional flags in `$ARGUMENTS` that narrow or tune read-only validation.
- The current repository root and its Lisa config files (`.lisa.config.json`,
  `.lisa.config.local.json`) when present.

## Confirmation policy

Do **not** ask whether to proceed. Once invoked, run the read-only audit, print the grouped
results, emit the overall verdict, and stop.

Specifically forbidden:

- Previewing the number of checks and asking whether to continue.
- Offering "run a few checks first" or "dry-run vs real run" choices. This skill is already the
  read-only path.
- Performing setup mutations just because a failing check discovered something missing.

The only legitimate reasons to stop early are:

- The current working directory cannot be resolved to a repository/root the audit can inspect.
- The runtime blocks all required local reads needed to even classify the repo.

## Audit contract

Doctor reports grouped checks in a stable, human-readable structure. The grouped sections include,
as applicable to the current repo:

1. **Project detection and runtime basics** — detect the project root, package/runtime surface, and
   whether Lisa is installed where the repo expects it.
2. **Lisa config readiness** — read `.lisa.config.json` and `.lisa.config.local.json` using the
   same local-overrides-global semantics defined by `config-resolution`; report missing required
   keys, incompatible combinations, and committed-vs-local locality problems as findings rather
   than mutating config.
3. **Tracker/source preflight** — perform read-only readiness checks for the configured `tracker`
   and `source` only. If a required CLI, MCP surface, or auth context is unavailable in the current
   runtime, report that explicitly instead of pretending the repo is ready.
4. **Runtime distribution surfaces** — confirm the command, skill, hook, and related distribution
   surfaces relevant to this repo are present where Lisa expects them on the active runtime.
5. **Automation readiness** — inspect whether the configured queue source/tracker and scheduling
   prerequisites are observable, but do **not** create, edit, or delete automations during doctor.
6. **Optional GitHub Project coordination** — when `github.projects.v2` is configured, delegate
   the shared validation read to `github-project-v2` instead of reimplementing ad-hoc GraphQL
   checks. Honor the `required=false` vs `required=true` semantics documented by
   `config-resolution`: best-effort failures are `WARN`, required-mode failures are `FAIL`.
7. **Optional wiki delegation** — when a repo-local `wiki/` exists, either summarize the
   specialized `lisa-wiki-doctor` verdict or explicitly report that deeper wiki checks are
   available there. The base doctor stays narrower than full wiki migration enforcement.
8. **Optional Kane browser provider** — when `verification.browser.kane.enabled` is true, run the
   Lisa-owned readiness probe. Require explicit cloud-upload approval, the contract-tested exact
   version, a non-production environment allow-list, local Chrome/Chromium, Test Manager
   project/folder targeting, `whoami` authentication, and nonzero/observable credit readiness.
   Report missing executable/browser, auth failure, wrong target, zero credits, and control-plane
   failure separately. If Kane is not enabled, report an informational `OK`/not enabled rather than
   probing or installing it.

If a check family is not applicable to the current repo, report `SKIP` with the reason.

### Minimum config-readiness checks

The Lisa config group is not just "does a file exist?" Doctor must audit the config contract in
this order:

1. **Presence + parseability**
   - `FAIL` when `.lisa.config.json` is missing, empty, or invalid JSON.
   - Read `.lisa.config.local.json` only when present; if present but invalid JSON, `FAIL`.
2. **Merged effective config**
   - Resolve every key with the same per-key local-overrides-global semantics documented by
     `config-resolution`. Doctor must describe findings against the effective merged value, not by
     pretending one file fully replaces the other.
3. **Required top-level dispatch keys**
   - `FAIL` when merged `tracker` is missing or is not one of `jira`, `github`, or `linear`.
   - `FAIL` when merged `source` is present but is not one of `notion`, `confluence`, `linear`,
     `github`, or `jira`.
4. **Vendor required-key audit**
   - `FAIL` when the configured tracker/source points at a vendor whose required keys are absent
     after merge. Examples: `tracker=github` requires `github.org` + `github.repo`;
     `tracker=jira` requires `atlassian.cloudId` + `jira.project`; `source=notion` requires
     `notion.workspaceId` + `notion.prdDatabaseId`.
   - Reuse the `config-resolution` vendor tables rather than inventing a second required-key list.
5. **Local-vs-committed locality audit**
   - `WARN` when developer-specific fields appear in committed config. At minimum enforce the
     documented local-only examples: `atlassian.email`, `intake.assignee`, and
     `jira.verified_workflow_hash`.
   - `WARN` when project-wide shared fields exist only in `.lisa.config.local.json` and are absent
     from `.lisa.config.json`, because the current machine may work while the repository remains
     under-configured for teammates and automations. Examples include `tracker`, `source`,
     `github.org`, `github.repo`, `atlassian.cloudId`, `atlassian.site`, `jira.project`,
     `linear.workspace`, `linear.teamKey`, and `deploy.branches`.

6. **Deploy env-order audit** (only when `deploy.branches` is present)
   - `PASS` (or skip) when `deploy.branches` defines a single environment — `deploy.order` is
     optional and the back-sync chain is empty.
   - `PASS` (or skip) when `deploy.branches` defines multiple environments that all map to the
     **same** branch (e.g. `dev`/`staging`/`production` all → `main`). The branches resolve to a
     single distinct branch, so there is nothing to back-sync, the chain is the empty no-op, and
     `deploy.order` is not required. Do not WARN.
   - `WARN` when `deploy.branches` resolves to **more than one distinct** branch but `deploy.order`
     is absent. Config-driven back-sync (`reusable-claude-sync-down-branches.yml`) cannot derive a
     source→target chain without the env ranking; the repo must either add `deploy.order`
     (low→high, e.g. `["dev","staging","production"]`) or pass an explicit `chain` in its
     `claude-sync-down-branches.yml` wrapper. WARN not FAIL because the explicit-chain override is
     a valid configuration.
   - `FAIL` when `deploy.order` is present but its env-name set does not exactly match the keys of
     `deploy.branches` (every env in one must appear in the other). A mismatch silently breaks the
     derived chain.
   - Reuse the `deploy.order` / `deploy.branches` contract from `config-resolution` ("Env order
     (sync-down chain)") rather than re-deriving the rules here.

Locality findings are advisory unless the merged config is unusable. Missing shared keys after the
merge are `FAIL`; shared keys that exist only locally are `WARN`.

### Minimum tracker/source preflight checks

After config readiness passes far enough to resolve the merged `tracker` and optional `source`,
doctor must perform read-only preflight checks for the configured vendors only. It does not probe
every vendor Lisa supports.

1. **Scope the audit to configured vendors**
   - Audit the merged `tracker`.
   - Audit the merged `source` only when present and distinct from the tracker.
   - Report every non-configured vendor as `SKIP` rather than pretending it was checked.
2. **Prove a readable substrate exists**
   - `tracker=github` or `source=github`: require `gh` CLI availability, a passing `gh auth status`,
     and a read probe against the configured repo such as `gh repo view <org>/<repo>`.
   - `tracker=jira`, `source=jira`, or `source=confluence`: follow the `atlassian-access`
     substrate ladder and prove at least one read-capable path can see the configured
     `atlassian.cloudId` and vendor scope. Acceptable substrates are `acli`, Atlassian MCP, or the
     validated API-token/curl path documented by `config-resolution`.
   - `tracker=linear` or `source=linear`: require either readable Linear MCP access or a valid
     personal API-key probe against the configured workspace. When Linear is the tracker, doctor
     must also prove the configured `linear.teamKey` is visible.
   - `source=notion`: require either a Notion MCP identity match for `notion.workspaceId` or a
     valid internal-integration token probe, plus read visibility to `notion.prdDatabaseId`.
3. **Separate missing tooling from missing auth or scope**
   - Missing executable / MCP substrate availability is a distinct observed fact, not the same as
     "auth failed."
   - When a probe runs and fails, preserve the exact read-only failure text or HTTP/GraphQL status
     in the observed output so the operator can distinguish wrong workspace/site/repo from missing
     credentials.
4. **Severity ladder**
   - `PASS` when at least one supported read-only substrate proves the configured vendor is
     reachable with the required scope.
   - `WARN` when the configured vendor is reachable, but an additional optional substrate is
     unavailable and later Lisa flows would need to fall back.
   - `FAIL` when no supported substrate can prove read access for the configured tracker/source, or
     when the configured vendor target is unreadable from the current runtime.

### Minimum GitHub Project coordination checks

When `github.projects.v2` is configured, doctor must run one additional read-only coordination
check instead of treating the config block as implicitly ready.

1. **Delegate through the shared chokepoint**
   - Call `lisa-github-project-v2` in read-only resolution mode:

     ```text
     operation: resolve-project
     ```

   - Do not inline ad-hoc Project GraphQL in doctor. Setup, doctor, writers, and linked-PR flows
     must all read the same owner/access contract from the shared utility.
2. **Preserve exact namespace + access failures**
   - Enforce the v1 namespace rule exactly as documented by the shared utility. If
     `github.projects.v2.owner.slug` does not match `github.org`, report:

     ```yaml
     code: project_namespace_mismatch
     message: "github.projects.v2.owner.slug must match github.org in v1"
     remediation: "Use a Project owned by <github.org> or remove github.projects.v2."
     ```

   - For owner-access or GraphQL failures, preserve the exact GitHub / GraphQL failure text in the
     observed output. Examples include missing Project, `Resource not accessible by integration`,
     unsupported owner kind, or a wrong owner/number pair.
3. **Report exact remediation paths**
   - Doctor must make the next operator action explicit. At minimum, say whether they need to:
     1. choose a Project owned by the tracked repo namespace,
     2. grant the token Project read/write access,
     3. correct the configured Project number/owner, or
     4. remove `github.projects.v2` when coordination is not required.
4. **Map shared utility outcomes into doctor severity**
   - `required: false` => doctor `WARN`. Repository-local GitHub issue/PR flows remain usable while
     Project coordination is degraded.
   - `required: true` => doctor `FAIL`. The same Project validation failure blocks Lisa readiness
     because coordination was configured as required.

Good output examples:

```text
WARN github.projects.v2: Resource not accessible by integration
Observed: exact GitHub / GraphQL failure text preserved from resolve-project.
Remediation: grant the token Project read/write access or remove github.projects.v2.required.
Repository-local GitHub issue/PR flows remain usable; Project coordination is disabled.
```

```text
FAIL github.projects.v2: github.projects.v2.owner.slug must match github.org in v1
Remediation: use a Project owned by CodySwannGT or remove github.projects.v2.
```

### Minimum automation-readiness checks

Doctor's automation-readiness group stays read-only: it audits whether this repo and runtime could
support `/lisa:setup-automations` and the resulting recurring jobs, but it does **not** create,
edit, delete, or reconcile automations on the default doctor path.

1. **Resolve the queue inputs exactly as setup-automations would**
   - Resolve the PRD queue from merged `source`.
   - Resolve the build queue from merged `tracker`.
   - Resolve the repair queue from the same queue-detection rules as `lisa-repair-intake`
     (identical source-dispatch contract to `lisa-intake`).
   - If any automation would require guessing because `source`, `tracker`, or their vendor keys are
     still unresolved after the config-readiness audit, report that automation as `FAIL` rather
     than pretending scheduling can proceed safely.
2. **Audit the current runtime's native scheduler surface without mutating it**
   - Codex: doctor should report whether the runtime exposes the native automations surface
     (`automation_update`) needed by `/lisa:setup-automations`.
   - Claude: doctor should report whether the runtime exposes `/schedule`.
   - Other runtimes: doctor should explicitly say that no native Lisa scheduler is known for the
     current runtime.
   - This is observability only. Never create a placeholder automation just to prove the scheduler
     works.
3. **Check exploratory-automation support by shipped stack surface**
   - `exploratory-bugs` is supported only when the project ships an `exploratory-qa` command
     surface (the `expo`, `rails`, or `harper-fabric` stacks today). Reuse the same stack/support
     rule documented by `setup-automations`; do not invent exploratory jobs for stacks that do not
     ship that command.
   - When the repo does not ship `exploratory-qa`, report `exploratory-bugs` as `SKIP` with the
     reason.
   - `exploratory-prds` remains applicable when the repo can run `/lisa:project-ideation`; if its
     queue/config prerequisites are unresolved, report the exact blocking config fact.
4. **Severity ladder**
   - `PASS` when an automation's queue inputs are resolvable and the runtime exposes the required
     native scheduler surface for that automation.
   - `WARN` when Lisa remains usable manually, but the current runtime has no native scheduler
     surface for unattended runs, so automation setup would be unavailable from here.
   - `SKIP` when an optional automation is intentionally unsupported for this repo surface (for
     example, `exploratory-bugs` on a stack with no `exploratory-qa` command).
   - `FAIL` when the repo's config cannot resolve the queue that an automation needs, because that
     would make unattended runs ambiguous or broken before scheduling even starts.

### Minimum wiki-delegation checks

When a repo-local `wiki/` directory exists, doctor must surface the specialized wiki-readiness path
without turning the base doctor into a second `lisa-wiki-doctor`.

1. **Detect whether wiki delegation applies**
   - If no repo-local `wiki/` directory exists, report the entire wiki group as `SKIP` with the
     reason that no wiki surface is present in this repository.
   - If `wiki/` exists, keep the group present in the final report; do not silently omit it.
2. **Prefer summary of an existing specialized verdict**
   - If the repo already has a readable `wiki/state/migration/doctor-report.json`, doctor may
     summarize the specialized verdict (`READY`, `READY_WITH_WARNINGS`, or `NOT_READY`) plus the
     most relevant blocking/warning facts, clearly attributing them to `lisa-wiki-doctor`.
   - Preserve the base doctor's narrower scope: summarize or quote the specialized verdict, but do
     not inline the full migration/readiness checklist into the base doctor output.
3. **Otherwise advertise the deeper follow-up explicitly**
   - If `wiki/` exists but no specialized report is available yet, doctor must still tell the
     operator that deeper wiki checks live behind `lisa-wiki-doctor`.
   - The report should make the next action explicit, for example:

     ```text
     WARN wiki-follow-up: wiki/ detected; deeper wiki migration checks not yet summarized
     Observed: wiki/ exists, but no wiki/state/migration/doctor-report.json was found.
     Remediation: run lisa-wiki-doctor to produce the wiki-specific readiness verdict.
     ```
4. **Severity ladder**
   - `SKIP` when `wiki/` is absent.
   - `PASS` when `wiki/` exists and doctor successfully summarizes an existing
     `lisa-wiki-doctor` verdict.
   - `WARN` when `wiki/` exists and doctor can only advertise the specialized follow-up because no
     persisted wiki verdict is available yet.
   - `FAIL` only when `wiki/` exists but the repo cannot surface the specialized follow-up at all
     (for example, the required `lisa-wiki-doctor` distribution surface is missing or the existing
     report is unreadable/malformed enough that doctor cannot safely summarize it).
5. **Keep wiki readiness optional for non-wiki repos**
   - Never require a wiki plugin surface when `wiki/` is absent.
   - Never let wiki-specific checks downgrade unrelated non-wiki repositories.

### Minimum repository-readiness checks

The eight groups above answer one question: **is Lisa installed correctly here?** There is a second,
orthogonal question — **may an agent fleet operate here unattended?** — and conflating them is how a
brownfield onboarding ends in "we built a wiki, looks good" instead of a verdict someone can act on.
`Repository readiness` is that second question, and it is opt-in behind the `--readiness` flag; the
default doctor path never renders it and stays byte-identical.

1. **Render one separately-titled group.** When readiness mode is requested, append a single
   `Repository readiness` group (id `repository-readiness`) in a fixed position after the eight
   installation groups, using the shared `createRepositoryReadinessDoctorGroup` helper from
   `scripts/doctor-report.mjs`. It is distinct from the installation groups so a reader is never left
   guessing which question a verdict answered.
2. **Score exactly the eight ownership dimensions from `readiness-rubric`.** Report **eight** checks,
   in fixed order, **never fewer** and never silently omit one: `context-routing`,
   `capabilities-tools`, `domain-ownership`, `execution-proof`, `feedback-guardrails`,
   `dependencies-supply-chain`, `delivery-authority`, `proportionality`. Cite the `readiness-rubric`
   slug for the dimension definitions, the seven ship blockers, and the consequence-ordering
   contract; do not restate or fork that vocabulary here.
3. **`SKIP` carries a reason and is never blank.** A dimension with no applicable evidence renders
   `SKIP` with a stated reason ("no deployment target configured, so delivery/authority was not
   assessed"). An unassessed dimension is a known unknown, and the report says so.

   **This surface reflects the CLI; it does not re-score.** The evidence producers and the blocker
   engine live in the Lisa CLI, which is the single source of truth. When `.lisa/readiness.json` is
   present and readable (parses, matching `schema_version`, carries a `dimensions` array), this group
   **projects** each recorded dimension's status and its operator-facing evidence/reason text, so an
   operator running `/lisa:doctor` through any coding agent sees the same readiness answer the CLI
   gives. When the report is absent, unparseable, or stamped with an unknown `schema_version` — or
   records nothing for a given dimension — that dimension falls back to `SKIP` with the reason it was
   not assessed. Absence means the readiness pass has not run, never that the repository is clean: a
   pass or a fail is never manufactured from a missing report. Run
   `lisa doctor --offline --readiness` to produce the report first.

   **A standing blocker outranks the recorded status.** Some CLI producers record `WARN` while
   standing a ship blocker — the blocker engine never reads the per-dimension status, so the finding
   flips the repository to `NOT_READY` exactly as a `FAIL` would. A dimension that owns an entry in
   the report's `blockers[]` therefore projects as `FAIL` regardless of its recorded label, and its
   remediation names the blocker ids and repeats the report's `narrowed_claim` (the "IS ready for
   supervised, single-ticket agent work" fallback `readiness-rubric` requires whenever a blocker
   stands). Projected checks also carry the report's `generated_at`/`lisa_version` so a stale report
   cannot read as current truth, and unassessed dimensions carry the CLI's not-established caveat.
4. **Reuse the shipped verdict ladder and consequence ordering.** No new verdict value and no new
   severity: reuse `READY` / `READY_WITH_WARNINGS` / `NOT_READY`. `READY` requires *positive*
   evidence — every readiness dimension assessed and clean, with no blocker standing. An unassessed
   (`SKIP`) dimension is silence, not health, so any readiness report carrying one tops out at
   `READY_WITH_WARNINGS`; only a standing ship blocker yields `NOT_READY`. Section order stays
   stable; the findings **within** each dimension check order highest-consequence-first.
5. **Persist to a versioned, relocatable artifact.** Writing the report to `.lisa/readiness.json`
   (`schema_version: 1`, with `verdict`, `blocker_count`, and per-dimension findings) is resolved
   through a single resolver so the location is one line to change. The write is atomic and must
   never fail the run: a write error degrades to a `WARN` check rather than throwing.
6. **Warn-only, always.** This gates a claim, not a process: readiness never hard-blocks and never
   changes doctor's exit-code semantics (exit 1 iff some check is `FAIL`). Where a surface named here
   is not installed, degrade — state what was assessed, state what was not, and continue.

### Upstream Lisa change-history diagnosis

A failing or warning check has two possible causes: the project drifted, or **Lisa itself changed
upstream** since this project last updated. Doctor must distinguish them instead of blaming the
project by default. Whenever findings need explanation — and always before proposing repairs —
attribute the finding with real evidence.

The attribution procedure itself is shared: it lives in the `lisa-attribute-failure` skill
(extracted from this section so any failure event can be attributed, not only doctor findings).
Doctor invokes it per finding:

1. **Resolve the version window.** Determine the project's installed Lisa version (the
   `@codyswann/lisa` entry in `package.json`/lockfile, or the plugin version stamp on the active
   runtime) and the latest published version (`npm view @codyswann/lisa version`, or the update
   check's cached result).
2. **Invoke `lisa-attribute-failure`** with the finding as the failure event: the defect
   description, the implicated template/config paths, the rule/skill/hook in play, and the
   resolved version window. The skill evaluates its three ordered signals — Lisa-managed surface
   ownership, shipped rule/skill/hook behavior, and the upstream change-history window (the
   version-window compare procedure formerly documented inline here, preserved verbatim in that
   skill: pagination/`--slurp` handling, targeted per-SHA diff context, truncation caveats, and
   the bounded explicit-tag fetch fallback) — and returns `lisa` | `project` | `ambiguous` plus
   the cited evidence.
3. **Map the verdict into the finding.**
   - `lisa` — Lisa changed the contract (a tightened lint rule, a renamed check context, a new
     required config key) or shipped the defective surface. Say so in `Observed:` with the cited
     evidence (commit subject/version or managed-surface proof), and let `Remediation:` point at
     the sanctioned adoption path (e.g. `lisa update` + re-apply, a documented config opt-out)
     rather than hand-editing managed files.
   - `project` — history shows no relevant upstream change and the surface is project-owned: the
     project drifted, so remediate on the project side.
   - `ambiguous` — history was unavailable, truncated, or otherwise inconclusive: report the gap
     as a `WARN`-level observability note with the evidence gap named — never fail the audit
     because history was unavailable or incomplete, and never attribute drift with unverified
     confidence.

This diagnosis remains part of doctor's read-only contract: the attribution skill reads Lisa's
repository, never writes to it, and repair suggestions stay suggestions.

## Output contract

The final report must:

- Separate observed facts from remediation advice.
- Print every check with one of `PASS`, `WARN`, `FAIL`, or `SKIP`.
- Emit exactly one overall verdict: `READY`, `READY_WITH_WARNINGS`, or `NOT_READY`.
- Stay read-only by default.

Render the report in grouped sections using the shared `scripts/doctor-report.mjs` contract:

- Start with `Overall verdict: <VERDICT>` and one `Counts:` line covering `PASS`, `WARN`, `FAIL`,
  and `SKIP`.
- Then print each group as `<group-id>. <group-title>`.
- Under each group, print one line per check as `- <STATUS> <check-id>: <summary>`.
- When available, print `Observed:` and `Remediation:` lines beneath the check so the report keeps
  facts separate from advice.
- If a group has no applicable checks yet, render it as a grouped `SKIP` with the reason instead of
  silently omitting the section.

The verdict ladder is:

- `READY` — no `FAIL` and no `WARN`.
- `READY_WITH_WARNINGS` — no `FAIL`, but one or more `WARN`.
- `NOT_READY` — one or more `FAIL`.

## Delegation and reuse

- Reuse `config-resolution` for config and lifecycle role defaults instead of inventing a second
  schema.
- Reuse the existing `github-project-v2` chokepoint for GitHub Project coordination checks instead
  of inlining bespoke access logic.
- Reuse ideas from `lisa-wiki-doctor` for grouped verdict rendering where they fit, while keeping
  the Lisa-wide doctor narrower than the wiki-specific migration/readiness workflow.

## Rules

- Never mutate repository, tracker, or automation state on the default doctor path.
- Never hardcode tracker/source label names outside the documented defaults plus configured
  overrides from `config-resolution`.
- Never silently treat an unavailable check surface as success; report `WARN`, `FAIL`, or `SKIP`
  with the explicit missing dependency.
- Never turn wiki-specific checks into a requirement for non-wiki repos.

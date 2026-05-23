# Unifying the LLM Wiki: a distributable Claude + Codex plugin (`lisa-wiki`)

> Status: agreed plan, ready for implementation.
> Authors: Claude (Opus 4.7) and Codex (gpt-5.5), converged over multiple review rounds.
> Scope: replace five hand-rolled "LLM Wiki" implementations with one kernel shipped via Lisa.

---

## 1. Goal & non-goals

### Goal
Replace the five separately-maintained LLM Wiki implementations
(`lisa`, `geminisportsai`, `gunnertech`, `propswap`, `publishing`) with **one
distributable implementation** packaged as **both a Claude Code plugin and a Codex
plugin**, shipped through the existing **Lisa** plugin pipeline. It must be:

- **Config-driven** — every project differs (mode, connectors, tenants, categories).
- **Extensible** — projects add bespoke ingest paths, categories, templates, and
  domain-expert role subagents without forking the kernel (via the `/add-ingest` and
  `/add-role` scaffolders, §13).
- **The documentation home** — the wiki absorbs and replaces the project's scattered docs
  (`docs/`, `specs/`, README deep content); going forward, documentation lives in the wiki (§15).
- **Integrity-first** — provenance, ordered state, consistent index/log, citations,
  sensitivity, and safe Git behavior are the product, not an afterthought.

### Non-goals
- Not a hosted app, web UI, SQLite/FTS index, or MCP server à la `lucasastorian/llmwiki`
  or `nex-crm/wuphf`. This lineage is **markdown + git + LLM skills**, and stays that way.
- Not a generic third-party "connector SDK/marketplace." Connectors are an explicit,
  config-registered authoring convention, not an executable plugin runtime (see §7).
- Not a one-shot mass rewrite of existing wikis. Migration is phased and compatibility-first (§15).
- Not a replacement for project-owned auth/MCP/secrets. The plugin assists; projects own
  credentials (§9, §11).
- Not an agent runtime or orchestrator. The plugin *scaffolds* domain-expert role subagents
  (the "digital staff", §10/§13); whether they are ever invoked, scheduled, or routed (cron,
  Telegram, agent teams) is out of scope and left to the project's runtime layer.

---

## 2. Background: Karpathy lineage + the five implementations

**Karpathy's "LLM Wiki"** (the gist): three layers — **raw sources** (immutable),
**the wiki** (LLM-owned markdown synthesis), **the schema** (a `CLAUDE.md`-style contract
defining structure/conventions/workflows) — with three operations: **ingest**, **query**,
**lint**, plus `index.md` (navigation) and an append-only `log.md`. Reference impls
`lucasastorian/llmwiki` and `nex-crm/wuphf` add heavy app/runtime layers we deliberately omit.

Our five repos are the lightweight markdown lineage. They share a strong common core but have
drifted in format and packaging. The full per-dimension comparison is the **Compatibility
Matrix** in §14. The essential shared invariants:

- Git-native markdown KB rooted at `wiki/`.
- Karpathy's three layers, with synthesis organized as **category directories**.
- `wiki/index.md` (navigation) + `wiki/log.md` (append-only ledger).
- `wiki/sources/` provenance with a **source-notes-before-synthesis** rule.
- LLM-skill-driven ingestion; code kept minimal.
- Pre-commit verification: `git diff --check`, secret scan, cross-tenant contamination scan.
- "Do not invent facts; weak evidence → open-questions."
- Strict ordering: source-note → synthesis → index → log → verify → state → commit/PR.

Four of the five (all but publishing) also keep a `wiki/schema/llm-wiki-contract.md`, a
`start-here.md`, JSON `wiki/state/` cursors, and a commit→PR→auto-merge step per ingestion.
Runtime packaging differs: lisa, geminisportsai, and propswap ship both `.claude/skills` and
`.agents/skills` trees; gunnertech is `.agents`-only; publishing is `.claude`-only.

---

## 3. Architecture: the Wiki Kernel

The center of gravity is **wiki integrity**, not connectors. The kernel is five layers:

1. **Markdown core** — the durable `wiki/` knowledge base (sources, synthesis categories,
   `index.md`, `log.md`). The only durable source of truth.
2. **Repo-local schema snapshot** — `wiki/schema/llm-wiki-contract.md` is *rendered* into the
   repo from canonical plugin templates + the project's config, so the wiki stays fully
   readable and maintainable from GitHub, a bare clone, or by an agent without the plugin.
3. **Deterministic validators** — Node/Python scripts (`validate-config`, `lint-wiki`,
   `render-contract`, state/diff helpers) that enforce integrity mechanically. Fast, CI-able,
   not dependent on LLM judgment.
4. **Runtime adapters** — the same workflow content surfaced as: Claude skills + thin Claude
   slash-command facades using the canonical verbs (`/ingest`, `/query`, `/lint`, `/setup`,
   `/migrate`, `/add-ingest`, `/add-role`, `/onboard-me`, `/doctor`); Codex skills (no Claude-style
   command files — see §10). Skills are canonical.
5. **Connector packs + project extensions** — explicitly enabled ingestion recipes that produce
   sanitized source notes + run metadata; synthesis is always performed by the shared kernel
   skill, never by a connector. Project-specific ingest paths and domain-expert role subagents
   are *generated* (not hand-forked) by `/add-ingest` and `/add-role` (§7, §10, §13).

Design rule: **deterministic where it can be, LLM where it must be.** Validation, rendering,
diff/touched-file checks, secret/tenant scans, Slack/doc extraction → scripts. Setup
orchestration, ingest routing, synthesis, query, migration → skills.

---

## 4. Repository layout

### Plugin source (in the Lisa monorepo)
```
plugins/src/wiki/
  .claude-plugin/plugin.json        # Claude manifest (hooks, metadata); .codex-plugin generated at build
  skills/
    lisa-wiki-setup/                  # scaffold/repair/verify/upgrade FROM config; render contract; --with-ci
    lisa-wiki-ingest/                 # router: dispatch to enabled connector, run the ordered pipeline
    lisa-wiki-query/                  # read → synthesize → answer w/ citations (writeback opt-in)
    lisa-wiki-lint/                   # health check (orphans, contradictions, stale, missing links, gaps)
    lisa-wiki-usage/                  # how to browse/query/contribute
    lisa-wiki-migrate/                # phased migration of an existing custom impl (§15)
    lisa-wiki-add-ingest/             # scaffold a project front-door ingest skill that chains to /ingest
    lisa-wiki-add-role/               # scaffold a domain-expert role subagent (dual-runtime) over the wiki
    lisa-wiki-onboard-me/             # interview the user, capture (project-scoped), then guided tour + sample queries
    lisa-wiki-doctor/                 # post-migration verification checklist → doctor-report.json (§16)
    lisa-wiki-connector-git/          # self + other projects' git history + GitHub PR history (universal)
    lisa-wiki-connector-memory/       # the agent's PROJECT-scoped memory only (universal; Claude + Codex — see §7)
    lisa-wiki-connector-roles/        # the wiki's own staff roster (universal; ingests wiki/staff/*)
    lisa-wiki-connector-jira/
    lisa-wiki-connector-confluence/
    lisa-wiki-connector-notion/
    lisa-wiki-connector-slack/        # centralized (byte-identical script today in gemini+propswap)
    lisa-wiki-connector-web/          # URL/WebFetch
    lisa-wiki-connector-docs/         # PDF/DOCX → markdown
  commands/                         # Claude-only thin facades → canonical bare verbs (top-level files)
    ingest.md  query.md  lint.md  setup.md  migrate.md  add-ingest.md  add-role.md  onboard-me.md  doctor.md
  scripts/
    validate-config.mjs  lint-wiki.mjs  render-contract.mjs  diff-guard.mjs
    absorb-docs.mjs  rewrite-refs.mjs        # docs absorption + deterministic reference rewriting (§15)
    verify-migration.mjs                     # deterministic post-migration checks → doctor-report.json (§16)
    slack_oauth_user.py  ingest_slack_channel.py
    pdf-to-markdown.*  docx-to-markdown.*
  schema/
    lisa-wiki-config.schema.json  state.schema.json  page-frontmatter.schema.json
    wiki-structure.schema.json    # canonical folder-structure manifest — shared by validate-config/lint/render-contract
  templates/
    llm-wiki-contract.md  index.md  log.md  start-here.md  state-readme.md
    page-types/{concept,entity,decision,architecture,requirement,playbook,open-question,project,staff}.md
    agents/role-agent.claude.md  agents/role-agent.codex.toml  # per-role subagent templates (Claude .md / Codex .toml)
  ci/
    lisa-wiki-validate.yml            # optional GitHub Action template (§12)
```
Contrib + overlay connectors (LACRM, QuickBooks, Handwrytten, prospect-research,
publishing content-paths) ship as documented packs/overlays, not core (see §7).

### Per-project repo shape (what actually lives in each consumer repo)
```
wiki/
  lisa-wiki.config.json               # the project's only behavioral config
  schema/llm-wiki-contract.md       # RENDERED snapshot (kernelVersion stamped)
  schema/templates/                 # OPTIONAL project-specific page templates
  index.md  log.md  start-here.md
  sources/  state/                  # provenance + cursors
  documentation/                    # the project's ABSORBED docs (the wiki is the docs home — §15)
  staff/                            # OPTIONAL role doc pages (one per digital employee)
  <category dirs>/                  # concepts, entities, ... (+ project-specific)
README.md                           # readme.mode: "rich" (default) | "stub" | "preserve" (§15)
AGENTS.md / CLAUDE.md               # thin pointers to the contract + plugin
.mcp.json / .codex/config.toml      # only when connectors need MCP (project-owned auth)
.claude/agents/<role>.md            # GENERATED role subagents (Claude) — by setup / /add-role
.codex/agents/<role>.toml           # GENERATED role subagents (Codex) — by setup / /add-role
.claude|.agents/skills/lisa-wiki-local-*  # GENERATED front-door ingest skills (by /add-ingest)
# NO parallel docs/ tree — docs are absorbed into wiki/documentation/. Keep-in-place files stay at
# conventional paths: LICENSE*, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, CHANGELOG.md,
# NOTICE*, SUPPORT.md, GOVERNANCE.md, .github/**, and any registry/docs-hosting config.
```
Codex explicitly noted (and Claude accepts): the config is **not** the only project-specific
artifact — pointers, MCP config, ignored inboxes/clones, tenant app manifests, and local
secrets are normal. The correct claim is: **only project-specific wiki *behavior* lives in
config + optional overlays; no copied machinery.**

---

## 5. Configuration: `wiki/lisa-wiki.config.json` + JSON Schemas

Single project-local config, validated by `schema/lisa-wiki-config.schema.json`. JSON (not TOML/
YAML) because Lisa and every state cursor are already JSON, and JSON Schema gives deterministic
validation. TOML is used only where Codex itself requires it (`.codex/config.toml`).

Annotated example (wrapper-mode, multi-connector):
```jsonc
{
  "schemaVersion": "1.0.0",
  "org": "Gemini Sports",
  "displayName": "Gemini Sports LLM Wiki",
  "purpose": "The durable brain + documentation home for Gemini Sports' platform and product knowledge.",  // asked by /setup; rendered into contract + start-here; feeds /onboard-me
  "mode": "wrapper",                       // embedded | wrapper | standalone | subdir
  "wikiRoot": "wiki",
  "frontmatter": true,                      // forced on new/touched pages; legacy tolerated
  "categories": ["concepts","entities","decisions","architecture",
                 "requirements","playbooks","open-questions","projects"],
  "sources": { "layout": "by-system" },     // by-system | by-category (+ "buckets":[...])
  "git": { "prPerIngestion": true, "autoMerge": true, "targetBranch": "main",
           "branchPrefix": "wiki/" },
  "sensitivity": { "enabled": true, "default": "internal" },
  "sourceRetention": "sanitized-note-only", // raw-ok | sanitized-note-only | metadata-only | external-pointer-only
  "readme": { "mode": "rich" },             // rich | stub | preserve — ASKED by /setup & /migrate (default rich); records the choice (§15)
  "documentation": {                        // the wiki as documentation home (§15)
    "absorb": true,                         // move the host repo's own docs into wiki/documentation/ and ingest them
    "keepInPlace": ["LICENSE*","SECURITY.md","CODE_OF_CONDUCT.md","CONTRIBUTING.md","CHANGELOG.md",
                    "NOTICE*","SUPPORT.md","GOVERNANCE.md",".github/**"]
  },
  "onboarding": { "allowAudienceNote": false },  // /onboard-me writes a sanitized non-PII wiki note only if true
  // bare `/ingest` runs every enabled non-external-write connector below in order; external-write requires explicit intent
  "connectors": {
    "git":        { "enabled": true, "sideEffects": "read-only-ingest", "registry": "wiki/projects/registry.md" },  // self + other projects + PR history (universal)
    "memory":     { "enabled": true, "sideEffects": "read-only-ingest" },        // project-scoped memory ONLY; never global/unrelated (§7/§9)
    "roles":      { "enabled": true, "sideEffects": "read-only-ingest" },        // universal; ingests the wiki's own staff roster
    "jira":       { "enabled": true, "sideEffects": "read-only-ingest",
                    "tenantGuard": { "site": "https://geminisportsanalytics.atlassian.net",
                                     "cloudId": "b1040f2e-..." }, "projects": ["SE","GD","DST"] },
    "notion":     { "enabled": true, "sideEffects": "read-only-ingest",
                    "tenantGuard": { "teamspace": "Gemini Sports Analytics",
                                     "teamspaceId": "2ccd92fe-..." } },
    "slack":      { "enabled": true, "sideEffects": "external-write" },  // OAuth/browser/token file
    "confluence": { "enabled": false, "sideEffects": "read-only-ingest" }
  },
  "customConnectors": [                      // explicit allowlist; NO auto-discovery
    // { "name":"quickbooks", "skill":"lisa-wiki-local-quickbooks",
    //   "sourceSystem":"finance/quickbooks", "stateFile":"wiki/state/finance/quickbooks.json",
    //   "sideEffects":"read-only-ingest" }
  ],
  "staff": [                                 // digital employees; setup / `/add-role` generate a
                                             // doc page + a dual-runtime subagent per entry (running them is out of scope)
    { "id":"felix", "role":"Finance", "expertise":"financials, QuickBooks, MSA terms",
      "owns": { "categories":["finance"], "connectors":["quickbooks"] }, "sensitivity":"confidential" },
    { "id":"lex",   "role":"Legal",   "expertise":"contracts, MSAs, compliance",
      "owns": { "categories":["operations"], "connectors":["docs"] }, "sensitivity":"confidential" },
    { "id":"sally", "role":"Sales",   "expertise":"pipeline, prospects, CRM",
      "owns": { "categories":["sales"], "connectors":["lacrm"], "skills":["lisa-wiki-local-prospect-research"] } }
  ],
  "contaminationTerms": ["Propswap","Workhelix","Goldfish"]
}
```
Three JSON Schemas ship in the plugin and are referenced by validators:
`lisa-wiki-config.schema.json`, `state.schema.json`, `page-frontmatter.schema.json`.

---

## 6. Standards: frontmatter, index, log, categories, citations

**Frontmatter** (forced on new/touched synthesis pages + source notes; legacy tolerated, and the
linter reports legacy *separately* from failures):
```yaml
---
type: concept            # one of the declared categories / page types
created: YYYY-MM-DD
updated: YYYY-MM-DD
related: []              # relative paths to other wiki pages
sources: []             # relative paths to source notes
sensitivity: internal   # only when sensitivity policy enabled
---
```

**`index.md`** — canonical shape for new wikis is a **table** per category section
(`| Page | Summary | Updated |`), because publishing proves bullet lists do not scale to
hundreds of pages. Migration readers accept both table and bullet forms.

**`log.md`** — canonical shape is an append-only **table**
(`| Date | Operation | Target | Notes |`) with a **fixed operation vocabulary**:
`INIT, SETUP, INGEST, CREATE, UPDATE, MERGE, DEPRECATE, LINT, QUERY, REBUILD-INDEX`.
Legacy `## date - title` + bullet logs are accepted by the linter during migration.

**Categories** — the standard set is
`concepts, entities, decisions, architecture, requirements, playbooks, open-questions, projects`.
Projects may declare additional categories (e.g. publishing's `claims`, `comparisons`; gunner's
`finance`, `sales`, `people`) in config, with optional templates under `schema/templates/`.
A `staff` category (role doc pages, one per digital employee) is the documentation half of the
digital-staff model in §10; each `staff/<role>.md` page is generated alongside the role's subagent.

**Citations** — plain-text source-path citations, e.g.
`Source: wiki/sources/jira/2026-05-19-jira-ingest.md` or `Source: backend-v2 PR #42, commit abc1234`.

---

## 7. Connectors: core / contrib / overlay + the authoring contract

**Tiers**
- **Core** (shipped, supported): `git`, `memory`, `roles`, `jira`, `confluence`, `notion`,
  `slack`, `web`, `docs`. Slack is centralized immediately — `slack_oauth_user.py` and
  `ingest_slack_channel.py` are **byte-identical (SHA-256) between geminisportsai and propswap
  today**; only per-tenant app manifests differ.
- **Universal sources** (every project, regardless of config): `git` (self **and** other registered
  projects' commit + PR history), `memory` (the agent's **project-scoped** memory only), and `roles`
  (the wiki's own staff roster). Enabled by default; always part of a full ingest. **`memory` ingests
  project-scoped memory ONLY — never global or unrelated stores.** Claude's per-project file memory
  (`~/.claude/projects/<proj>/memory/*.md` + `MEMORY.md`) is inherently project-scoped and always
  qualifies. Codex Memories live at `~/.codex/memories/**/*.md` but are **user/global by default**, so
  they are **NOT ingested** unless project-scoped (e.g. a per-project `CODEX_HOME`); the global store
  and the *Chronicle* store (`~/.codex/memories_extensions/chronicle/`) are **never** ingested.
  Rationale: the wiki must not absorb anything unrelated to its project.
- **Contrib** (shipped, lower support, promoted on a second consumer): `lacrm`, `quickbooks`,
  `handwrytten`. Single-consumer (gunner) today.
- **Project extensions** (generated by `/add-ingest`, §10/§13): a thin project-local *front-door*
  skill that does the unique part (classify, fetch a special source, stamp domain frontmatter) and
  then **chains into `/ingest`**, handing it the enriched parameters. The kernel still owns
  synthesis/index/log/verify/state/PR. Covers gunner's prospect-research (research + CRM writeback
  + sales scoring) and publishing's content-classification paths. These stay project-local, not core.

> **Not connectors:** documentation absorption (moving the host repo's docs into the wiki) and the
> README rewrite are **setup/migration repo-write operations** (§15), not connectors — they obey the
> no-loss parity rule and deterministic reference rewriting, not the connector contract below.

**The minimal connector authoring contract** (an authoring convention enforced by the kernel +
linter, *not* an executable SDK):
1. **Registration is explicit** in `connectors` (core) or `customConnectors` (project extensions).
   `/ingest` dispatches **only** to registered names; project front-door skills are invoked
   explicitly and chain back into `/ingest`. No globbing, no auto-discovery.
2. A connector's **only repo writes** are sanitized **source notes** under its declared
   `wiki/sources/<sourceSystem>/` and (optionally) **run metadata** to a declared handoff file
   or stdout. A connector **must not** write synthesis pages, `index.md`, `log.md`, or **final
   state**.
3. **The kernel** performs synthesis, index update, log append, verification, **final state
   advancement**, and PR — in that order — *after* the connector returns. State is advanced only
   after source notes + synthesis + index + log + verification all pass. (This is the ordering
   bug-prevention guarantee; connectors writing state directly would reintroduce it.)
4. **Side-effect class** is declared per connector: `read-only-ingest` | `repo-write` |
   `external-write`. The kernel refuses to run an `external-write` connector unless config opts
   in **and** the run is explicitly invoked with that intent; it **never auto-merges** the
   resulting PR.
5. **Deterministic touched-file check** (`diff-guard.mjs`): before kernel synthesis, any
   connector-produced diff outside the declared source-note path and declared temp/metadata
   paths is a **hard failure** — unless the connector is `external-write` and the extra write is
   outside the repo. This makes "source-note only" enforceable, not aspirational.

---

## 8. Models: sensitivity, source retention, tenant guards, PR/auto-merge

- **Sensitivity** (`sensitivity.enabled`, values `public | internal | confidential | restricted`,
  default `internal`): defaults per source, governs whether a page may be linked from a public
  index, and whether auto-merge is permitted.
- **Source retention** (`sourceRetention`): `raw-ok` | `sanitized-note-only` | `metadata-only` |
  `external-pointer-only`. Gunner avoids raw sensitive artifacts; publishing keeps excerpts/atoms;
  project/company wikis keep sanitized notes. Connectors must honor the project's retention level.
- **Tenant guards**: per-connector, not just global terms. e.g. propswap restricts Atlassian to
  `propswap.atlassian.net` and forbids ingesting `propswap/`; gemini guards Atlassian + Notion
  tenants. `contaminationTerms` is an additional global scan, not a substitute.
- **PR / auto-merge**: per-project policy, not a universal default. Lisa/Gemini/Propswap/Gunner
  opt in; publishing opts out. Sensitive and `external-write` runs never auto-merge.

---

## 9. Security, trust, and side effects

- **Touched-file boundaries** are enforced deterministically (`diff-guard.mjs`, §7.5), in both
  ingest and CI. Wrapper/standalone modes additionally forbid staging any child-repo contents.
- **External-write connectors** (Slack OAuth, CRM writeback, PR automation) require config
  opt-in + explicit per-run intent; their PRs never auto-merge.
- **Secrets / OAuth artifacts**: token files, OAuth callbacks, and app secrets stay in
  `.gitignore` and are **never** committed. Setup verifies ignore rules; the linter and CI scan
  for `xox[pbar]-`, `AKIA[0-9A-Z]{16}`, PEM private-key headers, bearer tokens, `client_secret`.
- **Tenant guards + contamination scans** run before every commit; a wrong tenant aborts the run
  and derived notes are discarded (gemini's existing discipline, generalized).
- **Sensitivity** gates index linkage and auto-merge as in §8.
- **Connector dependency policy**: Slack stays stdlib-Python (portable); doc conversion and
  contrib connectors declare their runtime deps and are surfaced by a `setup --doctor` check.
- **Role subagents are instructed, not policed (v1)**: generated subagents are *told* to stay in
  their domain (their prompt points at their owned categories/sources), but v1 does **not** enforce
  per-role write isolation. A role-scoped touched-file guard is a deferred option (§17). Because
  running the subagents is out of scope, the kernel only guarantees that whatever *does* run still
  passes the universal touched-file / state-order / secret / tenant checks.
- **Memory ingestion is project-scoped only**: the `memory` connector ingests **only** a project's
  own memory — Claude's per-project memory dir, and Codex memory only when it is project-scoped
  (per-project `CODEX_HOME`). Global Codex memory (`~/.codex/memories/`) and the Chronicle store are
  **never** ingested, so nothing unrelated to this project can leak in. Tenant/contamination scans
  and ≥`internal` sensitivity still apply as defense-in-depth.
- **Onboarding captures stay private**: `/onboard-me` is read-mostly (no PR by default). The user
  info it gathers goes to **project-scoped memory** only (or stays session-local if none exists); it
  never writes PII into the committed wiki and never touches global Codex memory. A sanitized,
  non-PII audience/role note is written to the wiki only with `--write-audience-note` **and**
  `onboarding.allowAudienceNote: true`, via the normal PR flow.

---

## 10. Runtime surfaces: skills canonical; Claude facades; Codex skills

**Skills are canonical.** Verified facts driving this (Codex round 1, confirmed against official
docs and the local `~/.codex/skills/migrate-to-codex` references):
- Lisa's `scripts/generate-codex-plugin-artifacts.mjs` points Codex at `skills`, `.mcp.json`, and
  `hooks` — it does **not** map Claude `commands/` into Codex artifacts.
- Codex plugins bundle **skills, apps, MCP servers, hooks** — there is **no** Claude-style
  `commands/` surface. Codex's own slash commands are built-in controls; enabled skills also
  appear in the app slash list and are invocable with `$name`.
- The local migrate-to-codex skill maps `.claude/commands/*.md` → `.agents/skills/source-command-*`
  with manual-review caveats (publishing already shows this:
  `.claude/commands/ingest.md` → `.agents/skills/source-command-ingest/SKILL.md`).

Therefore: author all workflow logic as skills. On **Claude**, ship thin top-level command
facades using the **canonical verbs** (Karpathy's ingest/query/lint, plus lifecycle +
scaffolders); each facade just invokes its skill. On **Codex**, the same skills are invoked as
`$lisa-wiki-ingest` / via the app slash list. **Do not** design a cross-runtime custom
slash-command abstraction.

| Command (Claude) | Skill | Purpose |
|---|---|---|
| `/ingest [<url\|file\|prompt>]` | `lisa-wiki-ingest` | **no args = full ingest** (every enabled non-external-write source; external-write needs explicit intent); with an arg = targeted ingest (pick connector) |
| `/query <question>` | `lisa-wiki-query` | read-only by default; writeback opt-in |
| `/lint` | `lisa-wiki-lint` | health check |
| `/setup` | `lisa-wiki-setup` | scaffold/repair/upgrade; **asks purpose + README mode**; seed staff roster; `--with-ci` |
| `/migrate` | `lisa-wiki-migrate` | one-time per repo |
| `/add-ingest` | `lisa-wiki-add-ingest` | generate a front-door ingest skill that chains to `/ingest` |
| `/add-role` | `lisa-wiki-add-role` | generate a domain-expert role subagent over the wiki |
| `/onboard-me` | `lisa-wiki-onboard-me` | interview the user (project-scoped capture), then guided tour + sample `/query`s — read-mostly |
| `/doctor` | `lisa-wiki-doctor` | post-migration verification checklist (§16); `/migrate`'s final gate, re-runnable |

Bare verbs honor the canonical interface; the plugin-qualified form (`/lisa-wiki:ingest`) is the
collision fallback. **Caveat:** Lisa already has a tracker `/intake` (PRD→tickets) — a *different*
pipeline — so the wiki keeps `/ingest` distinct and does **not** overload `/intake`.

**Full ingest.** `/ingest` with no argument (or "do a full ingest") iterates **every enabled
connector whose side-effect policy permits unattended ingest** — self + other projects' git/PR
history, memory, roles, plus read-only registered sources (notion, jira, confluence, quickbooks, …)
— running each through the same ordered pipeline. `external-write` connectors (e.g. Slack OAuth, CRM
writeback) are **skipped unless the run includes explicit external-write intent** (§7.4/§9).
Targeted `/ingest <thing>` ingests just that one input.

**Digital staff (role subagents).** `/setup` seeds a starter roster from `config.staff[]` and
`/add-role` adds more. Each role entry generates two artifacts: the `wiki/staff/<role>.md` doc page
(in the brain) and a runnable subagent — Claude `.claude/agents/<role>.md` plus Codex
`.codex/agents/<role>.toml` (TOML keys `name`, `description`, `developer_instructions`; optional
`model`, `model_reasoning_effort`, `sandbox_mode`), both generated by setup / `/add-role` from the
role-agent templates; Codex TOML emission is new implementation work. The subagent is
**brain-pointed, not baked**:
its prompt says *"your domain is `wiki/<owned>/`; `/query` it first, contribute via `/ingest`; stay
in your lane"* — so it never goes stale as the domain grows; only its one-line `description` is
synthesized from the wiki at generation time. **Running the subagents (invocation, scheduling,
Telegram / agent-team routing, private notebooks) is out of scope** — the plugin only sets them up.

Codex hooks should prefer `PLUGIN_ROOT`/`PLUGIN_DATA` with `${CLAUDE_PLUGIN_ROOT}`/
`${CODEX_PLUGIN_ROOT}` compatibility fallbacks (refresh the generator accordingly).

---

## 11. Distribution and runtime packaging

Ships through Lisa's existing pipeline; this is concrete implementation work, not a drop-in:
- Add `plugins/src/wiki/` (manifest `name: "lisa-wiki"`, display "LLM Wiki").
- Update `scripts/build-plugins.sh` — it currently hardcodes `base` + a fixed `STACKS` array;
  add `lisa-wiki` as a standalone plugin build.
- Update `metadataFor()` in `scripts/generate-codex-plugin-artifacts.mjs` with `lisa-wiki`
  metadata (displayName, descriptions, category, capabilities, keywords, defaultPrompt).
- Extend `bun run check:plugins` coverage so the artifact-drift guard (PROJECT_RULES.md) covers
  the new plugin. Edits go to `plugins/src/`, never the built `plugins/lisa-wiki/`.
- Add marketplace metadata for both the Claude marketplace and the Codex plugin marketplace.
- Canonical contract/templates/config-schema/connector-scripts live in the plugin and are
  referenced via `${*_PLUGIN_ROOT}`; projects don't copy machinery.
- **MCP/auth stays project-owned.** The plugin generates `.mcp.json` / `.codex/config.toml`
  snippets and runs doctor checks, but never silently writes global or unrelated MCP config, and
  connectors disable themselves when their MCP is absent.

---

## 12. Validation and CI

- **Deterministic validators** (plugin scripts): `validate-config.mjs` (config vs JSON Schema),
  `lint-wiki.mjs` (frontmatter where required, source paths exist, index covers pages, log entry
  for material changes, **state not advanced unless source notes + synthesis + index + log +
  verification are present/passing**, **no broken internal links / orphan references**,
  **structure-manifest conformance** (`wiki-structure.schema.json` — files in canonical locations),
  secret/tenant scans, no child-repo contents staged in wrapper mode, no stray binaries),
  `diff-guard.mjs` (touched-file boundaries), `rewrite-refs.mjs` (deterministic link/citation/index
  rewriting on file moves; migration verifies zero dangling links afterward), `render-contract.mjs`
  (snapshot generation/upgrade). The structure manifest is the shared source of truth read by
  `validate-config`, `lint-wiki`, and `render-contract`.
- **Post-migration `/doctor`** (§16): `verify-migration.mjs` runs the deterministic checks and emits
  `wiki/state/migration/doctor-report.json` (per-item PASS/WARN/FAIL/SKIP, overall
  READY/READY_WITH_WARNINGS/NOT_READY); the `lisa-wiki-doctor` skill adds the functional smoke tests.
- **Modes**: warning mode first (reports legacy/issues without failing), hard-fail mode after a
  repo reaches a clean baseline (migration phase 5).
- **Optional GitHub Action** (`lisa-wiki:setup --with-ci`, template `ci/lisa-wiki-validate.yml`):
  runs `validate-config`, `lint-wiki`, secret/tenant scans, and a mode-specific staged-file
  policy check on PRs. Optional because early migrations and wrapper repos need warning mode
  first and may not want wiki CI blocking unrelated work.

---

## 13. Extensibility: four mechanisms (all config or generators — never forking)

1. **Config toggles** — enable/disable connectors, declare tenants/projects/spaces/categories,
   pick source layout, set PR/sensitivity/retention policy, declare `staff[]`. Covers most variation.
2. **`/add-ingest`** — scaffolds a thin project-local *front-door* ingest skill (`lisa-wiki-local-<x>`,
   registered in `customConnectors`) that does the unique part (classify / fetch a special source /
   stamp domain frontmatter) and **chains into `/ingest`**. The kernel still owns
   synthesis/index/log/verify/state/PR; `/add-ingest` captures the side-effect class (§7). Covers
   QuickBooks, prospect-research, and publishing's content-classification paths.
3. **`/add-role`** — scaffolds a domain-expert *role subagent* over the wiki, dual-runtime
   (Claude `.claude/agents/<role>.md` + Codex `.codex/agents/<role>.toml`) plus a `wiki/staff/<role>.md` doc page,
   from a `config.staff[]` entry. Brain-pointed, not baked (§10). Running it is out of scope.
4. **Custom categories + templates** — declare extra categories in config and drop page templates
   under `wiki/schema/templates/`; core skills honor them. Covers publishing's `claims`/
   `comparisons`/SPA and gunner's domain categories (`finance`, `sales`, `people`/`staff`).

---

## 14. Compatibility matrix

| Dimension | lisa | geminisportsai | gunnertech | propswap | publishing |
|---|---|---|---|---|---|
| Mode | embedded | wrapper | standalone (nested `wiki/wiki/`) | wrapper | subdir |
| Source layout | by-system | by-system | by-system | by-system | **by-category** |
| Frontmatter | no | yes | yes (+sensitivity) | no | yes (claims add status) |
| Index format | bullets | table | bullets | bullets | table |
| Log format | `## date - title`+bullets | table | `## [date] OP \| title`+blocks | `## date - title`+bullets | table |
| State cursors | JSON | JSON | JSON | JSON | **none** |
| PR + auto-merge | yes | yes | yes | yes | **no** |
| Runtime surfaces | .claude + .agents | .claude + .agents | **.agents only** | .claude + .agents | **.claude only** |
| MCP deps | Linear (opt) | Atlassian + Notion | Handwrytten + QuickBooks | Atlassian | none |
| Connectors | git, github-PR | git, jira, notion, confluence, slack, docs | lacrm, quickbooks, handwrytten, prospect-research | git, jira, confluence, slack | content paths + PDF/DOCX |
| Code | none | Slack py (stdlib) | LACRM py + QuickBooks node | Slack py (stdlib) | PDF/DOCX converters |
| Connector side effects | read-only | read-only + Slack OAuth | read-only + CRM writeback | read-only + Slack OAuth | read-only + doc convert |
| Digital staff / roles | none | none | **agent employees** (Lex/Legal, Felix/Finance, Sally/Sales, Mark, Casey, Parker, Chief; Telegram-routed) | none | review agents (editor, senior-analyst, fact-checker) |

The kernel schema must accommodate every column above without baking in assumptions
(esp. "no state", "by-category", "no PR", custom page types — all from publishing).

---

## 15. Migration: phases, per-repo notes, risks, rollback

**Phases** (compatibility-first; per-repo PRs):
- **Phase 0 — Inventory.** Per repo, produce a profile: mode, root, categories, frontmatter
  coverage, log/index format, source dirs, state files, connectors, runtime surfaces, MCP config,
  scripts, PR policy. (Largely done in this plan's research; formalize as fixtures.)
- **Phase 1 — Adopt kernel (no content rewrite).** Add `lisa-wiki.config.json`, render the contract
  snapshot, add `wiki/state/README.md`, run validators in **warning** mode, centralize Slack
  where applicable.
- **Phase 1b — Documentation absorption & structure.** Run `absorb-docs.mjs`: move the host repo's
  own docs (`docs/`, `specs/`, top-level docs) into `wiki/documentation/` (or mapped categories),
  ingest them, and conform to the canonical structure manifest. `rewrite-refs.mjs` updates every
  internal link/citation/pointer + the index; lint verifies **zero dangling links**. Keep-in-place
  files (LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, `.github/**`, NOTICE*, SUPPORT.md,
  GOVERNANCE.md, registry/docs-hosting config) stay at conventional paths. **Ask** the README mode
  (`rich`/`stub`/`preserve`, default `rich`) and apply it — `stub` requires an explicit human choice,
  never automatic. **Wrapper mode moves only the host repo's docs, never child-project docs.**
  Idempotent via source fingerprints; parity-checked; no-loss.
- **Phase 2 — Runtime consolidation.** Replace duplicated local wiki skills with plugin skills +
  minimal overlays; Claude commands become facades; Codex uses skills.
- **Phase 3 — Connector consolidation.** Slack → core; PDF/DOCX/URL → core utilities; keep
  LACRM/QuickBooks contrib; keep prospect-research/Gartner paths as overlays.
- **Phase 4 — Normalize by touch.** New/touched pages get frontmatter; new logs use the canonical
  table; legacy stays parseable until deliberately migrated.
- **Phase 5 — Hard enforcement.** Flip validators to hard-fail (and enable CI) once a repo's
  baseline is clean.

**Migration invariant — rename, never lose.** Any project command, ingest path, or role that is
*genuinely unique* is migrated as though it had been created via `/add-ingest` (front-door skill)
or `/add-role` (subagent); any wiki-ingest alias (`*-wiki-ingest`, publishing's `/ingest` router,
etc.) is renamed to the canonical `/ingest`. Renaming is expected; **loss of functionality or data
is not** — each migration is parity-checked (run the old path and the new path, diff the output)
before the old artifact is deleted. The same no-loss + parity rule covers **documentation
absorption** (old docs are ingested before removal, references rewritten deterministically) and the
**README** (the old README is ingested before any `stub`/`rich` rewrite).

**Sequencing.**
- **v1 live migration:** `lisa`, `geminisportsai`, `propswap`, `gunnertech` (shared by-system +
  state + PR model).
- **v1 publishing compatibility gate (required before v1 is "done"):** read-only inventory +
  **fixture tests** derived from publishing's current shapes (by-category sources, `claims/`,
  `comparisons/`, content-source categories, no-PR policy, source-fingerprint/backfill state,
  custom templates) prove the v1 schema does not make publishing impossible.
- **v1.1 live migration:** `publishing`.

**Per-repo notes.**
- `lisa` — `mode: embedded`; keep self-ingesting the monorepo; add frontmatter on touch; convert
  bullet index/log to canonical on touch. **`readme.mode: rich`** (public npm package — README is its
  shopfront; deep content moves to `wiki/documentation/`, README links to it + onboarding line).
- `geminisportsai` — closest to target; reconcile `.agents`-only `ingest-confluence` asymmetry;
  Slack → core. **`readme.mode: stub`** ok (private wrapper).
- `propswap` — like gemini minus Notion; Slack → core; preserve the `propswap/` ignore guard.
  **`readme.mode: stub`** ok (private).
- `gunnertech` — `mode: standalone`; preserve nested `wiki/wiki/`; LACRM/QuickBooks → contrib;
  prospect-research → `/add-ingest` front-door (`external-write`, no auto-merge); preserve
  `sensitivity`; populate `config.staff[]` from the existing `people/` agent pages and regenerate
  the role subagents (Lex/Felix/Sally/…) on both runtimes (running them stays out of scope).
  **`readme.mode: stub`** (internal company brain).
- `publishing` — `mode: subdir`, `sources.layout: by-category`, `prPerIngestion: false`, no state
  cursors (use source-fingerprint/backfill state), custom categories `claims`/`comparisons` (+SPA
  template). Its 7 `ingest-*` paths migrate without loss: the generic ones (`idea`, `secondary`,
  `inquiry`) become core `web`/`docs` ingest + declared buckets; the Gartner-specific ones
  (`alignment`, `primary`, `written-response`) become `/add-ingest` front-doors. Model its
  editor/analyst/fact-checker agents as `config.staff[]` roles. **`readme.mode: rich`/`preserve`**
  (decide per repo). Migrate in v1.1.

**Risks & rollback.** Each phase is a reviewable PR; warning mode precedes hard-fail; the rendered
contract snapshot keeps repos self-describing if the plugin is unavailable; per-repo migrations are
independent, so a regression in one does not block others. Rollback = revert the repo's migration
PR; the kernel plugin is additive and versioned (§11/§4). `/migrate` ends by running `/doctor
--migration` (§16); a repo is not considered migrated until its doctor verdict is `READY` (or a
human-approved `READY_WITH_WARNINGS`).

---

## 16. Post-migration verification: `/doctor`

A repo is not "migrated" until `/doctor` returns a passing verdict. `/migrate` runs `/doctor
--migration` as its final gate; `/doctor` is also re-runnable anytime. It orchestrates the
deterministic scripts (`verify-migration.mjs`, `lint-wiki.mjs`, `diff-guard.mjs`,
`validate-config.mjs`), runs the functional smoke tests, interprets phase-allowed warnings, and
writes `wiki/state/migration/doctor-report.json`, printing the blocking items.

**Verdict.** Each item is `PASS | WARN | FAIL | SKIP`; overall is `READY` | `READY_WITH_WARNINGS` |
`NOT_READY`. Phase 5 (hard enforcement) forbids `WARN` on structure/integrity items; earlier phases
allow only documented legacy warnings. Build checks (G) are Lisa/release-only — `SKIP` in downstream repos.

**A. Structure & config** (deterministic — `verify-migration.mjs` + `validate-config.mjs`)
- config validates vs `lisa-wiki-config.schema.json`; `wiki-structure` manifest conformance passes.
- required files exist: `lisa-wiki.config.json`, `schema/llm-wiki-contract.md`, `index.md`, `log.md`, `start-here.md`.
- `schemaVersion` present; rendered `kernelVersion` matches the installed plugin (no drift).
- `purpose`, `readme.mode`, `documentation.*`, `git.*`, sensitivity/sourceRetention, connectors, staff all validate.
- README mode was asked/recorded; `stub` never selected implicitly.

**B. Integrity & safety** (deterministic — `lint-wiki.mjs` + `diff-guard.mjs`)
- lint passes (or only phase-allowed warnings); index covers pages; material changes logged; source paths exist.
- state-order invariant holds (notes + synthesis + index + log + verify before state advance).
- no broken internal links / orphan refs / stray binaries / non-canonical locations.
- secret / tenant / contamination / sourceRetention / sensitivity scans pass.
- memory sources are project-scoped only — no global Codex memory or Chronicle present.

**C. No-loss / parity** (deterministic manifest + reviewed diff)
- a pre/post migration manifest maps every legacy page, source note, doc, command, ingest path, and role.
- every legacy page/doc is present, moved, or explicitly mapped — no unexplained drops (count ≥ pre-migration).
- every unique ingest path / command / role is represented as `/ingest`, `/add-ingest`, `/add-role`, or an onboarding flow; old-vs-new parity artifacts recorded.
- docs absorption is idempotent (rerun = no duplicate moves); refs rewritten; zero dangling links.
- old README ingested before rewrite; current README matches chosen `readme.mode`.
- no leftover project-local wiki machinery except generated overlays + role agents.

**D. Runtime surfaces — both runtimes** (deterministic + functional)
- Claude facades resolve: `/ingest /query /lint /setup /migrate /add-ingest /add-role /onboard-me /doctor`.
- Codex skills resolve: `$lisa-wiki-*` (incl. doctor).
- for each `config.staff[]`: `wiki/staff/<role>.md` + `.claude/agents/<role>.md` + `.codex/agents/<role>.toml` exist and validate.
- MCP doctor: each enabled connector has working auth/MCP or is cleanly disabled with a reason; external-write connectors skipped unless explicit intent.

**E. Functional smoke** (skill-orchestrated)
- targeted ingest of a small known fixture exercises source note → synthesis → index → log → verify → state, in order — in the migration branch or dry/scratch mode; **no extra PR**.
- `/query "<known question>"` returns a cited answer from the migrated wiki.
- `/lint` clean (or expected phase warnings only).
- `/onboard-me` completes read-mostly: tour + sample queries, no PII, project-scoped/session capture only.
- bare `/ingest --dry-run` lists enabled non-external-write sources and skips external-write.
- `/doctor` rerun is idempotent (only the report timestamp changes).

**F. Mode-specific** (deterministic)
- embedded (lisa): self-ingest target is the host repo at HEAD; tooling/public docs required by packaging stay in place; README `rich`/`preserve` honored.
- wrapper (gemini/propswap): child-project docs ingested only, never moved; no child-repo files staged; source notes cite child repo/commit.
- standalone/subdir (gunner/publishing): `wikiRoot`/nested paths resolve; no accidental `wiki/wiki` double-normalization unless configured.
- no-PR mode (publishing): doctor does not require PR creation; backfill/fingerprint state still validates.

**G. Git / CI / distribution** (deterministic)
- working tree has only intended migration changes; unrelated changes preserved/unstaged.
- no secrets/OAuth artifacts committed; `.gitignore` covers token paths.
- if `prPerIngestion`: migration PR targets the configured branch; auto-merge matches sensitivity/external-write rules.
- if `--with-ci`: the validator workflow is present and green.
- Lisa/release only: `bun run build:plugins` builds both `.claude-plugin` + `.codex-plugin`; `check:plugins` passes; no hand-edited artifacts (`SKIP` downstream).

---

## 17. Open questions deferred to implementation

- Exact `state.schema.json` envelope fields beyond the agreed core
  (`connector, profile, lastSuccessfulRunAt, cursor, sourceNotes, synthesisPages, schemaVersion`)
  and how publishing's source-fingerprint/backfill state maps onto it.
- Whether a generic `connector-content` (publishing-style by-category classification) graduates
  from overlay to core after v1.1.
- Whether contrib connectors (LACRM/QuickBooks) graduate to core once a second consumer exists.
- Marketplace specifics (naming/namespace display) for the Codex plugin marketplace.
- Whether per-role write isolation should become *enforced* (a role-scoped touched-file guard) in a
  later version, vs. the v1 "instructed, not policed" stance (§9).
- Default ordering / failure handling for a no-arg **full ingest** across many connectors
  (fail-fast vs continue-on-error per source; per-source PRs vs one combined PR).
- How to detect / opt into a *project-scoped* Codex memory (e.g. per-project `CODEX_HOME`) for the
  `memory` connector — global Codex memory and Chronicle are out of scope by decision (§7/§9).
- Whether `/onboard-me --write-audience-note` is allowed under each project's privacy policy — a
  per-repo human decision. (README mode is resolved interactively: `/setup` & `/migrate` **ask**
  rich/stub/preserve, default `rich`, never auto-stub.)
- Final keep-in-place docs allowlist per repo (any registry/docs-hosting paths that must stay
  outside the wiki beyond the §5 baseline).
- Release checklist cadence for re-verifying Codex plugin/hook/skill docs (they're actively changing).

---

## 18. Sequenced work plan / milestones

- **M0 — Kernel skeleton.** `plugins/src/wiki` with manifest, the core workflow skills as
  specifications, JSON Schemas, contract/index/log/page templates, `render-contract.mjs`,
  `validate-config.mjs`. Wire `build-plugins.sh` + `generate-codex-plugin-artifacts.mjs` +
  `check:plugins`; confirm both `.claude-plugin` and `.codex-plugin` build.
- **M1 — Validators + lint.** `lint-wiki.mjs`, `diff-guard.mjs`, `rewrite-refs.mjs`, the
  `wiki-structure` manifest, secret/tenant scans, state-order + broken-link/orphan + structure
  conformance checks; `verify-migration.mjs` skeleton; warning mode. Optional `ci/lisa-wiki-validate.yml`.
- **M2 — Core connectors.** Universal first: `git` (self + other projects + PR history), `memory`
  (Claude + Codex, scope-guarded), `roles`; then `slack` (centralized), `web`, `docs`, `jira`,
  `confluence`, `notion` (MCP doctor + snippet generation).
- **M3 — Setup/ingest/query/lint/usage skills + canonical command facades** end-to-end against one
  pilot repo (gemini), including the `/setup` **purpose** prompt, **no-arg full ingest** across all
  enabled non-external-write sources, and **`/onboard-me`**; add the `/add-ingest` and `/add-role`
  scaffolders and dual-runtime role-subagent generation; wire the `/doctor` skill +
  `verify-migration.mjs` (full checklist).
- **M4 — `lisa-wiki-migrate` + Phases 0/1/1b** across the four v1 repos; adopt kernel in warning
  mode, including documentation absorption (`absorb-docs.mjs` + `rewrite-refs.mjs`) and per-repo
  `readme.mode`; `/migrate` ends by running `/doctor --migration` and recording the verdict.
- **M5 — Phases 2–4** across the four v1 repos; contrib connectors for gunner; publishing
  compatibility gate (fixtures).
- **M6 — Phase 5** hard enforcement + CI on the four v1 repos. **v1 done.**
- **M7 — Publishing live migration (v1.1).**

---

## 19. Acceptance criteria

**v1 is done when:**
- One built plugin produces working `.claude-plugin` **and** `.codex-plugin` artifacts via the
  Lisa pipeline; `check:plugins` passes; no artifact is hand-edited.
- `lisa`, `geminisportsai`, `propswap`, `gunnertech` each run setup/ingest/query/lint from the
  plugin with **zero project-local wiki *machinery*** (only `wiki/` content, `lisa-wiki.config.json`,
  rendered snapshot, pointers, project-owned MCP/secrets, and any registered overlays).
- Slack is a single centralized connector used by gemini + propswap.
- Deterministic validators pass in hard-fail mode on all four; the touched-file/state-order
  guarantees are enforced (not just documented); no secrets/OAuth artifacts are committed.
- The publishing compatibility gate (read-only inventory + fixtures) passes, proving the v1 schema
  supports by-category sources, no-state, no-PR, and custom page types.
- The canonical commands (`/ingest`, `/query`, `/lint`, `/setup`, `/migrate`, `/add-ingest`,
  `/add-role`, `/onboard-me`, `/doctor`) work on Claude (facades) and as skills on Codex.
- Each migrated repo has a `/doctor` report (`wiki/state/migration/doctor-report.json`) with verdict
  `READY` (or a human-approved `READY_WITH_WARNINGS`); `/migrate` runs it as its final gate.
- Gunner's role roster is regenerated from `config.staff[]` as `wiki/staff/<role>.md` pages **and**
  dual-runtime subagents (Lex/Felix/Sally/…); invoking/scheduling them is explicitly out of scope.
- Bare `/ingest` performs a full ingest across all enabled non-external-write sources; every project
  can ingest its **project-scoped** memory, git history, PR history, and roles (universal sources) on
  both runtimes — never global or unrelated memory.
- Every migrated unique ingest path / role is preserved (parity-checked) — renamed into `/ingest`,
  `/add-ingest`, or `/add-role` shape with no loss of functionality or data.
- `/setup` captures the wiki `purpose` and renders it into the contract + `start-here.md`.
- Documentation is absorbed into the wiki **idempotently with zero dangling links** (references
  rewritten deterministically); keep-in-place files remain at conventional paths; `/setup` & `/migrate`
  **ask** the README mode (default `rich`) and honor it per repo — **no public repo's README is auto-gutted**.
- The canonical folder structure is enforced (structure-manifest conformance) on all four repos.
- `/onboard-me` runs without leaking PII — project-scoped memory only, never global Codex memory.

**v1.1 is done when:**
- `publishing` runs entirely on the kernel (subdir mode, by-category sources, no-PR, custom
  `claims`/`comparisons`/SPA categories) with its content intact and validators green.

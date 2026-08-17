# Implementation plan: 2026-08-12 improvement notes

> Source: `docs/wiki-inbox/2026-08-12-lisa-improvement-notes.md` (revised 2026-08-12 —
> every "current state" claim in it was verified against the codebase; this plan builds
> on the corrected version).
> Status: proposed, **Phase 0 complete** — all six Phase 0 decisions were recorded on
> 2026-08-12 (see below), so the Phase 2 gate is satisfied. The implementation plan
> itself stays proposed until each work unit ships.
> Work-unit letters run **A–N**. A–J match the source document's "Suggested work
> units" table; K–N were added by the 2026-08-12 fleet survey below and own the
> fleet-facing work — K fleet rules cleanup, L fleet BDD gate resync, M Lisa bug
> burn-down, N absorb fleet inventions.

## Goal

Turn eighteen working-session observations plus one follow-up (credential-provider
substrate precedence) into shipped Lisa behavior: an agent-neutral rules architecture,
an eager operating pack, tighter ticket-lifecycle gates, real e2e test discovery in the
BDD gate, a recorded ratchet policy, and one substrate-precedence contract — without
building any second system where Lisa already has machinery.

## Shape of the work

Three kinds of work, deliberately separated:

1. **Decisions (Phase 0)** — six policy calls that gate everything decision-shaped.
   Cheap to make, expensive to unmake after templates ship.
2. **Decision-free build (Phase 1)** — work units whose design is already settled by
   existing contracts. Can start immediately, in parallel.
3. **Decision-dependent build (Phase 2)** — work units whose file layout or behavior
   changes depending on Phase 0 outcomes.

Every Lisa-side change lands under the standing repo gates: template/source edits need
`build:upstream-evidence-manifest` in the same commit; threshold changes obey the
ratchet checker (relevant to WU-H — see its risk note); PRs merge with `--merge` via
the normal submit/drive flow; parity across Claude, Codex, Cursor, OpenCode, Copilot,
and agy is required or the gap is documented per `AGENTS.md`.

---

## Phase 0 — decisions (record each in `wiki/decisions/`)

| # | Decision | Recommendation | Unblocks |
|---|---|---|---|
| D1 | Canonical agent-neutral host-rules path (`agents/rules/`, `.agents/rules/`, other) **and** whether the `AGENTS.md` pointer reverses agy's accepted no-eager-rules exception (2026-06-06 decision, `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`) | Pick `.agents/rules/` (already reserved in the `AUTO_LOADED_RULES_DIR_PREFIXES` blocklist, `src/core/project-config.ts:67`, so no collision with learnings-ledger resolution). Decide agy explicitly; do not let the pointer flip it silently. | A, B |
| D2 | Ratchet policy: keep, kill, or keep-absolute-floors-only | Absolute floors stay as gates; remove "creep the number upward" machinery only where a named deterministic no-regression invariant replaces it, per family, with a brownfield migration. BDD floor gets special treatment (see WU-H). | H; shapes G's floor interplay |
| D3 | Soften `wiki-knowledge-source` from "consult first" to "query when you need depth" | Yes — context budget. Fix the base-vs-wiki-plugin packaging mismatch at the same time. | part of B |
| D4 | In-session tickets auto-ready + two sub-decisions: does exploratory-qa's deliberate `ready=false` default stand, and what does *omitted* `build_ready` mean once normalized (JIRA today: not ready; GitHub/Linear today: ready) | Auto-ready for complete defects found during other work; exploratory-qa default stands (it *is* the human product-call exception); normalize omitted `build_ready` to **not ready** so ready is always an explicit claim — then fix every Lisa call site to pass it explicitly (WU-D does this anyway). | D |
| D5 | Mutation/property testing in the implement/verify workflow | Leave as-is: forced `fast-check` library, opt-in mutation gate, on-demand skill. Revisit only if a real gap shows up in verify outcomes. | (closes item 14) |
| D6 | Substrate precedence: reverse Linear/Notion MCP-first to configured-provider-first | Yes — one shared contract: provider token/CLI substrate first when its bootstrap is available and identity-matched; interactive MCP fallback; identity-match mandatory on every substrate. Generalizes the Atlassian write-tenant-safety logic; aligns interactive with headless. | J |

Deliverable: one decision-record page per D1/D2/D4/D6 (D3 and D5 can be lines inside
D1's and D2's records). Phase 0 is complete when all six are merged to `wiki/decisions/`.

**Status: DECIDED 2026-08-12.** All six recorded, all following the recommendations
above:

| Record | Covers | Outcome |
|---|---|---|
| `wiki/decisions/2026-08-12-agent-neutral-host-rules-path.md` | D1, D3 | `.agents/rules/` chosen (already reserved in `AUTO_LOADED_RULES_DIR_PREFIXES`); host-authored, Lisa never writes bodies; managed `AGENTS.md` pointer block via existing bounded-edit machinery; **agy exception NOT reversed** (pointer ≠ baking, but parity tests must assert the real gap); wiki softened to query-on-demand + base/wiki packaging fix |
| `wiki/decisions/2026-08-12-ratchet-policy.md` | D2, D5 | Absolute floors stay; generic creep removed **only** with a named deterministic non-regression replacement, per family, brownfield migration first; sequence is invariant → allow entry → mechanism change; mutation/property left as-is; mutation-proven-guard practice adopted |
| `wiki/decisions/2026-08-12-in-session-ticket-ready-role.md` | D4 | Explicit `build_ready: true` for complete in-session defects; **omitted normalizes to not-ready** (breaking for GitHub/Linear, intended); exploratory-qa `ready=false` ratified as the named human-gate exception; Linear `ready→Todo` mapping routed to WU-M; already-implemented + two-failures guards adopted |
| `wiki/decisions/2026-08-12-credential-substrate-precedence.md` | D6 | Provider token/CLI first when bootstrap present and identity-matched; MCP fallback; identity-match mandatory on every substrate; reverses Linear/Notion, moves Atlassian reads to token-first, generalizes the write-tenant-safety rationale into one shared slug |

---

## Phase 1 — decision-free build (start immediately, parallel)

### WU-C — branch plan derived from the environment mapping

**Scope.** Make each applicable leaf ticket's base branch and PR target visible and
validated, without creating a second source of truth beside
`## Target Backend Environment` + `.lisa.config.json deploy.branches`.

**Steps.**
1. Add a generated `## Branch Plan` section (`Branch from` / `PR into`) to the three
   vendor writers, derived at write time from the resolved environment mapping and
   marked as derived data.
2. Create/validate (S-gates in `lisa-jira-validate-ticket`, `lisa-github-validate-issue`,
   `lisa-linear-validate-issue`) recompute the plan from current config and **reject** a
   conflicting human-authored branch plan rather than silently choosing.
3. Claim/implement revalidates against current config and the remote
   (`lisa-implement/SKILL.md` Phase already validates the base branch; extend it to
   compare against the ticket's rendered plan). Legacy ticket with no plan: write the
   derived assumption onto the ticket as a comment, then proceed. Conflict with a
   human-confirmed environment or an existing PR base: stop under the existing
   confirmation rules (`lisa-implement/SKILL.md:112`).
4. Define the documentation/config-only carve-out where `Target Backend Environment`
   is intentionally absent (`runtime_behavior_change = false`): no branch plan required.

**Surfaces.** `plugins/src/base/skills/lisa-{jira,github,linear}-write-*/SKILL.md`,
the three validate skills, `lisa-implement/SKILL.md`; regenerated per-agent plugin
variants via `scripts/build-plugins.sh`.

**Done when.** A created runtime-work leaf shows a derived branch plan; a hand-edited
conflicting plan fails validation; a legacy ticket gets an explicit assumption comment
before work starts; config-only work is exempt; no path can silently target a different
environment branch.

### WU-E — secrets contract adoption audit + enforcement tightening

**Scope.** Host-side adoption of the existing `lisa-secrets-access` contract, plus the
enforcement gap the contract's prose already claims but code does not check.

**Steps.**
1. Audit Lisa's own skills/agents for direct keychain, `.env`, or provider-CLI reads
   that bypass `lisa-secrets-access`; fix call sites upstream.
2. Tighten checks in `scripts/doctor-secrets.mjs` (shipped copy under
   `plugins/src/base/skills/lisa-secrets-access/`): empty-note goes warn → **error**;
   add a well-formedness check against the documented note format (including the
   `tool:` line grammar). Red-leg tests: missing note, empty note, malformed note,
   valid note.
3. Run doctor against each host vault (the five BWS tenants); repair missing/malformed
   notes in the provider.
4. Only if discoverability is still weak after B ships: a one-line eager pointer to the
   skill — never a duplicate of its rules.

**Done when.** An agent needing `LINEAR_API_KEY` resolves it through the skill, reads
and follows the note, and never asks a human for the value when the bootstrap token is
present; doctor is green (at error severity) for every host vault.

### WU-G (part 1) — BDD e2e runner discovery + `exclusions` implementation

**Scope.** Close the fail-open gap: Lisa's v2 gate validates declared mappings but
never discovers test files (`bdd/parse.mjs` walks only `bdd/features/*.feature`), and
`exclusions` exists in the contract doc and template but is read by zero gate code.

**Fleet reality (audited 2026-08-12 across acmeorgd, acmeorgb, acmeorga origin
default branches).** The discovery WU-G wants **already exists downstream** — Lisa's
v2 gate (shipped 2026-08-12) was generalized from acmeorgd's single-file gate and
dropped it on the way. Every in-scope adopter (acmeorgd/frontend,
acmeorgb/frontend-v2, acmeorga/frontend; acmeorga/admin-frontend also carries
the monolith but is out of scope for this plan) runs a ~567-line schemaVersion-1
monolith `scripts/check-bdd-coverage.mjs` with:

- `inventoryPlaywright` / `inventoryMaestro` — real test-file discovery, but with
  hardcoded roots (`e2e/`, `.maestro/flows/` — subflows are structurally invisible),
  regex title-scraping that can't match template-literal titles, and hardcoded
  `RUNNER_FOR_PLATFORM` instead of reading `runnerPlatforms`.
- **Working, populated `exclusions`** (`{file, evidence?, reason}` — 3 entries at
  acmeorgd, 10 at gemini, 9 at acmeorga frontend) used to suppress unmapped-test noise.
- The fatal softness: unmapped specs are *reported* into the burndown doc, never
  failed — which is why 6 undeclared Playwright specs sit invisible at gemini and 1 at
  acmeorga on their default branches today, with checked-in reports stale against
  reality.

So step 1 below is an **upstreaming**, not an invention: adopt the downstream
inventory design, fix its known weaknesses, and make unmapped-or-excluded a hard
defect.

**Steps.**
1. Upstream the downstream discovery into the v2 gate (`expo/copy-overwrite/scripts/bdd/`,
   `check-bdd-coverage.mjs`; mirror to Rails copies), fixing the audited weaknesses:
   configurable per-runner roots/globs in the coverage-map schema (replacing hardcoded
   `e2e/` and `.maestro/flows/`, with subflow/helper directories explicitly
   representable), derive runner-platform pairing from `runnerPlatforms`, and handle
   or explicitly reject template-literal titles instead of silently mangling them
   (gemini's `${error.name}` exclusions are workarounds for exactly this).
2. Implement `exclusions` in the v2 gate with the downstream shape
   (`{file, evidence?, reason}`, whole-file when `evidence` omitted): a discovered
   spec must be represented by a mapping or an exclusion — a new enforced defect code,
   not a report line. Red-leg tests in `tests/unit/scripts/bdd-failopen.test.ts`
   style: unmapped spec fails, valid exclusion passes, stale exclusion (file gone)
   fails.
3. Preserve the checks `b71e494` hardened (mapping → existing scenario, stale-evidence
   credit removal, floor non-regression) — extend the existing regression suite, don't
   fork it.
4. Soften the stale-evidence wedge the fleet hit: at gemini, one renamed test title
   red-wedged `--write` entirely, so a new waiver couldn't even be recorded until an
   unrelated string was repaired. Stale evidence should stay a defect and lose
   coverage credit, but must not block regeneration of the artifacts that document it.

**Explicitly deferred to Phase 2:** whether obligation coverage is promoted from a
`lisa-verify` flow obligation to a gate defect, and any floor-mechanics change — both
sit behind D2 (WU-H).

**Done when.** A PR adding an undisclosed e2e spec fails the gate; deliberate
non-product tests pass only through an explicit exclusion; all pre-existing enforced
checks still pass their regression suite; a stale evidence string cannot block
artifact regeneration.

### WU-L — fleet BDD gate resync *(follows G part 1; fleet-side)*

**Scope.** No downstream adopter runs Lisa's **v2** gate — every fleet repo runs a
forked **v1** monolith. And **no repo runs the v2 gate in CI at all**: it went red on
gemini's default branch twice in four days unnoticed. The only CI enforcement anywhere
in the fleet is acmeorgd's, and it is the *v1* fork wired as a jest arm inside Quality
Checks; acmeorga runs its v1 fork by hand. Fixes are hand-carried between forks (the
wrapped-tag parser bug was fixed independently in acmeorgc `53f49f5`, acmeorgd
`efbafd8a`, gemini `b4ff482e1`, acmeorga `af4bad9a` + `e0106be`). This work unit ends
the fork family.

**Steps.**
1. v1 → v2 map migration (tool, not hand-editing): carry `mappings` (dropping or
   schema-adopting the local `level` field), `exclusions`, and `platformWaivers` —
   migrating waivers into v2's stronger shape (`owner`/`ticket`/`recordedAt`/
   `expiresAt` required). Downstream waivers today have **no machine-checkable ticket
   or expiry** — the IOU lives in prose, which gemini themselves flagged ("a waiver
   whose exit condition is a prose description is a waiver nobody can close").
   Preserve or explicitly retire `legacyRouteGate` blobs.
2. Replace each repo's local monolith with the Lisa-shipped modular gate via
   `lisa apply` / the `lisa-update-projects` batch; delete the fork.
3. Wire CI enforcement per repo: the shipped ruleset context
   (`expo/github-rulesets/bdd-coverage.json`) as a required check. Evaluate acmeorgd's
   jest-arm pattern (artifact byte-identity assertion, script-string pinning) for
   upstreaming as the mechanism rather than a one-off.
4. Adoption state per repo under `BDD_MODE`: acmeorgd enters `enforced` (100% with 51
   dated waivers), gemini and acmeorga/frontend enter `bootstrap` with their honest
   baselines (67.3% and 29.9%). acmeorga/admin-frontend is out of scope for this
   plan.
5. Harvest the strongest downstream inventions as upstream candidates, each traced per
   the standing upstreaming rule: acmeorgd's Maestro flake apparatus
   (`classify-maestro-failures.mjs` preamble-vs-product classifier, the
   known-intermittent-flows table with measured rates and A/B methodology, the
   elapsed-at-gate metric), the zero-coverage-arm detection (an arm that executed 0 of
   83 flows must not render as a mere failure — check overlap with Lisa's just-merged
   nightly-e2e-health work, #2416, before building anything), and gemini's
   `*_exclude_tags`-replaces-defaults footgun fix for `maestro-native-e2e.yml`.

**Done when.** Every adopter runs the unmodified Lisa v2 gate, in CI, as a required
check, with migrated maps validating clean; the fork monoliths are deleted; waivers
carry tickets and expiries; the upstream-candidate list is filed as tracked work.

### WU-F — UI without a Figma source

**Scope.** Implement/review rule: a UI change with no Figma source either syncs back to
Figma or carries a designated code marker.

**Steps.**
1. Pick the marker (proposal: `// DESIGN-SOURCE: none — not in Figma`) and add the rule
   to the implement/review path (`lisa-implement`, review skills); prefer sync-back
   when Figma access exists, marker as the exception.
2. Don't collide with host `figma-design-system.md` rules — extend or point at them.
3. Note the adjacent existing behavior: `lisa-tracker-source-artifacts/SKILL.md:90-92`
   already asks UI tickets to flag design-vs-code divergence as a ticket discussion
   item; the new rule covers the code side of the same event.

**Done when.** Review fails closed when a UI change has neither a Figma reflection nor
the marker.

### WU-I — codex_hooks cleanup on hosts

**Scope.** Operational only — Lisa's migration already exists and is tested
(`src/codex/settings-installer.ts:341-369`, tests at
`tests/unit/codex/settings-installer.test.ts:84,101`).

**Steps.** Run current `lisa apply` across known hosts (piggyback on the next
`lisa-update-projects` fleet batch); then audit only user-level / out-of-ownership
Codex configs for leftover `codex_hooks`. No new code.

**Done when.** No known host or user config sets `codex_hooks`; existing migration
tests stay green.

---

## Phase 2 — decision-dependent build

### WU-A — rules architecture and `PROJECT_RULES` migration *(needs D1)*

**Steps.**
1. Create the canonical host-rules directory per D1 with recorded ownership semantics:
   host-authored content vs Lisa-managed content, and how each agent receives host
   rules exactly once (no double-loading via both SessionStart injection and native
   rules dirs).
2. Retire the single-file default: change `DEFAULT_PROJECT_RULES_FILE`
   (`src/core/project-config.ts:36`), the sync registry entry
   (`src/sync/registry.ts:145`), the create-only template
   (`all/create-only/.claude/rules/PROJECT_RULES.md`), learnings-audit paths, and
   `plugins/src/base/rules/reference/config-resolution.md`.
3. Migration for existing hosts: extend the existing bounded-edit machinery in
   `src/core/instruction-files-migration.ts` (the same code that strips the legacy
   `LISA_RULES` block and reconciles the agy learnings-bridge) with an idempotent
   Lisa-managed pointer block in `AGENTS.md` — add/update the block without touching
   surrounding host prose. Repeated apply/doctor runs are no-ops.
4. Sweep stale docs in the same PR: `wiki/documentation/overview.md` still claims
   debrief writes to `PROJECT_RULES.md`.
5. Parity proof: tests demonstrating documented delivery on Claude, Codex, Cursor,
   OpenCode, Copilot, and agy. If D1 keeps agy's exception, the test asserts the gap
   rather than pretending identical delivery.

**Done when.** No template or default points at `PROJECT_RULES.md`; new and existing
hosts get the pointer through the migration; parity tests encode the D1 outcome.

### WU-B — eager operating pack *(needs A; D3 folded in)*

**Scope.** Short always-on rules in `plugins/src/base/rules/eager/`, delivered through
the existing fan-out (`scripts/build-plugins.sh`, per-agent generators, SessionStart
`inject-rules.sh`), reaching rules-less agents via the WU-A `AGENTS.md` pointer.

**Contents (one small file each, or grouped where natural):**
- **local-ci-first** — CI e2e failures are reproduced locally with the same config,
  fixed there, then re-pushed; CI is not a debugger.
- **dont-wait / blocked≠waiting / parallel-plans** — poll status yourself (~5 min) while
  the session is active; "blocked" means physically cannot proceed; plan phases run in
  parallel unless stated. Factory `human_needed` vocabulary is explicitly untouched.
- **status-format** — what changed / what's blocked / what needs a decision; plain
  language; decision + recommendation + ramifications; wording aligned with the
  existing non-technical-operator gate obligation.
- **safe-to-close** — every update ends with `Safe to close: yes/no — <reason>`.
- **do-it-now** — if the factory is allowed to do it, do it now; if an exterior human
  gate applies, do the allowed part and name what waits.
- **wiki-on-demand** — the D3 softening of `wiki-knowledge-source`, plus the packaging
  fix (rule conditioned on the wiki plugin, or `lisa-wiki-query` moved to base).
- **secrets pointer** — one line pointing at `lisa-secrets-access`; no duplication.
- **learnings one-pager** — the six-rung ladder table with the WU-A rules path named as
  the EAGER-RULE rung; confirm `lisa-learnings-audit` is an offered automation.
- **Candidates from the fleet survey** (evaluate, don't auto-include): acmeorgd
  backend's mutation-proven-guard rule (introduce the exact regression, verify exactly
  one test fails, revert), its "never fabricate red-state evidence — reconstruct in a
  throwaway detached-HEAD worktree" rule, and gemini's branch-position check
  (`git rev-list --count HEAD..origin/<default>` before interpreting any diff).

**Done when.** Pack ships in all per-agent variants; agy delivery matches D1; a session
transcript demonstrates the waiting/parallel/safe-to-close behaviors.

### WU-K — downstream rules cleanup *(needs A; fleet-side)*

**Scope.** Every canonical downstream repo currently carrying `.claude/rules/` gets
migrated to the WU-A architecture and cleaned up. Inventory (scanned 2026-08-12; all
also have `PROJECT_RULES.md`):

| Repo | Extra rule files beyond PROJECT_RULES.md |
|---|---|
| acmeorgd/{frontend, logoman-frontend, acmeorgd-backend, acmeorgd-infrastructure} | — |
| acmeorgb/ask-gemini | — |
| acmeorgb/backend-v2 | 9 topic rules: ci-github-workflows, cross-repo-infrastructure, dev-deploy-remote-verification-timing, graphql-pagination-performance, graphql-validation-rules, migration-workflow, observability-xray, test-user-auth, typeorm-lambda-bundle-traps |
| acmeorgb/frontend-v2 | 7 files incl. **PROJECT_LEARNINGS.md inside the auto-loaded rules dir**, cross-repo-dependencies, design-to-code-tickets, figma-design-system, jam-bug-triage, screen-size-not-device-type, use-the-design-library |
| acmeorgb/infrastructure-v2 | — |
| acmeorga/{backend, infrastructure} | — |
| acmeorga/frontend | design-system, use-the-design-library |
| acmeorgc/{backend, frontend, infrastructure} | — |

**Survey calibration (2026-08-12).** The fleet's rule files were rough-classified
during the commit survey, and the split validates the ladder approach: acmeorgd
frontend's 838-line file is ~half ESLint-rules-as-prose (~32 machine-checkable, ~22
wiki-shaped, ~8 eager); acmeorgd backend's 48-line file is the opposite genre (pure
provenance-tagged traps, ~26 wiki-shaped); acmeorga backend runs ~16/8/18 with
accreted near-duplicates; acmeorga frontend is mostly product-spec tables that belong
in a wiki; three repos (acmeorgd infra, acmeorga infra, gemini infra) are empty
templates — and acmeorgd infra's traps were written into `AGENTS.md` then deleted
wholesale (`4058e71`) with no gate noticing the knowledge loss. Three incompatible
conventions for the same file, zero shape enforcement. Several "rules" are actually
Lisa bug reports (gemini infra `945b39c`, `b9b2ef3`) → route those to WU-M, not the
ladder.

**Steps.**
1. Per repo (via the `lisa-update-projects` batch flow, after WU-A ships): route every
   existing rule file through the six-rung ladder — machine-checkable content becomes
   lint/hook (upstreamed to the Lisa template when the pattern is generic, per the
   standing upstreaming rule), wiki-shaped knowledge moves to the project wiki,
   genuinely eager operating rules move to the WU-A canonical rules directory, and
   embedded Lisa bug reports become WU-M tickets. `PROJECT_RULES.md` itself is the
   human decree surface, so reclassifying its content rides human-gated tickets (the
   gardener model), not silent rewrites. Preserve generated-rule provenance (the
   acmeorga/gemini "generated from RFC — edit the RFC" pattern) rather than flattening
   those files into prose.
2. Special case — `acmeorgb/frontend-v2` has `PROJECT_LEARNINGS.md` *inside*
   `.claude/rules/`, i.e. the machine ledger eager-loaded into every session, which is
   exactly what the learnings contract's bounded projection exists to prevent.
   Relocate it to the ledger path (`.lisa/PROJECT_LEARNINGS.md` or the configured
   `learnings.file`), merge histories if both exist, and ensure nothing re-creates it
   under `.claude/rules/`.
3. Delete emptied files; what remains of `.claude/rules/` follows whatever D1 decides
   about Claude-native delivery of the canonical pack.
4. Design-system rules (`figma-design-system`, `design-system`,
   `use-the-design-library`) stay host-owned but are wired to WU-F's marker rule
   rather than duplicated.

**Done when.** No downstream repo carries `PROJECT_RULES.md`; every former rule file is
routed (with human sign-off where the decree surface was touched); the frontend-v2
learnings ledger lives only at the ledger path; fleet batch PRs merged.

### WU-D — close non-ready filing paths *(needs D4)*

**Steps.**
1. Every Lisa call site that files a complete defect found during other work passes
   explicit `build_ready: true` (via `lisa-track` / `lisa-tracker-write`); no call site
   relies on omitted defaults.
2. Normalize omitted `build_ready` per D4 across
   `lisa-{jira,github,linear}-write-*` (today: JIRA not-ready, GitHub/Linear ready;
   GitHub's validator even documents omitted→true normalization — that changes with D4).
3. Writers treat "filed but not ready and not human-gated" as an incomplete handoff:
   require either `build_ready: true` or an explicit human-gate marker.
4. Exploratory-qa keeps its `ready=false` default per D4, now documented as the named
   human-gate exception rather than an inconsistency.
5. Optional sweep: `lisa-repair-intake` learns to surface recently filed tickets with
   neither the ready role nor a human-gate marker.
6. Fleet evidence to fold in: fix the Linear `workflow.ready` → `Todo` mapping (WU-M
   row; acmeorgd `a8899a17` — "ready" must mean a human flipped it, never the default
   new-issue state), and add gemini's claim-time "already implemented →
   verify-and-close" branch plus the "two failed attempts → Blocked" valve to
   build-intake (WU-N delegates them here).

**Done when.** A ticket like SE-6799 (real defect found beside other work) is claimable
by build-intake in the next cycle without a human flipping status, and no provider
treats omission differently from the others.

### WU-H — ratchet policy execution *(needs D2)*

**Steps (assuming recommended D2: absolute floors + per-family no-regression
replacements).**
1. Inventory the families: BDD `coverageFloor` (+`coverageFloorBaseline` approval
   path), `threshold-ratchet-families.mjs` coverage family, Stryker `thresholds.break`
   + mutate-list.
2. For each family removed from "creep upward" duty, ship its named replacement
   invariant first, then remove the ratchet in the same release. BDD's replacement per
   the source doc: an accepted mapping cannot disappear unless its scenario is validly
   retired, and every new frontend behavior is mapped or waived.
3. Brownfield migration per family: what a mid-adoption project's committed floor and
   burndown become under the new policy.
4. Update health checks, bootstrap docs, and tests.

**Fleet reality.** No downstream adopter has any `coverageFloor` — the BDD floor and
its baseline ratchet exist only in Lisa's template today (the fleet is on the
pre-ratchet v1 gate; see WU-L). D2's brownfield policy therefore has to cover
*first-time* floor adoption through the WU-L migration, not just changes to floors
already in force.

**Risk note.** The threshold-ratchet checker enforces "thresholds may only tighten"
across three layers (PostToolUse hook, pre-commit, CI vs merge-base), and lowering
anything requires a `thresholdRatchet.allow` entry merged first. Changing the checker
itself is a Chesterton's-fence case: sequence the replacement invariant → allow entry →
mechanism change, never the reverse. If D2 lands as "keep ratchets," WU-H collapses to
a decision record plus host-project guidance.

**Done when.** Either ratchets are retained by recorded decision, or every removed
family has a named absolute gate + no-regression replacement with a tested brownfield
path; no family becomes easier to regress accidentally.

### WU-G (part 2) — obligation-coverage promotion *(needs D2/H outcome)*

If D2's replacement invariants move "every required obligation mapped or waived" from a
`lisa-verify` flow obligation into the gate's enforced defect set, implement the new
defect code here with red-leg tests. Otherwise record explicitly that it stays a flow
obligation.

### WU-J — substrate-precedence contract *(needs D6)*

**Steps.**
1. Author one shared vendor-neutral precedence contract (the `leaf-only-lifecycle` /
   `repo-scope-split` precedent: one shared slug, never divergent per-skill prose):
   configured-provider token/CLI substrate first when its bootstrap is available and
   identity-matched; interactive MCP fallback; identity-match mandatory everywhere;
   the Atlassian write-tenant-safety rationale generalized into the contract.
2. Re-order tiers in `lisa-linear-access` (today MCP-first) and `lisa-notion-access`
   (today MCP-first) to cite the contract; `lisa-atlassian-access` reads move to
   token-first with acli as identity-matched fallback (writes already comply).
3. `lisa-secrets-access` stays the chokepoint feeding the token path; the `tool:` note
   line already declares which CLIs a credential drives.
4. Verify live: a Bitwarden-configured project with the bootstrap token present
   resolves Linear/Notion/Atlassian operations without touching browser auth; pulling
   the token restores MCP fallback.

**Scope note — which skills the contract binds.** Eight `lisa-*-access` skills exist,
and an audit of their current text (2026-08-12) shows the MCP-first problem is wider
than the three skills step 2 names. The contract binds the **six multi-substrate**
skills, all of which resolve MCP before their token/CLI path today and so all need
re-ordering, not just citing:

- `lisa-linear-access`, `lisa-notion-access`, `lisa-atlassian-access` — named in step 2.
- `lisa-sentry-access` (MCP → `sentry-cli` → `SENTRY_AUTH_TOKEN` REST),
  `lisa-posthog-access` (MCP → `POSTHOG_PERSONAL_API_KEY`), and `lisa-jam-access`
  (MCP → `JAM_PAT` CLI) — **add these to step 2's re-ordering work.** They were
  missed in the first pass; the headless-session failure mode is identical.

Two are **explicitly out of scope**, and each carries a one-line "out of scope for the
substrate-precedence contract, because …" note so the exclusion is auditable rather
than a silent omission:

- `lisa-secrets-access` — it *is* the token source feeding every other skill's tier 1,
  so it has no substrate tier of its own to order.
- `lisa-sonarcloud-access` — single substrate (the official SonarQube MCP server,
  already authenticated headlessly from `SONARQUBE_CLI_TOKEN`), so there is no second
  tier to prefer and no browser-auth failure mode to fix.

**Done when.** All six multi-substrate `*-access` skills resolve substrates in the
contract's order, both excluded skills carry their recorded exception note, and both
live checks in step 4 pass.

---

## Fleet survey inputs (2026-08-12)

A commit survey since ~2026-05-15 across the acmeorgd, acmeorgb, and acmeorga
workspaces (origin default branches) surfaced two bodies of material beyond the BDD
findings already folded into WU-G/WU-L: **bugs in Lisa itself** that downstream repos
have been patching around, and **fleet inventions** Lisa should absorb. They feed the
two work units below plus targeted enrichments noted inline in earlier units.

### ⚠️ Meta-finding (2026-08-12): the fleet's evidence lags current Lisa

**Three** audited rows have now turned out to be **already fixed upstream** once
checked against current source — including both High rows below:

- The `skip_jobs` substring bug was fixed in `1ced328b7` (2026-07-24) — *before* the
  downstream rule file documenting it was written.
- The learnings-ledger scaffolding bug is fixed (template source is
  `all/create-only/.lisa/PROJECT_LEARNINGS.md`, config validation rejects eager trees,
  apply/doctor relocate a legacy ledger), and merge-hostility is handled by a shipped
  union merge driver, `.gitattributes` mapping, write lock, and conflict diagnosis.
- The **Linear `workflow.ready` → `Todo`** mapping is fixed:
  `LINEAR_WORKFLOW_DEFAULTS.ready` is `"Ready"` (`src/sync/lifecycle-defaults.ts:65-71`).
  The residual risk is **configuration, not code** — a project pinning
  `linear.workflow.ready` to a default-on-create state reproduces the corruption
  locally — so WU-M carries a `lisa-validate-tracker-mapping` guard instead of an
  adapter fix.

**Implication, and it reframes the fleet work:** much of the downstream pain is *"the
repo has not updated"*, not *"Lisa is broken."* The corollary is that stale downstream
rule files actively mislead — they document bugs Lisa already fixed, so WU-K must
**retire** such files rather than promote their content through the ladder.

**Standing instruction for every remaining WU-M row: verify against current source
before fixing.** Report "already fixed" as a valid, valuable outcome. It also raises
the priority of the fleet-update work (WU-K/WU-L) relative to upstream bug fixing.

Note this does *not* make the audit worthless — the two "already fixed" rows still
produced real hardening (a write-boundary guard and a doctor check that did not exist),
and the live filtered-dispatch exposure was found by the same pass.

### Bugs in Lisa surfaced downstream → WU-M

| Bug | Evidence | Severity |
|---|---|---|
| ~~`quality.yml` `skip_jobs` uses `contains()` substring matching~~ — **REFUTED 2026-08-12.** Already fixed upstream in `1ced328b7` (2026-07-24, #2028): every gate in `quality.yml` and `quality-rails.yml` uses the sentinel-comma idiom `contains(format(',{0},', inputs.skip_jobs), ',test,')`, which is exact token matching. Regression tests exist (`tests/integration/quality-workflow.test.ts:154-183`, including the explicit `test:e2e` case) and Lisa already ships its own `check-skipped-required-checks.mjs`. **The downstream rule file is stale — WU-K retires it rather than promoting it.** Two residual gaps filed as follow-ups: no shipped workflow invokes `check:skipped-required-checks`, and whitespace in `skip_jobs` is not trimmed (fails closed) | gemini backend-v2 `ci-github-workflows.md` (SE-5511, PR #2713), acmeorgd `check-skipped-required-checks.mjs` (TUN-402) | ~~High~~ → **not a bug** |
| Enforcement-guard scripts are create-only on install, so a Lisa release fixing a guard never reaches installed repos — acmeorga had to delete-and-recreate to pick up the #2374 fail-open fixes | acmeorga `863ffbf3` commit body | **High — security fixes don't propagate** |
| Lisa 2.232.0 scaffolded `PROJECT_LEARNINGS.md` into `.claude/rules/` (auto-loaded, eager), and the JSONL-in-fenced-block format is merge-hostile: two branches wrote off the same empty blob, the merge took the empty side, **19 captured learnings destroyed** with no error | gemini frontend-v2 (`9d61ce1b8`, `e6a53af3c` vs `origin/dev`) | **High — silent data loss** |
| `automation-run-record.mjs` trims the live ledger to 50 records at append — at observed cadence the loop's audit trail dies in under a day | acmeorgd `check-ledger-archive.mjs` (TUN-369) | Medium |
| Ledger append rebuilds records from a fixed whitelist, destroying unknown fields (`standing_rulings`) on the live copy | acmeorgd TUN-566; filed as lisa#2395 | Medium (filed) |
| `lisa sync` `fillMissing` forges partial config keys from defaults with no `_lisaSync.populated` provenance — byte-identical to human ratification | acmeorgd `check-lifecycle-label-config.mjs` (TUN-405) | Medium |
| Linear adapter mapped `workflow.ready` → `Todo`, where Linear puts brand-new issues — "ready" stopped meaning "a human flipped this"; 12 of 20 claimable issues were never marked ready | acmeorgd `a8899a17` | Medium — feeds WU-D |
| Generated `reusable-claude.yml` callers pass an input the reusable workflow never declared → instant `startup_failure`; 100/100 recent runs failed, zero successes, nothing surfaced it (claude.yml is deliberately never overwritten) | acmeorga backend `48339607`, infra `97f7bea` | Medium |
| Postinstall bootstrap discards stderr (`2>/dev/null`) — a failed bootstrap is indistinguishable from success | acmeorga infra `c373ba1` | Medium |
| Worktree installs corrupt the main clone (symlinked `node_modules`; postinstall rewrites package.json to literal placeholders) — independently discovered three times at gemini, plus watchman/jest/metro breakage from accumulated agent worktrees at acmeorga and `.worktrees` gitlink pollution at acmeorgd | gemini learnings ledger (`scope:upstream-candidate`, "needs a wrapper guard, not a rule"); acmeorga `1dbec71d`→`95298e16`, `abeeb45a` | Medium |
| Lisa-vendored artifacts fail host repos' own gates (`lisa-mutation.mjs` vs prettier ×3 repos, vs Sonar coverage ×1) — four independent workarounds | acmeorga `562a805e`, `23314ed`, `765d8a33`, `199d0c6` | Low |
| `.oxlintrc.json` relative `extends` breaks in worktrees without `node_modules`; bootstrap `bun install` creates a tracked `bun.lock` in npm-only repos | gemini infra `945b39c`, `b9b2ef3` | Low |
| Pre-commit has no first-class project-extension slot — project guards below `# END: AI GUARDRAILS` are silently deleted wholesale by the next apply; acmeorgd pins the placement with tests. Pre-push already has `.local`/`.verify` slots | acmeorgd TUN-367/369/405 hook comments | Medium |

### Fleet inventions to absorb → WU-N (unless already assigned to another unit)

- **False-green / zero-coverage family** (the most-repeated theme fleet-wide, fixed ≥8
  times at acmeorgd alone): "a suite that ran nothing must not read as green."
  **#2416 overlap check completed 2026-08-12** — results below; scope is now precise.
- **Loop memory**: acmeorgd's `standing_rulings` field + `standing-rulings.mjs`
  read-side — the intake loop wrote records it never read and re-litigated its own
  rulings (probes six and seven of an answered question).
- **Ledger durability**: acmeorgd's archive mirror (until the WU-M trim fix lands, then
  possibly retired).
- **PII scan on agent artifacts** (`.lisa/`, `docs/`, `.claude/`) — a surface neither
  gitleaks nor GitGuardian covers; Lisa's own loops leaked a founder's email twice.
- **Deploy-verification timing**: gemini's "the deploy run must be the workflow named
  X, built from the merge SHA, Deploy job success" rule — agents declared success off
  an adjacent 71-second auto-update run. Extends `lisa-drive-pr-to-merge`'s
  zero-deploy-run check.
- **Claim-time "already implemented" guard**: gemini's sprint-loop checks
  `git log --all --grep` + PR search before implementing a Ready ticket and switches
  to verify-and-close — agents ship without transitioning, so Ready ≠ unimplemented.
  Plus its "two failed attempts → Blocked, stop the loop" valve. Both feed
  build-intake/implement.
- **Retry policy by side-effect class**: acmeorga's money-tier `retries: 0` after a
  nightly moved 4×$10 + 4×$250 of sandbox money through whole-body retries — "a flake
  in this tier gets diagnosed rather than replayed" — with a guard test that asks
  Playwright to resolve its own config and asserts zero retries for every project
  collecting a money spec. Retry policy must be a function of side-effect class, not a
  global number; belongs beside `.lisa.config.json` `exploration.mutation`.
- **Generated-rule-file provenance**: acmeorga's and gemini's design-system rules are
  generated from an RFC with "edit the RFC and regenerate" headers, plus a graded
  escape-hatch ladder (amend the system → commented waiver → budgeted `UNSAFE_style`).
  A reusable pattern for WU-A's managed-vs-host-authored split and WU-F.
- **Guard-authorship discipline**: acmeorgd backend's "mutation-proven guard" rule —
  introduce the exact regression the guard prevents, verify exactly one test fails,
  revert (born from a guard that passed 50 tests while letting the regression
  through). Candidate WU-B eager rule or guard-authoring skill step.
- **Vendor-neutrality gap for host-local governance**: gemini flipped JIRA→Linear in
  five days and every local skill/rule still hardcodes JIRA (`sprint-loop`,
  `design-to-code-tickets.md`, `jam-bug-triage.md`). Host-local artifacts have no
  tracker-abstraction hook; at minimum doctor should flag vendor-named references
  when `tracker` changes.
- **Empirical backing for D2 (ratchets)**: the fleet's creeping ratchets generate
  commit spam and churn — 14 PRs to move maxLinesPerFunction 28 lines (acmeorga),
  ~12 baseline-churn commits (gemini), 128 budget/ratchet commits with a
  breach→raise→ratify→correct cycle (acmeorgd). And acmeorga `44891559` already
  executed item 11's philosophy unprompted: retired its local ratchet + generated
  seal-ledger into deterministic ESLint/ast-grep rules with shrink-to-zero
  allowlists. D2's recommendation is validated in the field.

### #2416 overlap check — results (2026-08-12)

**Already shipped; do NOT rebuild.** Lisa's version is stricter than the fleet's on
several axes and its rationale is better argued:

- Red-nightly-blocks-merges, fail-closed well past `conclusion == failure`
  (`cancelled`/`skipped`/`neutral`/stale/wrong-branch/renamed-job/API-error all block).
- The bypass deadlock arm — one audited label, **no self-bypass**, maintainer
  allowlist, mandatory ticket+reason, 72h source-constant ceiling, merge-time reaper,
  `bypassed` as a distinct audited verdict, and explicitly **no admin-merge-past-red**.
- Job-level gate reading (`match.mode: job` / `job_pattern`, nested-reusable name
  composition, zero-match-is-an-error), plus the inverse `check-skipped-required-checks`
  guard the fleet lacks. #2416 even deleted `expo/github-rulesets/playwright.json` for
  being a required context CI unconditionally skipped.
- Time-boxed bootstrap with an enforced ceiling — a deliberate rejection of acmeorga's
  unbounded forever-bootstrap, which `docs/nightly-e2e-gate.md:186-187` names as the
  anti-pattern.

**Genuinely new — absorb, in this order:**

1. **Filtered/partial-dispatch exclusion — this is a LIVE EXPOSURE, not a gap.** The
   shipped nightly caller has a `platform` dispatch picker; `platform: android` skips
   the iOS job while the run still concludes `success`, and the default suites table
   reads it with `{"mode":"run"}` — so the gate goes green with half the fleet
   untested. `COUNTED_EVENTS` treats a `workflow_dispatch` identically to a cron run,
   and nothing inspects run inputs, matrix completeness, or `include_tags`. Cheapest
   high-value fix in the list; **treat as a WU-M bug row, not a feature.**
2. **Zero-coverage as a distinct blocking state.** Needs a fourth suite state beside
   `pass|fail|unknown`, must block even when the run concluded `success`, and must
   distinguish "count unavailable" from "count zero". Design conflict to resolve
   honestly: `docs/nightly-e2e-gate.md:33-38` **explicitly refuses artifacts as a
   result source** (no Node zip reader; artifacts expire) — but acmeorgd's mechanism
   carries the count in the artifact *name*, read from the artifacts *list* in one API
   call, which defeats both objections. Absorbing it means amending that normative
   section plus the truth table and its per-row tests.
3. **One-open-tracking-issue-per-suite**, refreshed nightly, auto-closed on green.
   Wholly absent — the guard's own bypass report references a tracking issue Lisa never
   creates (`check-nightly-e2e-health.mjs:970`). Bring the non-cancelling concurrency
   group for the *filing* job, and gate filing on "this was a full, unfiltered run"
   (depends on item 1).
4. **Per-suite bootstrap / first-seen grace.** Bootstrap is workflow-global today, so
   adding a suite to an armed repo hard-blocks every PR until that suite's first green
   nightly; the only outs are un-arming every other suite or burning a bypass. Small
   schema addition, closes a real wedge.
5. **Maestro flake classification + known-intermittent registry.** Architecturally
   separate — belongs on the JUnit-producing side (`maestro-native-e2e.yml` already
   emits XML nobody reads), so scope it independently of the gate.

### WU-M — Lisa bug burn-down from the fleet audit *(Phase 1; decision-free)*

**Verify every row against current source before fixing it, and ticket only the rows
that survive** — the meta-finding above applies here first. The `skip_jobs` row is
already **refuted and closed**: fixed upstream in `1ced328b7` (2026-07-24, #2028), so
it gets no fix ticket and must not be promoted downstream; its two residual gaps are
filed separately as #2426 and #2427, and WU-K retires the stale downstream rule file
that still documents it. That leaves **two** High rows, not three.

For each surviving row file one tracked ticket (checking first which are already
filed — #2395 is; the guard-delivery bug may overlap an existing issue),
fix in severity order, and where a downstream repo built a compensating guard
(`check-ledger-archive`, `check-lifecycle-label-config`, `check-skipped-required-checks`,
`check-lisa-pii`), evaluate absorbing the guard upstream as the regression test for
the fix. The two surviving High rows are candidates to pull ahead of everything else
in this plan. **Done when** every row is fixed, ticketed, or recorded as refuted with
the upstream commit that already fixed it, and the fixed ones reach installed
repos — which itself depends on fixing the guard-delivery row.

### WU-N — absorb fleet inventions *(Phase 1 start; some pieces land with A/B/D/L)*

Work the inventions list top-down: false-green family (after the #2416 overlap
check), loop memory, PII scan, deploy-verification timing, claim-time
already-implemented guard + two-failures valve, retry-by-side-effect-class, pre-push
style extension slot for pre-commit (paired with the WU-M row). Each absorption
follows the standing upstreaming rule: trace to the Lisa template source, land with
tests, note the downstream origin. **Done when** each invention is absorbed, declined
with a recorded reason, or delegated to the unit that owns it (flake apparatus →
WU-L; rules provenance → WU-A/K; ratchet evidence → D2/H).

---

## Execution model — one orchestrator, delegated implementation

The plan is executed by a **single long-lived orchestrator session whose only job is
sequencing, dispatch, and integration** — it never implements anything itself. All
reading, coding, testing, and verification happens in subagents so the orchestrator's
context holds the plan, not the work product.

**Orchestrator responsibilities (and nothing else):**
- Hold the phase/dependency graph and decide what dispatches next.
- Spawn one subagent (or a small parallel set) per work-unit slice, each with a
  self-contained brief: the WU section text, the target file paths, the done-when, and
  the constraint that the *final report* must be a compact summary (what changed,
  what's proven, what's blocked) — never file dumps or transcripts.
- Record durable state in files, not context: progress notes in this plan's
  `## Sessions` table (and per-WU checkboxes if useful), so a compaction or restart
  loses nothing. Never rely on orchestrator memory for assignment state — re-read the
  task list after any compaction (the standing agent-team rule: dual owner storage in
  `metadata.owner`, TaskList before assigning).
- Integrate: read subagent summaries only, resolve cross-WU conflicts, dispatch
  follow-ups, and surface the Phase-0 decisions and human gates upward.

**Subagent granularity:** one work unit is usually several dispatches, not one — e.g.
WU-M is one subagent per bug row; WU-K/WU-L are one subagent per downstream repo
(inside the `lisa-update-projects` worktree flow); WU-B is one subagent per rule file
plus one for fan-out verification. Review and verification run as separate subagents
from implementation (the standing parallel-review pattern: product / coderabbit /
local-review / quality concurrently, one integration task gated behind all of them).

**Context-overflow rules:**
- Subagents write anything bulky (audit tables, migration inventories, test output)
  to files under the repo or scratchpad and return the *path plus a five-line
  summary*; the orchestrator never pulls bulk content into its own context.
- A subagent that needs prior context gets it as a file reference (this plan, a WU
  brief file), never as pasted history.
- If the orchestrator's context grows anyway, it can be replaced: everything needed to
  resume is this plan file plus the Sessions table — that is the test for whether
  state was externalized properly.

The natural harness for each implementation dispatch is `/lisa:implement` (which
assembles its own inner team per work item) or a direct `lisa:builder` /
`lisa:bug-fixer` agent for small slices; the orchestrator itself is just the session
that owns this plan.

## Sequencing summary

```text
Phase 0:  D1 ─┬─ D2 ─ D3 ─ D4 ─ D5 ─ D6        (one decision session + records)
              │
Phase 1:  C   E   G1   F   I   M   N           (parallel, start now; M's three High
              │                                 rows jump the queue)
Phase 2:  A ──▶ B                              (A first; B is the pack it delivers)
          A ──▶ K                              (fleet rules cleanup rides A's migration)
          G1 ─▶ L                              (fleet gate resync rides the v2 gate)
          D4 ─▶ D                              (normalization + explicit call sites)
          D2 ─▶ H ─▶ G2                        (invariants before ratchet removal)
          D6 ─▶ J
          M(guard delivery) ─▶ every fleet-side fix actually reaching installed repos
```

Fleet rollout rides the existing `lisa-update-projects` batch flow after each Lisa
release; WU-E vault repair and WU-I host runs piggyback on the same batches.

## Out of scope

- acmeorga/admin-frontend entirely (owner call, 2026-08-12) — its BDD monolith,
  legacy pre-Lisa agent/command set, and onboarding state are all excluded from
  WU-K/WU-L fleet passes.
- Item 14 beyond D5 (no new mutation/property workflow checkpoint by default).
- Item 16 (`LINEAR_API_KEY` via bws) — covered by existing capability + WU-E audit.
- Item 17's Lisa-owned migration — already shipped and tested; only WU-I's host runs.
- Any second taxonomy, second provider-note contract, or second precedence prose.

## Sessions

Umbrella work item: **CodySwannGT/lisa#2423**. Each work unit files its own issue.

| Date | Session | Work |
|---|---|---|
| 2026-08-12 | orchestrator | Plan authored from the revised improvement notes |
| 2026-08-12 | orchestrator | **Phase 0 complete** — four decision records written, wiki index updated, PR #2425 (auto-merge on) |
| 2026-08-12 | subagent | WU-M row 1 (`skip_jobs`) **REFUTED** — already fixed in `1ced328b7`; no PR. Residual gaps filed as #2426, #2427 |
| 2026-08-12 | subagent | WU-M row 3 → PR #2434 (write-boundary guard + doctor stray-ledger check); follow-up #2435 |
| 2026-08-12 | subagent | WU-M row 2 → PR #2436 (**confirmed**; `applyNonInteractive` returns `stale` under `skipGitCheck`) |
| 2026-08-12 | orchestrator | Dispatched N-1 (filtered-dispatch exposure), G1, J; adopted existing PR #2410 for N-2 rather than duplicating it; spawned a standing `pr-shepherd` to drive stalled PRs |

**Standing note on merge throughput:** every PR lands in `BLOCKED` even with all
checks green, because branch protection requires every CodeRabbit thread resolved and
a stale `CHANGES_REQUESTED` dismissed. Implementation agents open PRs but do not
shepherd them, so a dedicated shepherd is required or PRs accumulate unmerged. PRs
also go `DIRTY` continuously as siblings merge — expect a rebase per PR per landing.

**⚠️ Release starvation at this merge cadence — CONFIRMED, not theoretical.** Rapid
consecutive merges cancel in-flight Release runs, so **merged + merge-ancestor is not
proof a change published**. Measured 2026-08-12: the Release run for #2452's merge SHA
`953b4f4a` was **cancelled**, as were the runs for `2f3daaae`, `08ebcc2c`, and
`89de283a`. Neither `v2.352.0` nor `v2.353.0` contains #2452.

**This is recoverable, not lost.** semantic-release publishes from `main`'s HEAD, so
the *next* successful Release run from any later SHA sweeps up every unreleased commit
beneath it. The correct response is to verify, and wait or re-run — never to assume.

Verification recipe (use this, not ancestry-of-main):
```
SHA=$(gh pr view <PR> --json mergeCommit --jq '.mergeCommit.oid')
git merge-base --is-ancestor "$SHA" <tag>   # exit 0 ⇒ the tag carries it
```
Gates real work: **K** needs a release carrying #2444 (`v2.352.0` does), **L** needs
one carrying #2452.

**RESOLVED 01:51 — `v3.0.0` is published and contains #2452.** The starvation
self-healed exactly as predicted: a later successful run swept up the unreleased
commits beneath it. **Note the MAJOR bump** — v2.x → v3.0.0, triggered by WU-D
(#2453, `feat(tracker)!`) whose `BREAKING CHANGE:` footer semantic-release correctly
honored. Any fleet repo updated from here crosses a major version whose ticket
lifecycle changed: **omitted `build_ready` now means NOT ready** on GitHub and Linear,
so a caller relying on the old implicit-ready default now files into the backlog
instead of the build queue. K and L must check each repo for such callers before
bumping it.

### Integration verification of the merged base (2026-08-12, `main` @ `5f1613f67`)

**Verdict: GREEN — safe to keep merging onto this base.** Seven merges verified in
combination, not six (#2444 also touches the apply path). Full local suite
10,221/10,221 tests, coverage thresholds met, `typecheck` / `lint` / `knip` /
`check:plugins` / `check:rules-pairing` / `plugin-parity-drift` (0/5) /
`check:upstream-evidence-manifest` all pass.

All four interaction risks verified, including the two that mattered most:
- **Doctor ordering held** — `Instruction files canonical?` still runs before
  `Single learnings ledger?`, repair-then-report observed live. #2437's secrets check
  is a *skill-side script*, not in the CLI check array, so the two surfaces are
  disjoint and neither can mask the other.
- **#2436's apply split verified on a real host repo** via the postinstall path:
  Lisa-owned `scripts/lisa-hooks/block-no-verify.sh` refreshed unprompted and backed
  up to `.lisabak/`, while host-edited `tsconfig.json` and `.gitignore` reported
  `Out of date, not updated` with edits preserved. Exactly the intended split.

**Live operator impact confirmed:** a repo with no secrets configured early-returns
clean (exit 0), but repos that *do* set `secrets.provider` with noteless secrets now
exit 1 — the five BWS tenants will newly fail `doctor`.

**Both defects FIXED — PR #2464** (issue #2458). Defect 1: the reconciler was already
idempotent; the *committed bytes* simply weren't the reconciled bytes, so the fix was
to commit the block **generated by running `doctor`, not hand-authored**, with the
instruction-file guard override (`LISA_ALLOW_INSTRUCTION_FILE_WRITE=1`) scoped to a
single `git commit` invocation — not exported, not in config. Defect 2's exemption is
two independent guards and no filename blacklist: a relative specifier must resolve
*exactly* onto a shipped variant of the same destination **and** `isLisaSourceRepo`
must hold — which makes non-weakening **structural rather than argued**, since the
branch is unreachable unless `package.json` is `@codyswann/lisa`. Pinned adversarially
both ways: a host repo with a byte-identical trampoline is still reported, and genuine
drift inside Lisa's repo is still reported. Idempotence proved: run 1 → both checks OK
and `git status --porcelain` empty; run 2 → identical.

**Original defect descriptions (kept for context):**
1. `doctor`/`apply` inject the `LISA_HOST_RULES` block into Lisa's own `AGENTS.md`
   every run, so the tree self-dirties — and `apply` refuses to run on a dirty tree.
   (#2444 likely could not commit the block because the instruction-file write guard
   blocks agent writes to `AGENTS.md`; there is a documented env override.)
2. `doctor` WARNs `Outdated Lisa-owned guards: scripts/lisa-work-item.mjs` — not drift,
   a deliberate trampoline re-exporting the `copy-overwrite` original. Cosmetic, but a
   check that cries wolf on its own repo trains people to ignore it.

**CI caveat worth keeping:** the `cancelled` runs on `main` were concurrency
superseding during rapid merges, not failures, and the last completed
`Release and Deploy` succeeded — but **no single CI run has ever covered the fully
combined tree**; this local run is the first such evidence. Honest blind spot from the
verifier: `check-plugins-sync`'s drift-detection path was not directly exercised (its
falsification probe was correctly blocked by the no-verify guard).

### ✅ Follow-up wave CLOSED — everything published in `v3.5.0` (2026-08-13 09:45)

All nine follow-up issues shipped and **verified inside a published tag**, not merely
merged. Eight closed with `status:done`: #2466, #2463, #2438, #2435, #2465, #2467,
#2468, #2476.

**A release-starvation episode worth recording, because the diagnosis chain matters.**
Seven merged PRs sat stranded with nothing published past `v3.4.1`. Cause: `lisa apply`
died on `fse.readFile is not a function`, which reddened the `ui-health` Playwright spec,
which failed Release. Three consecutive Release runs failed on it. **#2484** fixed it
(`node:fs/promises` instead of the fs-extra namespace) and the next run swept all seven
into **`v3.5.0`**.

Two corrections made during that episode, both instances of the same discipline:
- A gate agent reported the Playwright red as an **independent** blocker still
  red-lighting releases pending another session's branch. Verified false — Playwright
  **passes** in the successful release. It was a *symptom* of the same `fse.readFile`
  bug, not a separate defect.
- The same agent reported two dispatched PRs as "never opened" and asked whether to file
  them. Both agents were mid-implementation, sampled ~4 minutes after dispatch. **The
  rule "give 'it's blocked by X' the scrutiny of 'it's done'" applies equally to "it
  doesn't exist."** Acting on it would have duplicated agents into the same files.

### ✅ SECOND WAVE COMPLETE — all merged, `v2.349.1` → `v3.6.2`

Every PR from both waves is merged and published. The guard that closes the dogfooding
finding is on `main`, verified fail-closed (**36 fail-opens → 60/60 blocking**).

**What the flake investigation actually concluded, stated straight:** load dominates and
the code fix halves it — 56/56 processes failing → 28/56 under controlled alternating
arms. The targeted product failure (`Timed out waiting for file lock`) went 1/10 → 0/12.
And the two timeout suites **did not share the cause** — they spawn a synchronous
external process inside vitest's fixed 10s budget, so nothing in that fix touches them.
A negative result reported plainly rather than absorbed into the win.

**One root cause, three symptoms, found by measurement:** a *fixed-count* budget is not a
budget. `learnings-lock.ts` allowed 200 retries × 10ms — measured at **2589ms of real
time** on this machine, versus **30077ms** after moving to wall-clock. The same
anti-pattern appears as vitest's fixed 10s per-test budget over synchronous `spawnSync`
work (#2490), and as a ~10.5s test against that 10s ceiling (#2474). Fixed counts buy
whatever the machine's speed makes them worth.

**Still open, all tracked:** #2485 (required-check roster — owner-approved, in flight),
#2489, #2490, #2491 (handed to another session), #2492, #2494, #2497, #2501.

### 🔬 Second follow-up wave — the guard that fixes the dogfooding finding (2026-08-13)

Dispatched after the audit. **The headline: the guard promoting ready-role filing to
EXECUTABLE-CONTROL took four review rounds and is still held**, because adversarial
probing kept finding bypasses that position-patches could not close.

| Issue | PR | State |
|---|---|---|
| #2488 lock TOCTOU | **#2498** | ✅ **Silent loss eliminated: before 28/2160 rounds lost an entry (25/72 processes) → after 0/2160, 0 errors.** Arms alternated in one window. The fix does not narrow the race — it makes a second deleter *impossible*: deleting a generation requires a capability file created `O_CREAT\|O_EXCL` at a path that is a pure function of that generation's identity. Also added loss **detection** — transactions now refuse to publish over bytes they did not read |
| #2486 ready-role guard | #2495 | 🔴 **HELD — four bypass classes found** |
| #2474 flakes | queued | Mechanism identified: a `timeoutMs: 200` passed into production `runHealth`, where an expired deadline degrades to the deterministic result — **indistinguishable from what several cases assert**. Load does not jiggle timing, it *switches the code path under test* |
| #2487 fs-extra | queued | 110 call sites swept, 2 broken; preventive guard derives the safe member set from real Node at runtime so it cannot rot |

**#2495's four bypass classes, each defeating the previous fix:**

1. `env -i gh issue create` — listed wrapper carrying its own flag.
2. `nice -n 10 gh issue create` — **unlisted prefix, no flag.** Proven exploitable
   (`nice -n 10 gh --version` → `gh version 2.96.0`; the issue is actually created), and
   `nice` is POSIX so it is universal.
3. `gh issue create --title x #'` — **two characters, no binary, every platform.**
   `shlex.split` raises, `except ValueError: return None` permits, bash strips the
   comment and runs the create.
4. `eval "gh issue create …"` — `eval` is a POSIX **shell builtin**, so it cannot be
   absent from any host.

**The unifying defect is the failure *direction*, not the positions:** every
`return None` / unrecognised path **allows**. A decision-point sweep found 17–36
fail-opens depending on probe breadth. The fix in flight is the design change — scan
every token for a known tracker CLI rather than resolving one program, plus refusal on
tokenisation failure — not a fifth position patch.

**Method lesson that produced all of it:** enumerating command *shapes* scored 21/21 and
missed everything; enumerating the *parser's decision points* — tokenise, segment,
resolve program, strip flags, classify — found 30 fail-opens in one pass. The harness is
re-runnable and tags each probe with the binary it needs, scoring absent ones `n/a`
rather than as passes (11 rows are uncovered on this host).

**A false-negative in the cardinality yardstick, found by being wrong with it:** a probe
scoped to a *filename* reports zero when a suite splits. An end-of-options fix was
reported as untested; re-measuring the whole suite showed **4** failing tests — the
declaration arm had moved to a split file at the 300-line lint ceiling. Recorded on
#2489; #2492's two "inert arms" need re-measuring for the same reason.

### 🔎 Governance findings — "did the check *do* anything?" (2026-08-13)

Five findings share one root question. Every one was found by measurement, and none
would have surfaced from reading a green dashboard.

| # | Finding | Shape |
|---|---|---|
| **#2497** | **A REQUIRED check posted `success` while reviewing nothing.** CodeRabbit is in the required set; branch protection treats it as *the* review gate. It self-satisfied green on #2483 and #2484 — `reviews: 0`, description `Review rate limited` — so branch protection recorded "reviewed" for work nothing reviewed. Both are in published `v3.5.1`. | Required check that does nothing |
| **#2485** | Nine PRs merged with genuinely red **non-required** checks, incl. `🧩 Plugin artifacts match source` — the check that *proves* parity fanout. Verified no required context was ever red and no bypass used, so it is a roster problem, not author discipline. Also found a confusable-pair hazard: the red was `🧪 Run Tests` while the *required* ones are `🧪 Run Unit Tests` / `🧪 Run Integration Tests`. | Real check that cannot block |
| **#2492** | Two of four fail-closed arms in `design-source-gate` are **test-inert** — deleting one word flips the verdict to PASS with all 38 tests green. The test at line 140 is *named* "fails closed when the changed file cannot be read" while asserting only the classification. | Test that proves nothing |
| **#2489** | The "exactly one test must fail" cardinality yardstick was **decided and never shipped** — it lives only in a decision record whose next line says "not as a gate". Third prose-only gap of the session. | Rule that binds nobody |
| **#2491** | `reset-seed-coverage` is a strong contract with **almost no executable half**: `check-state-classification.mjs` does not ship, no backend in the fleet has a state contract, and the production block is delegated to project adapters nobody has verified. | Guard that is only prose |

**The unifying lesson, and the most transferable thing this session produced:** the useful
question is never *"did the check pass"* but ***"did the check do anything."*** A green
status, an empty review-thread list, an absent red, and a passing test can each mean
"nothing happened" — and all four look identical to success from the outside.

The one-command triage that separates real from hollow:
`gh pr checks <PR> | grep -i coderabbit` → the **description** column reads
`Review completed` vs `Review rate limited`, while the status column says `pass` either way.

### ⚖️ Dogfooding audit — did our own session obey the standards it shipped? (2026-08-13)

**The headline, and the most useful finding of the whole run: executable controls held
at 100%; prose rules were violated at ~100% — including by the agent that authored
them.**

| Standard | Rung | Verdict | Rate |
|---|---|---|---|
| `Co-Authored-By` trailer | **executable** (husky `commit-msg`) | CONFORMS | **50/50** |
| Conventional commits | **executable** (commitlint) | CONFORMS | **50/50** |
| WU-D ready-role filing | eager prose | **VIOLATES** | **0/13** — zero `lisa-tracker-write` calls all session |
| WU-C S19 branch plan | eager prose | **VIOLATES** | **0/13** |
| WU-B `Safe to close:` | eager prose | **VIOLATES** | **0/22** updates |
| WU-J substrate precedence | contract + skills | CONFORMS | 53 provider calls, 0 MCP |
| WU-F design-source | executable gate | N/A confirmed | no UI surfaces |

Eight of the 13 bypassing issues were filed *after* the rule merged. Seven messages
*quote* the safe-to-close rule while describing shipping it, and still omit the line.

**Two standard defects, now dispatched as fixes:**

1. **WU-D shipped one rung too low.** It is machine-checkable, so Lisa's own
   `learnings-ladder` rule puts it at EXECUTABLE-CONTROL — but it shipped as prose, and
   nothing matches `gh issue create`. The 13/13 bypass rate is the evidence. Fix: a
   PreToolUse Bash matcher across all agent variants.
2. **S19 is undecidable post-hoc, so it cannot audit anything — including this audit.**
   Its exemption key `runtime_behavior_change` is a *caller-asserted validator input*,
   never persisted in the body, while the live-issue path claims to "derive the spec
   fields" from stored sections. So re-validation believes whatever the caller claims,
   and `lisa-github-verify` cannot produce a truthful verdict. Fix: persist it.
   **Note the tested-and-rejected hypothesis** — S19 is *not* unworkable on pure-tooling
   work (Lisa has one environment, `production → main`, so derivation is trivial). The
   defect is decidability, not the requirement.

**Also true and worth not burying:** Lisa itself still has `.claude/rules/PROJECT_RULES.md`
and **no `.agents/rules/` directory**, so its own WU-A pointer currently resolves to
nothing. `AGENTS.md` declares this as a human-gated transition, so it is disclosed rather
than silent — but it is not done.

**Evidence caveat from the auditor:** `.lisa/verification-status.json` is stale (it
describes work item #1959 from 2026-07-23). Thirty-three PRs merged this session with no
v2 verdict, so nothing above rests on empirical runtime observation beyond what the
auditor ran directly.

### Follow-up wave (dispatched 2026-08-13 ~03:00)

All nine follow-up issues plus the deferred fleet unit, worked after the main run closed.

| Issue(s) | Fix | State |
|---|---|---|
| #2466 + #2463 | Hook bypass + `bind` collision | **PR #2469** |
| #2438 + #2435 | Four provider rungs + merge-driver doctor check | **PR #2471** |
| #2467 | Silent postinstall failures | **PR #2477** |
| #2468 | BDD gate defects (`.sort()`, PATH, always-true) | in flight |
| #2426 + #2427 | Required-checks wiring + `skip_jobs` whitespace | in flight |
| #2465 | oxlint `extends` in fresh worktrees | in flight |
| WU-I | codex_hooks fleet audit | ✅ done (audit only) |
| — | ask-gemini v3 bump (owner-approved; logoman deliberately left alone) | in flight |

**#2469 findings beyond the filed issue.** The bypass is
`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath …`, which sets the same
command-scope config as `-c core.hooksPath=` and disables every git hook. Now refused,
matched case-insensitively, index as `\d+` rather than pinned to `0`. It also closed an
**unreported cross-harness parity gap**: the Codex and agy variants denylisted only
`""`/`/dev/null`, matched case-sensitively, and lacked `--config-env=`, so
`-c core.hooksPath=/tmp/empty` and `CORE.HOOKSPATH=` walked straight through.
**Correction to #2463's premise:** that guard is *not Lisa's* — it is compiled into the
Claude Code binary and flags any argv token whose basename is a string-evaluating shell
builtin (`bind` is one). It cannot be narrowed by a Lisa PR and is doing legitimate
work, so the *collision* was removed instead: `link` is the documented spelling, `bind`
stays a permanent alias because host projects have checked-in hooks calling it.

**#2471 extras beyond the brief.** Moved the Jam PAT **off argv onto a pipe**
(process-table exposure), and pointed `sentry-cli` at the *same resolved* token rather
than a second store. None of the four layers expose a mutating operation (PostHog's
`query` is a POST that reads), so the contract's read-back reconciliation boundary is
not engaged — but each skill now states that **and the suite asserts it**, so a future
mutating op cannot silently inherit read semantics. Keychain removal date set to
**2026-11-01**, published once in the contract as a dated ramp with a ban on new
keychain rungs.

**#2477 (postinstall) — the js-yaml defect was far worse than filed.** Lisa is
`"type": "module"`, so `import yaml from "js-yaml"` was a real ESM default import, and
js-yaml 5's ESM build is named-exports-only. That is a **link-time SyntaxError that
killed the entire CLI — `lisa doctor` included — before any Lisa code ran.** So the one
tool an operator would reach for to diagnose a broken repo was itself dead from the same
bug, which is why acmeorgb's staleness stayed invisible. Fixed with a namespace
import (`src/utils/yaml.ts`) that links against any shape, so 3.x/4.x/5.x all work and
no version floor is needed; an undriveable pin now yields a named doctor `FAIL` instead
of a stack trace. Shape chosen for the swallow: **loud but non-fatal** — a non-zero
postinstall aborts `npm/bun install` and leaves `node_modules` half-built, so
hard-failing would convert one stale repo into a fleet outage. What makes the non-fatal
warning safe is the new gitignored `.lisa/apply-receipt.json`, which records *success*
and `apply_mode` — it also covers the detached trampoline that runs `stdio: "ignore"`
and can never report anything. Doctor now warns when the only recorded apply was
postinstall-safe, naming `.codex/config.toml` as still unreconciled: postinstall still
skips agent emits (correct), only the silence is fixed.

**New issue from the wave: #2476** — two more fleet-wide defects found during the
ask-gemini bump. (a) `quality.yml`'s `work_item_traceability` has no `permissions:`
block (correct — over-requesting causes fleet-wide `startup_failure`), so it inherits
the caller; a caller with no permissions block gets `Contents: read` only, its
`gh pr view` fails, and **the gate is permanently red regardless of PR content**.
(b) The shipped `.github/required-checks.json` seed is **aspirational, not
transcribed** — it claims Work-Item Traceability is required (nothing requires it) and
omits six that are. **This undermines #2426/#2472**, whose guard reads that file: it
would clear a genuinely-skipped required check and flag a non-required one. That agent
was stopped mid-flight and told to make the guard refuse an untranscribed seed.

**New issue from the wave: #2470** — Lisa-owned refresh is a byte comparison and
therefore cannot distinguish a host's *stronger* guard from stale drift. This is the
general case of the acmeorga near-miss. Recommended shape: a
`# lisa-guard-capabilities:` header with refresh refusing to overwrite a declared
superset. A monotonic version number was explicitly rejected — acmeorga and acmeorgd
hardened *different* vectors independently, so a single integer would have both bump to
the same value and one silently win.

### RUN COMPLETE (2026-08-13 ~02:50)

**Every work unit A–N is done. All three fleet BDD migrations merged**, acmeorgd's last
(#520 → `72478af9`). Only **WU-I** remains, deferred by design to the next
`lisa-update-projects` batch.

**acmeorgd #520 close-out.** SonarCloud failed on *new-code* conditions
(`new_reliability_rating` D, `new_security_rating` B) caused by ~15 `S2871` bare
`.sort()` bugs, 2 `S4036` PATH vulns and 2 `S3403` always-true comparisons — **all of
them inside the 15 files vendored byte-identical from `@codyswann/lisa@3.0.0`**, which
Sonar counts as new code wholesale. Patching them in-repo would have **re-forked the
gate this PR exists to un-fork**, so they were excluded as Lisa-owned paths and filed
upstream as **#2468** — i.e. Lisa's own shipped gate code carries those defects and
should be fixed at source. Trap worth keeping: that project runs **Automatic Analysis,
which does not read `sonar-project.properties`** (proved — that file's `.opencode/**`
exclusion has 10 live issues under it); the real surface is the server-side
`sonar.issue.ignore.multicriteria` keyed on **`resourceKey`, not `resourcePath`**, and
a project-level write *replaces* rather than merges the inherited entry.

14 review threads resolved: 3 were genuine in-repo defects (a scenario carrying two
lifecycle tags so report counts overshot; a `.keep` wrongly claiming tracker tags are
mandatory; a README citing a deleted script), 10 targeted the vendored upstream code
and were tracked on #2468, and 1 was **declined as invalid** — it demanded `bdd/README.md`
be rewritten to a brief template that is actually an on-demand `/format-md` slash
command CodeRabbit ingested as a rule because `.coderabbit.yml` treats all of
`**/.claude/**` as guidelines (only 1 of 60 sampled files follows it).

**Gate verified unweakened on `origin/dev` after merge**, not on the branch:
`adoption.state` still `bootstrap`, `coverageFloor` still 100/100/100, 3 exclusions (no
blanket spec exclusions), 25 waivers, traceability 368/368, and all 15 vendored files
still byte-identical to lisa@3.0.0 (0 diverged).

### FINAL (2026-08-13 ~02:20)

**All 20 PRs merged and published in `v3.4.0`.** Every Lisa-side work unit (A–J, M, N)
and the fleet rules cleanup (K) are complete; the last two — #2462 and #2441 — were
verified *in the tag*, not merely as ancestors of `main`. Only **WU-L** (fleet BDD gate
migration) remains in progress, and **WU-I** stays deferred to the next
`lisa-update-projects` batch by design.

Phase 0 → Phase 1 → Phase 2 all closed. `v2.349.1` → **`v3.4.0`**, the major driven by
WU-D's deliberate `BREAKING CHANGE:`.

### Endgame snapshot (2026-08-13 ~02:05)

**19 PRs merged. Lisa is at v3.2.0.** Every Lisa-side work unit is merged or in a PR;
only the two fleet units remain in progress.

Merged: Phase 0 decisions (#2425), guard delivery (#2436), learnings write-boundary
(#2434), zero-flow detection (#2410), branch plan (#2439), secrets enforcement
(#2437), rules architecture (#2444), partial-run false green (#2446), Linear ready-lane
guard (#2449), substrate precedence (#2451), ready-role normalization (#2453), BDD
discovery (#2452), tracking issues (#2459), missing eager head (#2460), ratchet
replacement (#2457), **eager operating pack (#2456)**, flake classifier (#2461),
Lisa-as-own-host fixes (#2464).

Open: #2462 (per-suite grace), #2441 (design-source gate).

**v3.0.0 was a deliberate major** — WU-D's `BREAKING CHANGE:` footer, honored by
semantic-release. Omitted `build_ready` now means NOT ready on GitHub and Linear.

### Live work-unit status

| WU | State | Notes |
|---|---|---|
| Phase 0 (D1–D6) | ✅ **MERGED** | PR #2425 — all four decision records on `main` |
| M row 1 (`skip_jobs`) | ✅ closed (refuted) | Already fixed in `1ced328b7`. Retire the stale downstream rule file in K. Residual gaps filed: #2426 (guard never invoked by a shipped workflow), #2427 (whitespace not trimmed) |
| M row 2 (guard delivery) | ✅ **MERGED** | **PR #2436 — CONFIRMED**, but the mechanism was *not* the create-only misclassification the downstream commit guessed. `CopyOverwriteStrategy.applyNonInteractive` leaves every differing managed file alone and returns `stale` when `skipGitCheck` is set — exactly the postinstall apply a version bump runs. #2374's follow-ups made staleness *visible* and added opt-in `--refresh-templates`, but a bump passes no flags, so guard fixes shipped to nobody; deleting the file to hit the create path was the only working route. Fix: `src/core/lisa-owned-templates.ts` — paths carrying the `lisa-` namespace segment refresh on any apply (backed up to `.lisabak/` first), while host-customisable files (`tsconfig.json`, `knip.json`, `eslint.config.ts`) keep the conservative behavior; `.lisaignore` still wins. Plus a doctor warn-check for cases apply can't reach (pinned old Lisa, ignored path, never re-applied). Verified with a real `apply` against a scratch project. **This unblocks every fleet-side fix actually reaching installed repos.** |
| M row 3 (ledger data loss) | ✅ **MERGED** `25a00812` | **PR #2434.** Scaffolding bug + merge-hostility already fixed upstream; two genuinely new arms added — a write-boundary hard-fail (`resolveSafeLearningTarget` refuses eager-tree targets, re-deriving from the *resolved* path so `.lisa/../.claude/rules/x.md` is caught) and a `lisa doctor` stray-ledger check. 29 new tests. Follow-up #2435 (doctor should report an unregistered merge driver) |
| E (secrets enforcement) | ✅ **MERGED** | **PR #2437.** One shared validator module so `doctor-secrets` and `resolve-secret verify` cannot disagree; empty note warn→**error** plus well-formedness codes; deliberately does *not* over-enforce (field set / prose quality unchecked, recorded in a test so it doesn't read as an oversight). Real bypasses fixed: `github-status-check.sh` was `source .env.local` (importing every parked token), three setup skills read the keychain with no resolver rung, `config-resolution.md` was a stale pre-chokepoint copy, and `lisa-linear-access` had no rung at all. Follow-up #2438 (four more access layers with bare env reads; keychain fallbacks need a removal date). **Operator impact: the five BWS tenants will newly fail `doctor` until every secret carries a note.** |
| C (branch plan) | ✅ **MERGED** | **PR #2439.** New vendor-neutral `derived-branch-plan` rule slug cited by seven surfaces; 3 writers render it, 3 validators gain gate S19, `lisa-implement` revalidates at claim time. Deliberate asymmetry: a *proposed* spec missing the plan FAILs, a *live legacy* item gets `N/A` + a `[lisa-branch-plan]` assumption comment, so an existing queue doesn't redden for a section no human could have added. **Design catch:** both fields name the *same* branch by construction (branch off `origin/<base>`, PR into `<base>`) — a plan naming two is malformed; the forward cherry-pick case travels as a linked follow-up item, documented so nobody "fixes" the invariant by loosening it |
| F (Figma marker) | ✅ done | **PR #2441** (issue #2430). Marker `DESIGN-SOURCE: none — not in Figma`, paired with the positive `DESIGN-SOURCE: <figma-url>`; spelling **pinned by a test** because a drifted marker silently disarms the gate instead of failing loudly. Deterministic CLI `design-source-gate.mjs` wired blocking into `lisa-review-local` (exempt from confidence filtering) and `lisa-quality-review` (Critical); `lisa-implement` makes the declaration a non-demotable same-PR deliverable, sync-back first when the tool preflight proved Figma access. Fails closed on `undeclared`, `malformed` (any non-figma.com link — a copy of a design can't be updated when the design changes), `conflicting`, `unreadable`, and both unresolved-diff cases. No host collision: the contract "governs whether the design source is declared, never what to build", and preserves the generated-from-RFC provenance |
| A (rules architecture) | ✅ **MERGED**, released in **2.352.0** | **PR #2444** (issue #2431) — whole unit, not a partial. `HOST_RULES_DIR = ".agents/rules"`, fixed not configurable, and **deliberately not a native auto-load tree for any runtime**, so all six agents reach it through one surface and none double-loads. New `host-rules-pointer.ts` with a generalized `replaceManagedBlock` the agy learnings bridge now shares — wired into the existing reconcile pass, no new mechanism. `projectRulesFile` retired to `LEGACY_PROJECT_RULES_FILE` (migration-only); a persisted value is still parsed so no installed project hard-fails. **Transition:** the legacy file is kept byte-for-byte (asserted by test) and the pointer states that runtimes auto-loading `.claude/rules/` already have it and must not re-read it — so the transition can't double-load — and the paragraph self-removes once the file is gone. **agy's gap is asserted, not papered over:** a parity test proves host-rules delivery is byte-identical across all six agents, then separately asserts `plugins/lisa-agy/hooks/inject-rules.sh` and `plugins/lisa-agy/rules/` **do not exist**. 10,205 tests passing. **Unblocks B and K** |
| N scout (#2416 overlap) | ✅ done | Four capabilities already shipped (don't rebuild); five genuinely new, prioritized |
| N-1 (filtered-dispatch false green) | ✅ **MERGED** | **PR #2446** (issue #2432). Exposure **confirmed with live proof**, not inference: run `31656882283` concludes `success` with a `skipped` job behind it. Discriminator is **"was this run PARTIAL?"** — a run-scoped `success` passes only when every job behind it also succeeded (truth-table row 26). Reading dispatch *inputs* was rejected because the Actions runs API exposes **no `inputs` field at all** (verified live); recovering it means parsing logs, which the contract refuses. Completeness closes **three** causes of one false green with one condition — including the cron path (`require_prerequisites: false` + missing `EXPO_TOKEN` skips every job and still concludes `success`). Unblock path preserved: it is the *shortfall*, not the event, that disqualifies. Contract 1.0.0 → **1.1.0** (a row that can only turn passing → blocking is a minor bump, so adopters pinned at `@v2.345.1` don't hard-fail). **Seams left deliberately:** `incomplete_run` is a distinct reason token N-2-style work can specialise, and `observe` now returns job lists for *every* match mode, so per-arm reporting and flake classification have per-job conclusions in hand. Residual: a filter that shrinks only a *matrix* leaves no skipped job to detect (does not apply to `maestro-native-e2e.yml`, whose platform jobs are plain `if:`-gated) |
| N-2 (zero-flow detection) | ✅ **MERGED** `ebb2b658` | **PR #2410** (issue #2409) — adopted rather than duplicated; was DIRTY, driven to merge. Attacks the arm level (a zero-flow arm now fails loudly and distinctly, standing down when a run is *cancelled*) while N-1 attacks the gate level |
| N-3..5 (tracking issue, per-suite bootstrap, flake classifier) | ⬜ queued | N-3 depends on N-1; N-5 scopes independently on the JUnit side |
| G1 (BDD discovery) | ✅ **MERGED** | **PR #2452** (issue #2440). `testDiscovery` config keyed by a runner declared in `runnerPlatforms`: `{roots[], extensions[], ignore?[], evidence}`, seeded with playwright + maestro **including `.maestro/subflows`** (the blind spot the fleet forks had). New enforced defect `spec-undisclosed` — an unmapped spec now **fails** instead of landing in a burndown line — plus `exclusion-metadata`, `exclusion-stale`, `discovery-missing` (warnable in bootstrap) and `discovery-invalid` (deliberately off the warnable allowlist). Every audited weakness addressed: roots configurable, `RUNNER_FOR_PLATFORM` derived from `runnerPlatforms`, and **template-literal titles taken verbatim from source** so they stay real file substrings (mappable/excusable) rather than mangled. **Security-conscious detail:** evidence grammars are a two-entry allowlist, never a repo-supplied regex, with declared names identifier-validated before reaching a pattern. Wedge fixed — `--write` regenerates whenever a report can be built at all, while stale evidence stays a defect. **Correction to the plan: there is no Rails copy of the gate to mirror.** **Unblocks L** (pending a release carrying this) |
| J (substrate precedence) | ✅ done | **PR #2451** (issue #2447). Shared slug `credential-substrate-precedence.md` fanned out to all agent variants. **Generalization sharpened during authoring:** prefer the *per-invocation-bound* substrate over the *ambient-bound* one, because ambient binding is a **TOCTOU window a pre-flight check cannot close** — extended to reads, since a read through the wrong tenant silently returns wrong data. Linear and Notion reversed to token-first; Atlassian reads → curl→acli→MCP with guarded acli writes untouched; jam/sentry/posthog re-ordered; sonarcloud documented as conformant single-substrate. **MCP fallback provably preserved** — a provider-less project is fully functional on MCP alone, asserted by test. The decision record also gained a write-reconciliation boundary: fallback after an in-flight write of unknown outcome is forbidden until reconciled by read-back on the same tier |
| D (ready role) | ✅ done | **PR #2453** (issue #2442), `feat(tracker)!` + `BREAKING CHANGE:` footer so semantic-release surfaces it. Two rule pairs carry the contract: omitted `build_ready` is not build-ready on JIRA/GitHub/Linear alike, every filing declares `build_ready: true` or `human_gate: "<reason>"` (stamped `[lisa-human-gate]`), and GitHub validator F4's compensating omitted→`true` normalization was removed so the default can't re-enter through the gate. **The real risk was silently emptying the build queue — a call-site survey found six paths that would have broken**, including the four `*-to-tracker` sub-task creates (the main PRD→tickets decomposition) and the four `*-create` skills, which had **zero** `build_ready` mentions anywhere. All now explicit; deliberate holds declare `human_gate` instead of relying on a default. `lisa-exploratory-qa` documented as the named exception; `lisa-repair-intake` gained a read-only sweep that never auto-promotes. Claim-time guards live in `claim-time-guards`, cited by all three build-intake arms, and the rule explicitly separates guard 1 from `claim-archaeology` (different ancestor) and `DUPLICATE_ALREADY_FIXED` (different canonical item) so they can't drift together |
| H (ratchet policy) | ✅ done | **PR #2457** (issue #2445). **BDD floor REPLACED**: the absolute bar stays, the floor-lowering ceremony (`coverageFloorBaseline` + label) is gone, replaced by two named base-relative invariants — `coverage-regression` (an obligation mapped at base is still mapped, unless it left via a `retirements` record or a waiver **and** carries the maintainer label) and `obligation-uncovered` (a new obligation arrives mapped or waived). Both are per-`SCENARIO:platform`, so they catch **what a percentage cannot**: un-mapping while the scenario stays declared, `@blocked`-ing a covered scenario, waiving what was mapped while traceability still reads 100%. **`coverage`/`simplecov`/`e2e` KEPT — "no replacement available"**, stated plainly rather than forcing a removal (there the ratchet *is* the invariant; the only per-item equivalent is a per-file baseline that only accumulates). **Stryker KEPT** — `break` is an absolute floor; the mutate-list comparison is exemption-addition detection, not creep. **The ratchet checker is untouched and no `thresholdRatchet.allow` entry was needed — nothing was relaxed to make its own work land.** Proof: six routes the ceremony closed, each still refused by a named code, every fixture committing a floor the old ratchet would have accepted; and exactly one thing was released — nudging the number when nothing regressed now yields zero findings. Also closed a pre-existing fail-open hole: enforced mode now **requires `BDD_BASE_SHA`** |
| M (Linear config guard) | ✅ **MERGED** | **PR #2449** (issue #2443). Adapter already fixed in `137c8c87e`. **The real remaining hole was the override arm:** `linear.workflow.ready` accepted any per-project value verbatim, and `lisa-validate-tracker-mapping` — the natural home — audited the *inert* `linear.labels.build` keys while never auditing `linear.workflow` at all, so a project pinning `"Todo"` passed a clean audit. Key insight: **name-existence validation is structurally blind here — the name resolves perfectly, which is exactly why the gate runs backwards unnoticed.** Two-part fix split by what each can observe: a static always-on rejection of stock default-created names (`Todo`/`To Do`/`Backlog`/`Triage`, no network, blind to renamed defaults) plus the authoritative live `INVERTED` classification against the team's real `defaultIssueState`. `INVERTED` is never `VALID` and never auto-repaired — unlike `CASE_DRIFT`/`MISSING`, nothing records which lane the human meant, and the honest repair may be to *create* a state. Negative controls prove `Ready for Dev`, `blocked: "Triage"`, and JIRA `To Do` still pass |
| N-3 (tracking issue) | ✅ done | **PR #2459** (issue #2448). Contract §10, rows 27–31: fail+no issue → create; fail+open → refresh the *oldest*, never file a second (body rewritten silently, comment only when the evidence fingerprint changed); pass **and complete** → close every match (duplicates heal); `unknown`/`incomplete_run` → no-op; an Issues-API failure on one suite is recorded and the rest still run. **Injection defense not asked for:** identity is an HTML-comment marker with the label encoded to `[A-Za-z0-9_.~%]`, so a suite named `evil --> <!--` cannot match every other suite's issue. **Reuse of N-1 done defensively:** `isCompleteEvidence` is consulted *before* state is inspected, so the partial-run case is answered by row 26's token rather than re-derived — "asking it independently of the state is what survives a future loosening of row 26", pinned by a `pass`+`incomplete_run` test that still refuses to close. **Isolation proved structurally, not by convention:** a separate never-required workflow (test asserts the ruleset does not require its context), the gate reusable requests no `issues:` scope (permissions are a ceiling), and writes are reachable only from `runReport` — **proved by running `runGate` against a fake `fetch` and requiring every request be a `GET`.** Filing takes a repo-wide `cancel-in-progress: false` group declared in the reusable so adopters cannot forget it |
| B (eager operating pack) | ✅ done | **PR #2456** (issue #2450). Five new eager+reference pairs: `local-ci-first`, `not-blocked-just-waiting` (explicitly names factory `human_needed` as stricter and unchanged, test-asserted), `session-status-updates` (three-part format + `Safe to close: yes/no — <reason>`, tied to the non-technical-operator obligation), `do-it-now`, `learnings-ladder`. **All three fleet candidates taken as line-level sharpenings, not new files** — the existing rules already carried ~90% of each, and a near-duplicate charges every session twice for one idea. The mutation-proven-guard's genuinely missing piece was **cardinality**: *exactly one* test must fail (zero = inert guard, many = over-broad) → folded into `falsifiable-checks`. **Wiki packaging fixed by conditioning the rule, not moving the skill — on evidence:** `lisa-rules-mirror` only mirrors known `ProjectType`s and `wiki` is not one, so a relocated rule would reach Claude and **silently vanish on Codex/OpenCode**. Session-load cost measured: 76 lines / ~1.7K tokens, ~5% growth on the eager pack, with a contract test capping each head at 24 lines |
| I (codex_hooks fleet audit) | ✅ done (audit + proof; no repo changes) | **The framing premise was wrong.** The migration shipped in **v2.195.5 (2026-07-10)** — ~150 minors *before* v3.0.0 — so for 9 of 11 host repos this needs **no version bump at all**: a plain re-apply at each repo's current pin suffices and **the v3 ready-role risk dissolves entirely**. **No installer gap:** feeding the four real config shapes found in the fleet (`codex_hooks` alone, and `codex_hooks`+`hooks` together) through the shipped `mergeSettings` cleaned all four to `hooks = true`; 18/18 regression tests green. The leftovers are simply repos where `lisa apply` has not re-run. **`~/.codex/config.toml` user-level is CLEAN** (its large `[hooks.state]` block is Codex's own run-state, not the deprecated key). Still carrying `codex_hooks`: 9 host repos + 4 workspace-root repos outside Lisa's ownership (`acmeorga/`, `advisory-rankings/`, `workstation-setup/`, `publishing/`). `.codex/config.toml` is **git-tracked everywhere**, so each fix needs a commit/PR — which is exactly why this belongs in a fleet batch rather than 15 bespoke PRs. `gemini/frontend-v2` is blocked behind #2467. **Flagged for a human call, deliberately not bumped:** only `ask-gemini` (2.191.5) and `logoman-frontend` (2.194.0) sit below the migration and would genuinely require crossing v3 |
| K (fleet rules cleanup) | ✅ done | **All 19 destroyed learnings recovered** at gemini frontend-v2 (PR #6578 merged). They could **not** go in the canonical ledger — it is hard-capped at 20 entries and already held exactly 20, so a 39-entry file would fail `assertDocumentBudget` and break every future write; they went to the contract's **overflow buffer** (parsed by Lisa's own `parseLearningsFile`) with SE-6942 filed for the gardener drain. **Refused the brief's "delete the stale rule file"** — only 1 of 3 sections was stale; deleting it would have destroyed the "a skipped job satisfies a required check" trap, a GitHub *platform* fact, and it confirmed `check-skipped-required-checks.mjs` ships but **no workflow invokes it** (corroborating #2426), so that prose is the only guard that exists. Surgical retirement instead (PR #2977 merged). Still-real oxlint worktree bug re-filed as Lisa **#2465**. Ten human-gated ladder tickets filed across four orgs, all to Backlog, never Ready. Nothing migrated to `.agents/rules/` — correct, the fleet tops out at 2.342.2, below the 2.352.0 floor |

**WU-K's corrections to this plan's assumptions — five accepted, one rejected:**

1. ✅ **`acmeorgc/*` are not empty templates.** `acmeorgc/frontend` carries **852 lines** — the largest rule file in the fleet. The survey table above was wrong.
2. ✅ **The fleet has ~2 copy-propagated lineages, not 14 independent files.** Frontend blob: acmeorgd/frontend ≈ acmeorgc/frontend ≈ logoman (identical headings down to the same expo issue numbers). Backend blob: `ask-gemini` is **40 of 42 lines identical** to `acmeorga/backend` — it carries acmeorga's "pennies vs cents" *monetary* rule inside a soccer scouting product. **Routing each lineage once fixes 2–3 repos**, which changes the shape of the remaining ladder work.
3. ✅ `ask-gemini` (49 lines) and `infrastructure-v2` (64 lines) were mis-surveyed as absent/empty.
4. ✅ **The acmeorgd knowledge loss is worse than recorded.** `4058e71` is titled *"fix(sonar): …"* and never mentions deleting knowledge; it also took `HUMAN.md` (309 lines). `AGENTS.md` is now empty and **4 of the 7 traps survive nowhere**.
5. ❌ **REJECTED — verified false by the orchestrator.** WU-K reported that WU-B's "never fabricate red-state evidence" candidate "never existed". It does, verbatim, at `acmeorgd/projects/frontend/.claude/rules/PROJECT_RULES.md:838` (full text: capture genuine red-state evidence, reconstruct against the BASE commit in a throwaway detached-HEAD worktree, and use `git stash` because the `safety-net` hook blocks `git checkout --`). **WU-K searched `acmeorgd-backend` — the wrong repo of the two.** WU-B's citation and shipped rule are sound.
6. ✅ **"Machine-checkable ⇒ retire the prose" needs an exception**, and acmeorga's generated design-system rules argue it themselves: **lint fires *after* wrong code already exists.** The test is "is discovering this via a lint error acceptable?" — yes for import order, no for a closed design system. Compounding it: oxlint exits 0 on warnings, so warn-level rules never gate and their prose is not redundant. Fold this into the ladder criteria before the remaining tickets are worked.
| L (fleet BDD resync) | ✅ done | All three repos migrated off their forked v1 monoliths onto the **byte-identical** Lisa v2 gate (11 files verified per repo), maps tool-migrated to schemaVersion 2, forks deleted, waivers given owner + ticket + expiry. acmeorga **[#921 merged](https://github.com/AcmeOrgA/frontend/pull/921)** (`bootstrap`, honest 29.9%); gemini [#6584](https://github.com/acmeorgb/frontend-v2/pull/6584) (`bootstrap`, **66.9% — not the briefed 67.3%**, because four mappings cite evidence that no longer resolves and v2 declines to credit them); acmeorgd [#520](https://github.com/AcmeOrgD/frontend/pull/520) (`bootstrap`, blocked by a **pre-existing** red nightly it correctly refused to force). Also fixed a latent bug in acmeorgd's jest arm where `runNode` returned stdout alone while promising combined streams, so v2's stderr narration read as silent |

**WU-L's findings — two filed upstream as urgent:**

1. 🔴 **Lisa 3.0.0 would have DOWNGRADED a security guard** (→ **#2466**). acmeorga
   hardened its own `block-no-verify.sh` against the
   `GIT_CONFIG_KEY_<n>=core.hooksPath` bypass; **upstream Lisa does not block it.**
   Because #2436 now auto-refreshes Lisa-owned artifacts, the weaker upstream guard
   would have silently overwritten the stronger local one. Its own tests caught it.
   **A byte comparison cannot tell a downgrade from an update** — that is the deeper
   issue.
2. 🔴 **`lisa apply` cannot run at gemini at all, and fails silently** (→ **#2467**).
   A `js-yaml@^5.2.3` pin conflicts with Lisa's `default` import, and the postinstall
   swallows it via `2>/dev/null || true` — so **that repo has been receiving no
   template updates and nothing surfaced it.** Same class as acmeorga infra `c373ba1`,
   so the pattern is systemic.
3. **The undeclared-spec estimates were off by an order of magnitude** — v2 discovers
   at *call-title*, not *file*, granularity: acmeorga **67** (briefed 1), gemini
   **257** (briefed ~6), acmeorgd **149**. Left as visible bootstrap warnings; none
   blanket-excluded.
4. **acmeorgd deliberately entered `bootstrap`, not `enforced`** — the one planned
   deviation, and correct. It has 100% traceability but 149 tests named by no mapping
   and no exclusion; in `enforced` each is a hard error, so flipping would redden
   `dev`. **100% answers "is every *declared* obligation mapped" — it says nothing
   about undeclared tests**, which is precisely the gap WU-G1 exists to close. Tracked
   in TUN-585.
| G2 (obligation promotion) | ✅ answered by H | Obligation coverage **is** promoted into the gate's enforced defect set, as `obligation-uncovered` scoped to obligations new relative to base — so pre-existing gaps stay burndown and `enforced` is reachable without backfilling history. No separate unit needed |
| N-5 (flake classifier) | ✅ done | **PR #2461** (issue #2454). Upstreamed as a `copy-overwrite` script (so it refreshes on apply per #2436) with every paid-for detail intact: lazy JUnit attributes + self-closing alternative, cycle-safe `runFlow` walking, preamble identity **derived** from marker selectors, product-favoring tie-break, `elapsedAtGateSec`. Two generalizations on the way up: sign-in markers became project config (acmeorgd's selectors ship as documented defaults) and flow paths resolve against the reported path first. **Non-gating proved, not asserted** — three independent absorbers (step `continue-on-error`, `\|\| true` through the pipe, classifier exits 0 on any readable report), and the integration test executes the step's own shell under `bash -eo pipefail` against a classifier exiting 3, an absent classifier, and a missing report, **so deleting any one absorber reddens a test**. **Registry structured, not prose**, with the deciding argument: its safety rule is *checkable* — missing `measured.failures`/`runs`/`measuredAt`/`method`, a placeholder methodology, zero observed failures, or failures > runs all become reported defects with zero annotation, and `measuredAt` makes staleness visible. Narrative stays in the project BDD README, pointed at from `notes` |
| N-4 (per-suite bootstrap grace) | ✅ done | **PR #2462** (issue #2455). A suite may declare `first_seen` + optional `grace_days` (default 14); `decide()` softens `unknown → bootstrap` when **either** the global window or the suite's own window is open. **Grace forgives absence, never failure** — row 26's machinery untouched, and the reporting half never sees the key. **Bounded three ways, never clamps:** a future `first_seen` fails (so the most any edit buys is one window from today, and rolling it forward is "this suite is new" written in a diff), `grace_days` is capped at the absolute 30-day max by schema validation, and the resolved window may not run beyond `bootstrap_max_days` — the same forgiveness budget as the global window, so a tightened cap cannot be bypassed sideways. Version 1.2.0 → **1.3.0 minor**, argued from §8: the major rule is "a verdict changing for an *unchanged* observation", and no table today carries `first_seen`, so findings are byte-identical and the verdict moves only when an operator adds a field; both skew directions fail closed. **Conflict with N-3 resolved transparently** — #2459 merged first and took both the next four row numbers and 1.2.0; N-4 yielded on both (rows → 32–35, version → 1.3.0) |

**Orchestrator restart contract:** this file plus the tables above are sufficient to
resume. Nothing needed to continue lives only in session context.

### Operational notes for every dispatch (learned 2026-08-12)

- **Heredocs are blocked** by the safety-net hook — write commit messages to a file and
  use `git commit -F <file>`.
- **The work-item gate blocks commits**: create a GitHub issue, claim it
  (`status:ready` → `status:in-progress`), then
  `node scripts/lisa-work-item.mjs bind CodySwannGT/lisa#<N>`. Bind requires the full
  `owner/repo#N` form and fails unless the issue is claimed.
- **The upstream-evidence-manifest gate** fires on *any* new tracked file under a
  governed path (including `plans/` and `docs/`), not just template edits. Run
  `bun run build:upstream-evidence-manifest` after `git add`, in the same commit.
- Pre-push runs the full `test:cov` suite — expect a multi-minute push.
- **A fresh worktree must run `bun install` before pushing** — worktrees can start with
  an empty `node_modules`, which makes knip fail pre-push and ast-grep/expo tests fail
  spuriously. Confirmed independently by the WU-C and WU-F agents; it fails identically
  on clean `main` without an install. Environment, not a code defect.
- **The manifest can need a *third* commit.** lint-staged's prettier pass rewrites
  files *after* the post-`git add` manifest generation, so the recorded hash can
  describe a version that never landed. Re-check the manifest after the commit hooks
  run, not just after `git add`.
- Some local test failures are pre-existing and environmental (`ast-grep` binary
  unavailable): `ast-grep-template`, `expo-eslint-local-config`, `enforcement-gates-e2e`,
  `check-learnings-budget`. Verify against a clean tree before chasing them.

---

## Outcomes (2026-08-13)

Seven agents ran in isolated worktrees. Shipped and merged: **#2507** (#2490 marginal
budgets), **#2511** (#2497 vacuous-check detection), **#2512** + **#2515** (#2494 fs-extra
rule and its scope fix), **#2513** (#2501 decidability cardinality), **#2514** (#2489
cardinality yardstick), **#2517** (#2492 design-source verdict coverage). **#2510** (#2485
required-check roster) landed last. Issues #2489/#2490/#2494/#2497/#2501 closed
`status:done`; `Closes #N` does not fire in this repo, so each was closed by hand.

Filed for follow-up, all `status:ready`: **#2505** (twelve ast-grep rule-test files that
nothing executes), **#2506** (`🔎 AST Grep Scan` is not a required context, so every
ast-grep rule is advisory), **#2509** (a check may only become required if its budget has
proven headroom), **#2516** (`health/agentic.test.ts` is a sixth marginal suite, outside
#2490's five).

### Ordering was the whole game

#2490 went **first** and everything else waited. Before it merged, agents burned four
pre-push runs; after it merged, five agents pushed green in a row. The decisive
measurement was #2485's: `sonar-secrets` timed out at 10,000ms with **five** vitest
workers and 11,275 of 11,276 tests passing. That retired "fails under load" and replaced
it with **a budget that loses at any load, just less often** — contention changes the
rate, never the mechanism.

### Four distinct ways a check reported nothing

All four surfaced in one batch, and the fourth was found only because a merge was held:

1. **Vacuous** — required, reported `SUCCESS`, reviewed nothing. 40 of 45 merged PRs
   (89%) carried CodeRabbit's `Review rate limited`.
2. **Not required** — `🔎 AST Grep Scan` goes red and auto-merge proceeds. #2512
   demonstrated this on the PR that introduced the detector, ~40 minutes after #2506 was
   filed predicting it.
3. **Path-filtered** — a required context on a `paths:`-filtered workflow never reports
   at all. Measured on PR #2496.
4. **Startup failure** — #2510 deleted a job while three `needs:` edges and five
   `needs.<job>` interpolations still referenced it. GitHub rejected the workflow at parse
   time: `jobs=0`, so none of the eight required contexts could report. `quality.yml` is
   the reusable workflow every project calls, so merging it would have taken fleet CI down.

### The instrument failures

Seven, by seven different agents, every one caught by re-measuring and none by review:
`pgrep -fc` (no `-c` on BSD — reports 0 while 56 processes run), `gh pr checks` on an
issue number with stderr discarded, a filename-scoped cardinality probe against a suite
split at the 300-line cap, `eslint --no-warn-ignored` (silence is indistinguishable from
"never linted"), `grep --glob` (an `rg` flag; matches nothing silently), `ast-grep scan`
narrowed to `src`+`scripts` while CI scans everything, and `grep -n "needs:"` printing
keys while the dependency names sat on the following lines.

Two shapes, and the distinction is the design lesson: an instrument that **fails closed**
costs minutes, because the error is loud and specific. An instrument that **fails silent**
costs hours and corrupts every conclusion downstream. Never write `|| echo 0` — it
converts the first into the second by hand.

Corollary, stated by the agent that broke `main`: **the scope of a verification is part of
its result.** A narrower instrument's silence is not the gate's pass.

### Ready-role filing reproduced itself

The audit measured ready-role filing at 0/13. Two more tickets were filed during this run
without lifecycle labels — instances 14 and 15 — by an agent that had spent the session
hunting exactly this defect class. Meanwhile the **claim** side, which has an executable
PreToolUse control, held at 100%. Same repo, same agents, same day: a cleaner natural
experiment for shipping standards as executable controls than the original audit.

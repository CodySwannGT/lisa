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

**Fleet reality (audited 2026-08-12 across tunnlai, geminisportsai, propswap origin
default branches).** The discovery WU-G wants **already exists downstream** — Lisa's
v2 gate (shipped 2026-08-12) was generalized from tunnlai's single-file gate and
dropped it on the way. Every in-scope adopter (tunnlai/frontend,
geminisportsai/frontend-v2, propswap/frontend; propswap/admin-frontend also carries
the monolith but is out of scope for this plan) runs a ~567-line schemaVersion-1
monolith `scripts/check-bdd-coverage.mjs` with:

- `inventoryPlaywright` / `inventoryMaestro` — real test-file discovery, but with
  hardcoded roots (`e2e/`, `.maestro/flows/` — subflows are structurally invisible),
  regex title-scraping that can't match template-literal titles, and hardcoded
  `RUNNER_FOR_PLATFORM` instead of reading `runnerPlatforms`.
- **Working, populated `exclusions`** (`{file, evidence?, reason}` — 3 entries at
  tunnlai, 10 at gemini, 9 at propswap frontend) used to suppress unmapped-test noise.
- The fatal softness: unmapped specs are *reported* into the burndown doc, never
  failed — which is why 6 undeclared Playwright specs sit invisible at gemini and 1 at
  propswap on their default branches today, with checked-in reports stale against
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
in the fleet is tunnlai's, and it is the *v1* fork wired as a jest arm inside Quality
Checks; propswap runs its v1 fork by hand. Fixes are hand-carried between forks (the
wrapped-tag parser bug was fixed independently in gunnertech `53f49f5`, tunnlai
`efbafd8a`, gemini `b4ff482e1`, propswap `af4bad9a` + `e0106be`). This work unit ends
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
   (`expo/github-rulesets/bdd-coverage.json`) as a required check. Evaluate tunnlai's
   jest-arm pattern (artifact byte-identity assertion, script-string pinning) for
   upstreaming as the mechanism rather than a one-off.
4. Adoption state per repo under `BDD_MODE`: tunnlai enters `enforced` (100% with 51
   dated waivers), gemini and propswap/frontend enter `bootstrap` with their honest
   baselines (67.3% and 29.9%). propswap/admin-frontend is out of scope for this
   plan.
5. Harvest the strongest downstream inventions as upstream candidates, each traced per
   the standing upstreaming rule: tunnlai's Maestro flake apparatus
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
- **Candidates from the fleet survey** (evaluate, don't auto-include): tunnlai
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
| tunnlai/{frontend, logoman-frontend, tunnl-backend, tunnl-infrastructure} | — |
| geminisportsai/ask-gemini | — |
| geminisportsai/backend-v2 | 9 topic rules: ci-github-workflows, cross-repo-infrastructure, dev-deploy-remote-verification-timing, graphql-pagination-performance, graphql-validation-rules, migration-workflow, observability-xray, test-user-auth, typeorm-lambda-bundle-traps |
| geminisportsai/frontend-v2 | 7 files incl. **PROJECT_LEARNINGS.md inside the auto-loaded rules dir**, cross-repo-dependencies, design-to-code-tickets, figma-design-system, jam-bug-triage, screen-size-not-device-type, use-the-design-library |
| geminisportsai/infrastructure-v2 | — |
| propswap/{backend, infrastructure} | — |
| propswap/frontend | design-system, use-the-design-library |
| gunnertech/{backend, frontend, infrastructure} | — |

**Survey calibration (2026-08-12).** The fleet's rule files were rough-classified
during the commit survey, and the split validates the ladder approach: tunnlai
frontend's 838-line file is ~half ESLint-rules-as-prose (~32 machine-checkable, ~22
wiki-shaped, ~8 eager); tunnlai backend's 48-line file is the opposite genre (pure
provenance-tagged traps, ~26 wiki-shaped); propswap backend runs ~16/8/18 with
accreted near-duplicates; propswap frontend is mostly product-spec tables that belong
in a wiki; three repos (tunnlai infra, propswap infra, gemini infra) are empty
templates — and tunnlai infra's traps were written into `AGENTS.md` then deleted
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
   propswap/gemini "generated from RFC — edit the RFC" pattern) rather than flattening
   those files into prose.
2. Special case — `geminisportsai/frontend-v2` has `PROJECT_LEARNINGS.md` *inside*
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
   row; tunnlai `a8899a17` — "ready" must mean a human flipped it, never the default
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

A commit survey since ~2026-05-15 across the tunnlai, geminisportsai, and propswap
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
| ~~`quality.yml` `skip_jobs` uses `contains()` substring matching~~ — **REFUTED 2026-08-12.** Already fixed upstream in `1ced328b7` (2026-07-24, #2028): every gate in `quality.yml` and `quality-rails.yml` uses the sentinel-comma idiom `contains(format(',{0},', inputs.skip_jobs), ',test,')`, which is exact token matching. Regression tests exist (`tests/integration/quality-workflow.test.ts:154-183`, including the explicit `test:e2e` case) and Lisa already ships its own `check-skipped-required-checks.mjs`. **The downstream rule file is stale — WU-K retires it rather than promoting it.** Two residual gaps filed as follow-ups: no shipped workflow invokes `check:skipped-required-checks`, and whitespace in `skip_jobs` is not trimmed (fails closed) | gemini backend-v2 `ci-github-workflows.md` (SE-5511, PR #2713), tunnlai `check-skipped-required-checks.mjs` (TUN-402) | ~~High~~ → **not a bug** |
| Enforcement-guard scripts are create-only on install, so a Lisa release fixing a guard never reaches installed repos — propswap had to delete-and-recreate to pick up the #2374 fail-open fixes | propswap `863ffbf3` commit body | **High — security fixes don't propagate** |
| Lisa 2.232.0 scaffolded `PROJECT_LEARNINGS.md` into `.claude/rules/` (auto-loaded, eager), and the JSONL-in-fenced-block format is merge-hostile: two branches wrote off the same empty blob, the merge took the empty side, **19 captured learnings destroyed** with no error | gemini frontend-v2 (`9d61ce1b8`, `e6a53af3c` vs `origin/dev`) | **High — silent data loss** |
| `automation-run-record.mjs` trims the live ledger to 50 records at append — at observed cadence the loop's audit trail dies in under a day | tunnlai `check-ledger-archive.mjs` (TUN-369) | Medium |
| Ledger append rebuilds records from a fixed whitelist, destroying unknown fields (`standing_rulings`) on the live copy | tunnlai TUN-566; filed as lisa#2395 | Medium (filed) |
| `lisa sync` `fillMissing` forges partial config keys from defaults with no `_lisaSync.populated` provenance — byte-identical to human ratification | tunnlai `check-lifecycle-label-config.mjs` (TUN-405) | Medium |
| Linear adapter mapped `workflow.ready` → `Todo`, where Linear puts brand-new issues — "ready" stopped meaning "a human flipped this"; 12 of 20 claimable issues were never marked ready | tunnlai `a8899a17` | Medium — feeds WU-D |
| Generated `reusable-claude.yml` callers pass an input the reusable workflow never declared → instant `startup_failure`; 100/100 recent runs failed, zero successes, nothing surfaced it (claude.yml is deliberately never overwritten) | propswap backend `48339607`, infra `97f7bea` | Medium |
| Postinstall bootstrap discards stderr (`2>/dev/null`) — a failed bootstrap is indistinguishable from success | propswap infra `c373ba1` | Medium |
| Worktree installs corrupt the main clone (symlinked `node_modules`; postinstall rewrites package.json to literal placeholders) — independently discovered three times at gemini, plus watchman/jest/metro breakage from accumulated agent worktrees at propswap and `.worktrees` gitlink pollution at tunnlai | gemini learnings ledger (`scope:upstream-candidate`, "needs a wrapper guard, not a rule"); propswap `1dbec71d`→`95298e16`, `abeeb45a` | Medium |
| Lisa-vendored artifacts fail host repos' own gates (`lisa-mutation.mjs` vs prettier ×3 repos, vs Sonar coverage ×1) — four independent workarounds | propswap `562a805e`, `23314ed`, `765d8a33`, `199d0c6` | Low |
| `.oxlintrc.json` relative `extends` breaks in worktrees without `node_modules`; bootstrap `bun install` creates a tracked `bun.lock` in npm-only repos | gemini infra `945b39c`, `b9b2ef3` | Low |
| Pre-commit has no first-class project-extension slot — project guards below `# END: AI GUARDRAILS` are silently deleted wholesale by the next apply; tunnlai pins the placement with tests. Pre-push already has `.local`/`.verify` slots | tunnlai TUN-367/369/405 hook comments | Medium |

### Fleet inventions to absorb → WU-N (unless already assigned to another unit)

- **False-green / zero-coverage family** (the most-repeated theme fleet-wide, fixed ≥8
  times at tunnlai alone): "a suite that ran nothing must not read as green."
  **#2416 overlap check completed 2026-08-12** — results below; scope is now precise.
- **Loop memory**: tunnlai's `standing_rulings` field + `standing-rulings.mjs`
  read-side — the intake loop wrote records it never read and re-litigated its own
  rulings (probes six and seven of an answered question).
- **Ledger durability**: tunnlai's archive mirror (until the WU-M trim fix lands, then
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
- **Retry policy by side-effect class**: propswap's money-tier `retries: 0` after a
  nightly moved 4×$10 + 4×$250 of sandbox money through whole-body retries — "a flake
  in this tier gets diagnosed rather than replayed" — with a guard test that asks
  Playwright to resolve its own config and asserts zero retries for every project
  collecting a money spec. Retry policy must be a function of side-effect class, not a
  global number; belongs beside `.lisa.config.json` `exploration.mutation`.
- **Generated-rule-file provenance**: propswap's and gemini's design-system rules are
  generated from an RFC with "edit the RFC and regenerate" headers, plus a graded
  escape-hatch ladder (amend the system → commented waiver → budgeted `UNSAFE_style`).
  A reusable pattern for WU-A's managed-vs-host-authored split and WU-F.
- **Guard-authorship discipline**: tunnlai backend's "mutation-proven guard" rule —
  introduce the exact regression the guard prevents, verify exactly one test fails,
  revert (born from a guard that passed 50 tests while letting the regression
  through). Candidate WU-B eager rule or guard-authoring skill step.
- **Vendor-neutrality gap for host-local governance**: gemini flipped JIRA→Linear in
  five days and every local skill/rule still hardcodes JIRA (`sprint-loop`,
  `design-to-code-tickets.md`, `jam-bug-triage.md`). Host-local artifacts have no
  tracker-abstraction hook; at minimum doctor should flag vendor-named references
  when `tracker` changes.
- **Empirical backing for D2 (ratchets)**: the fleet's creeping ratchets generate
  commit spam and churn — 14 PRs to move maxLinesPerFunction 28 lines (propswap),
  ~12 baseline-churn commits (gemini), 128 budget/ratchet commits with a
  breach→raise→ratify→correct cycle (tunnlai). And propswap `44891559` already
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
- Time-boxed bootstrap with an enforced ceiling — a deliberate rejection of propswap's
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
   result source** (no Node zip reader; artifacts expire) — but tunnlai's mechanism
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

- propswap/admin-frontend entirely (owner call, 2026-08-12) — its BDD monolith,
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
shepherd them, so a dedicated shepherd is required or PRs accumulate unmerged.

### Live work-unit status

| WU | State | Notes |
|---|---|---|
| Phase 0 (D1–D6) | ✅ done | PR #2425, auto-merge armed |
| M row 1 (`skip_jobs`) | ✅ closed (refuted) | Already fixed in `1ced328b7`. Retire the stale downstream rule file in K. Residual gaps filed: #2426 (guard never invoked by a shipped workflow), #2427 (whitespace not trimmed) |
| M row 2 (guard delivery) | ✅ done | **PR #2436 — CONFIRMED**, but the mechanism was *not* the create-only misclassification the downstream commit guessed. `CopyOverwriteStrategy.applyNonInteractive` leaves every differing managed file alone and returns `stale` when `skipGitCheck` is set — exactly the postinstall apply a version bump runs. #2374's follow-ups made staleness *visible* and added opt-in `--refresh-templates`, but a bump passes no flags, so guard fixes shipped to nobody; deleting the file to hit the create path was the only working route. Fix: `src/core/lisa-owned-templates.ts` — paths carrying the `lisa-` namespace segment refresh on any apply (backed up to `.lisabak/` first), while host-customisable files (`tsconfig.json`, `knip.json`, `eslint.config.ts`) keep the conservative behavior; `.lisaignore` still wins. Plus a doctor warn-check for cases apply can't reach (pinned old Lisa, ignored path, never re-applied). Verified with a real `apply` against a scratch project. **This unblocks every fleet-side fix actually reaching installed repos.** |
| M row 3 (ledger data loss) | ✅ **MERGED** `25a00812` | **PR #2434.** Scaffolding bug + merge-hostility already fixed upstream; two genuinely new arms added — a write-boundary hard-fail (`resolveSafeLearningTarget` refuses eager-tree targets, re-deriving from the *resolved* path so `.lisa/../.claude/rules/x.md` is caught) and a `lisa doctor` stray-ledger check. 29 new tests. Follow-up #2435 (doctor should report an unregistered merge driver) |
| E (secrets enforcement) | ✅ done | **PR #2437.** One shared validator module so `doctor-secrets` and `resolve-secret verify` cannot disagree; empty note warn→**error** plus well-formedness codes; deliberately does *not* over-enforce (field set / prose quality unchecked, recorded in a test so it doesn't read as an oversight). Real bypasses fixed: `github-status-check.sh` was `source .env.local` (importing every parked token), three setup skills read the keychain with no resolver rung, `config-resolution.md` was a stale pre-chokepoint copy, and `lisa-linear-access` had no rung at all. Follow-up #2438 (four more access layers with bare env reads; keychain fallbacks need a removal date). **Operator impact: the five BWS tenants will newly fail `doctor` until every secret carries a note.** |
| C (branch plan) | ✅ done | **PR #2439.** New vendor-neutral `derived-branch-plan` rule slug cited by seven surfaces; 3 writers render it, 3 validators gain gate S19, `lisa-implement` revalidates at claim time. Deliberate asymmetry: a *proposed* spec missing the plan FAILs, a *live legacy* item gets `N/A` + a `[lisa-branch-plan]` assumption comment, so an existing queue doesn't redden for a section no human could have added. **Design catch:** both fields name the *same* branch by construction (branch off `origin/<base>`, PR into `<base>`) — a plan naming two is malformed; the forward cherry-pick case travels as a linked follow-up item, documented so nobody "fixes" the invariant by loosening it |
| F (Figma marker) | ✅ done | **PR #2441** (issue #2430). Marker `DESIGN-SOURCE: none — not in Figma`, paired with the positive `DESIGN-SOURCE: <figma-url>`; spelling **pinned by a test** because a drifted marker silently disarms the gate instead of failing loudly. Deterministic CLI `design-source-gate.mjs` wired blocking into `lisa-review-local` (exempt from confidence filtering) and `lisa-quality-review` (Critical); `lisa-implement` makes the declaration a non-demotable same-PR deliverable, sync-back first when the tool preflight proved Figma access. Fails closed on `undeclared`, `malformed` (any non-figma.com link — a copy of a design can't be updated when the design changes), `conflicting`, `unreadable`, and both unresolved-diff cases. No host collision: the contract "governs whether the design source is declared, never what to build", and preserves the generated-from-RFC provenance |
| A (rules architecture) | 🔄 in flight | Critical path — B and K depend on it |
| N scout (#2416 overlap) | ✅ done | Four capabilities already shipped (don't rebuild); five genuinely new, prioritized |
| N-1 (filtered-dispatch false green) | 🔄 in flight | **Live exposure** — reclassified from feature to bug |
| N-2 (zero-flow detection) | ✅ **MERGED** `ebb2b658` | **PR #2410** (issue #2409) — adopted rather than duplicated; was DIRTY, driven to merge. Attacks the arm level (a zero-flow arm now fails loudly and distinctly, standing down when a run is *cancelled*) while N-1 attacks the gate level |
| N-3..5 (tracking issue, per-suite bootstrap, flake classifier) | ⬜ queued | N-3 depends on N-1; N-5 scopes independently on the JUnit side |
| G1, I | ⬜ queued | Phase 1 |
| B, D, H, J, K, L, G2 | ⬜ blocked | A→B, A→K, G1→L, D2→H→G2 |

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

# Lisa improvement notes — 2026-08-12

Loose notes on how to improve Lisa and/or its downstream (host) projects. Captured from a working session. The first half is the raw notes, unedited. The second half is interpretation plus a plan to address each item.

Revised 2026-08-12: every "current state" claim was verified against the codebase. Items 3, 9, and 18 were corrected where the first draft overstated what Lisa enforces today, and item 19 (credential-provider substrate precedence) was added.

Implementation plan: `plans/improvement-notes-implementation.md` (phased, decision-gated; work-unit letters match this document's table).

---

## Raw notes

TASK: Get rid of PROJECT_RULES in favor of agents/rules/

Goal: Prevent costly, slow cycles spent in CI/CD

Example prompt: If e2e tests like playwright or maestro are failing in ci, recreate the same setup locally and run it there. Fix problems locally first and then try again in ci.

Goal: Instruct the coding agent where to find secrets and what they are used for.

Example Prompt: You use <credentials provider> (bit warden, 1pass, etc) for secrets. Each secret has a note attached to it that tells you how to use it

Goal: Prevent the coding agent from getting stuck waiting on a report that never arrives:

Example Prompt: If the session is still active, check every 5 minutes to check status. Don’t rely on automated processes or messages back from subagents

Example Prompt: Blocked means you physically cannot proceed. Waiting for confirmation is not blocked.

Example Prompt: Plan phases are not sequential unless I say so.

Goal: Some coding agents don’t support “rules” directories, so standardize it in AGENTS.md.

Example prompt: Always read all files in the agents/rules directory for guidance

Goal: Projects sometimes have wikis. These wikis don’t need to be loaded on every session, but the agent should know about them so it can ask for more information on-demand

Example prompt: When you need deep information on the project query the wiki

Goal: Prevent long-winded, jargon-filled status updates

Example Prompt: Report what changed, what's blocked, and what needs a decision — not how you found it.

Don’t speak in jargon. Use plain language
- "just tell me what's going on and what my options are"
- "give me the summary, I'll ask for detail if I want it"

Goal: Immediately know if it’s ok to close the session

Example Prompt: In your updates, always tell me if it’s safe to shut down the session

Example: “SE-6560 is closed — didn't reproduce; its own screenshot was a whole-page light capture. Filed SE-6799 for a real theme-blind defect found next to it.”

Problem: The agent opened a ticket but then didn’t pick it up. It should go into READY status and another agent should pick it up immediately.

New gating rule on non-automated tickets: “Each ticket should explicitly state the branch to branch off of and the branch to PR back into” ← that’s on create

If an agent picks up a ticket that doesn’t specify those things, it should do it’s best to figure it out and update the ticket with the assumption it made since the information was lacking

Do not build ratchets. Fix all problems and prevent re-occurence with lint rules and other deterministic checks

Need a better way to capture learnings: rules vs skills vs wiki vs documentation

If something need to get done eventually, it should get done immediately.

Write in a conversational style

Just tell me the decision I need to make, your recommendation and the ramifications of the choices

How does mutation testing and property testing work? Is it enforced? Is it part of the workflows to add it?

Any UI that is added without Figma as the source should either sync the UI additon/changes back to Figma or add special commenting in the code to denote it’s additional and not captured at the source

I'd need LINEAR_API_KEY (it's in the Bitwarden require list, so I can pull it via bws if the access token is in your keychain)

⚠ `[features].codex_hooks` is deprecated. Use `[features].hooks` instead.

BDD alignment with e2e

---

## Interpretation

These notes are one pile of four different things:

1. **Session operating rules** — how a coding agent should behave while a session is open (CI locally, don’t wait, status format, wiki on demand, secrets).
2. **Factory / ticket lifecycle** — what happens after an agent files work (ready-role handoff, branch-from / PR-into).
3. **Quality philosophy** — no ratchets, Figma as UI source, BDD ↔ e2e, do-it-now.
4. **Questions and one-off ops** — mutation/property testing, Linear key via `bws`, Codex hooks deprecation.

The through-line on knowledge: stop stuffing everything into one `PROJECT_RULES.md`. Put each kind of knowledge on the surface that actually loads it.

| Surface | What belongs there | Load cost |
|---|---|---|
| Lint / tests / hooks | Anything a machine can check | Zero (fails the build) |
| Proposed agent-neutral rules directory (exact path TBD) | Short, always-on operating rules | Every session |
| `AGENTS.md` | Pointers only — rules location, wiki exists, query on demand | Every session, tiny |
| Skills | Multi-step procedures | On demand |
| Wiki | Deep project knowledge | On demand |
| Docs | Human-facing explanation | On demand |
| Secret notes (Bitwarden / 1Password) | What a credential is *for* and how to use it | When a secret is fetched |

Lisa already has pieces of this: a six-rung learnings ladder (`skill-evaluator`), `lisa-wiki-query`, a `lisa-secrets-access` contract that requires agents to read provider notes before discretionary use (note quality itself is only a warn-level existence check today — see item 3), BDD coverage gates, an opt-in mutation gate, forced `fast-check` on governed TypeScript, and `build_ready: true` on most automated loops and the tracked in-session filing path (exploratory-qa deliberately defaults to backlog — see item 9). The notes are mostly “make the existing machinery the default everywhere, including paths that bypass the normal tracked-work entry point,” plus a few philosophy and architecture decisions (ratchets, wiki-first vs wiki-on-demand, and whether to reverse agy’s deliberate no-eager-rules exception).

**Scope split**

- **Lisa core:** A–D, G, H, J below (rules architecture and migration, eager operating pack, ticket create/validate, in-session ready, BDD test discovery, ratchet replacement policy, credential-provider substrate precedence).
- **Host / downstream:** E, F, I (secret-note adoption audit, Figma exception comments, leftover `codex_hooks` outside projects that have run current `lisa apply`).
- **Already answered, no new Lisa capability:** mutation/property testing explanation, `LINEAR_API_KEY` via `bws`, and automatic `codex_hooks` migration during Lisa apply. Provider-note *enforcement* was originally in this bucket but does not belong there: note existence is only a warn-level doctor check and well-formedness is unchecked (item 3).

---

## Plan by item

### 1. Get rid of `PROJECT_RULES` in favor of `agents/rules/`

**What it means.** One Claude-shaped file (`projectRulesFile` defaulting to `.claude/rules/PROJECT_RULES.md`) does not travel across agents. The proposal is to introduce one agent-neutral directory of short host-authored rules, then deliberately deliver it to every supported agent.

**Current state.** Lisa still defaults `projectRulesFile` to `.claude/rules/PROJECT_RULES.md`. Learnings/debrief docs treat `PROJECT_RULES.md` as human-authored and not a machine write target. Lisa-authored shared rules originate under `plugins/src/base/rules/` and fan out to agent-specific generated surfaces. The repository does **not** currently have an agent-neutral `agents/rules/` or `.agents/rules/` host-rule source, so the exact new path and its ownership semantics are an architecture decision, not an existing convention. (One footnote: `.agents/rules` already appears in Lisa source, but only inside the `AUTO_LOADED_RULES_DIR_PREFIXES` blocklist in `src/core/project-config.ts` that keeps the learnings ledger out of future eager-rule trees — a forward-looking guard, not a convention.)

**Plan.**

1. Decide and record the exact canonical host-owned path (`agents/rules/`, `.agents/rules/`, or another path). Use that spelling everywhere.
2. Define ownership and fan-out: which content is host-authored, which content Lisa manages, and how each supported agent receives the host rules without duplicate loading.
3. Decide explicitly whether this reverses agy’s accepted no-eager-rules exception. Today agy gets a canonical, rule-free `AGENTS.md` and no eager-rule injection because its headless hooks do not fire.
4. Change `projectRulesFile` default (or retire the single-file concept) and migrate templates, learnings-audit paths, and host projects still on the old file. Sweep stale wiki claims in the same pass — `wiki/documentation/overview.md` still says debrief writes to `PROJECT_RULES.md`, contradicting the current human-authored-only contract.
5. Pair with item 5: introduce an idempotent managed-pointer migration for existing `AGENTS.md` files. A template-only change cannot update installed projects because `AGENTS.md` is create-only and host-owned.

**Done when.** No Lisa template or default still points at `PROJECT_RULES.md`; new and existing host projects receive the pointer through a documented ownership-safe migration; and parity tests prove the documented delivery behavior on Claude, Codex, Cursor, Copilot, OpenCode, and agy. If agy remains an exception, the done criterion names the gap instead of claiming identical delivery.

---

### 2. Prevent costly CI/CD cycles (reproduce e2e locally first)

**What it means.** Playwright / Maestro / e2e failures in CI are not a debugger. Recreate the same setup locally, fix there, then re-run CI.

**Current state.** No eager rule with this instruction. Implement/verify skills talk about proof locally, but not “don’t burn CI as a debugger.”

**Plan.** Ship a short rule in the canonical eager pack selected by item 1: if CI e2e fails, reproduce locally with the same config, fix, then push. Fan it out through the normal per-agent delivery paths. Optional later: a skill that reconstructs the CI e2e invocation from the workflow file.

**Done when.** The rule is in the shipped eager pack and `AGENTS.md` pointer covers agents that don’t auto-load rules.

---

### 3. Instruct the agent where secrets live and what they are for

**What it means.** Name the credentials provider. Each secret’s vault note explains how to use it. Example: `LINEAR_API_KEY` is on the Bitwarden required list; pull with `bws` if the access token is in the keychain.

**Current state.** Mostly exists, but enforcement is weaker than the contract's prose. `lisa-secrets-access` supports Bitwarden / 1Password / AWS / Doppler / Vault / env; requires an agent to read the provider note before first discretionary use; and documents a note format (including the `tool:` line that declares which CLIs a credential drives). But *well-formedness is not checked anywhere*: `doctor-secrets.mjs` only tests that a note is non-empty, and reports that as a **warn**, not an error. The "verify" surface is the skill's own `resolve-secret.mjs verify` operation — the `lisa-verify` flow and the doctor CLI never touch secrets; only the doctor *skill* wires the checks in. So the open questions are host adoption, bypassing consumers, and whether to tighten note checks to match what the contract already claims.

**Plan.**

1. Do not build a second provider-note contract. Keep `lisa-secrets-access` as the single chokepoint.
2. Audit agent and skill consumers for direct keychain, `.env`, or provider-CLI reads that bypass `lisa-secrets-access`; fix those call sites upstream in Lisa.
3. Host adoption: run the existing `verify` / `doctor` checks and repair missing or malformed notes in the configured provider.
4. If discoverability is still weak, add only a short eager pointer to `lisa-secrets-access`; do not duplicate its note format or resolution rules.
5. Close the enforcement gap the contract already claims: decide whether the empty-note check is promoted from warn to error, and whether a note-format (well-formedness) check is added — today neither exists.

**Done when.** Live verification shows an agent that needs `LINEAR_API_KEY` (or any required secret) resolves it through `lisa-secrets-access`, reads and follows the provider note, and does not ask a human for the value when the bootstrap token is available. Doctor checks pass for the host vault, and the note-quality enforcement decision (step 5) is recorded.

---

### 4. Don’t get stuck waiting on a report that never arrives

**What it means.** Three related operating rules:

- If the session is still active, poll status yourself every ~5 minutes. Don’t wait for a subagent callback or an automated ping.
- **Blocked** means you physically cannot proceed. Waiting for confirmation is not blocked.
- Plan phases are not sequential unless the user says so.

**Current state.** Not present as eager rules. Repair-intake and implement have their own “blocked” vocabulary (`human_needed`), which is stricter and should stay for factory work. This note is about *session* stuckness, not tracker blocked-status.

**Plan.** One eager rule file (or three tiny ones) covering poll-yourself, blocked≠waiting, parallel plans. Keep factory `human_needed` as-is; don’t conflate the two.

**Done when.** A session waiting on a subagent or a human “ok” reports “waiting,” keeps working on parallel work, and only says blocked when it cannot proceed.

---

### 5. Agents without a rules directory: standardize in `AGENTS.md`

**What it means.** Not every coding agent auto-loads the same rules directory. `AGENTS.md` is the portable instruction file. The proposal is for it to point at the canonical host-rules directory selected in item 1.

**Current state.** Lisa’s `AGENTS.md` is create-only and host-owned; `CLAUDE.md` is a one-line `@AGENTS.md` pointer. "Create-only" holds for overwrites, but apply/doctor already makes bounded managed edits to an existing `AGENTS.md` (stripping the legacy `LISA_RULES` block, reconciling the agy learnings-bridge — `src/core/instruction-files-migration.ts`), so the managed pointer block proposed below extends existing machinery rather than requiring a new mechanism. A 2026-06-06 decision made `AGENTS.md` canonical and rule-free and explicitly accepted that agy receives no eager rules. An “always read every rule file” pointer does not paste rule bodies into `AGENTS.md`, but it functionally restores eager rule delivery for agy. That is a policy reversal, not automatically compatible with the prior decision.

**Plan.** First make the item 1 architecture decision: exact rules path, whether agy’s exception is reversed, and how duplicate loading is prevented. Then add a small Lisa-managed pointer block to `AGENTS.md` and an idempotent migration that can add or update that block in existing host-owned files without touching surrounding prose. Updating only the starter template is insufficient because current apply intentionally does not overwrite an existing `AGENTS.md`. Do not paste rule bodies into `AGENTS.md`.

**Done when.** New and previously installed projects receive the pointer without losing host guidance; repeated apply/doctor runs are idempotent; no agent double-loads the pack; and agy behavior matches the recorded architecture decision.

---

### 6. Wikis exist; query on demand, don’t load every session

**What it means.** The agent should know a wiki is there and how to query it. It should not dump the wiki into every session.

**Current state.** Lisa has `lisa-wiki-query` and an eager `wiki-knowledge-source` rule that says consult the wiki *first*. That is stronger (and more context-expensive) than this note. Packaging wrinkle: the eager rule ships in the **base** plugin while `lisa-wiki-query` ships only in the **wiki** plugin, so a base-only project receives a rule pointing at a skill it does not have.

**Plan.** Soften the eager rule to: wiki exists; query when you need depth; do not load it at session start. Keep the query skill as the retrieval path. `AGENTS.md` gets a one-liner matching the example prompt. Fix the packaging mismatch while in there: condition the rule on the wiki plugin being installed, or move the skill into base.

**Done when.** Session bootstrap does not read wiki pages; an agent that needs deep project knowledge calls the query skill.

---

### 7. Stop long-winded, jargon-filled status updates

**What it means.**

- Report what changed, what’s blocked, and what needs a decision — not how you found it.
- Plain language. “Just tell me what’s going on and what my options are.”
- Conversational, not process-speak.
- Decision format: the decision, your recommendation, and the ramifications of each choice.

**Current state.** Lisa already requires plain language at *gates* (intake rejections, verification reports, ticket descriptions) because a non-technical operator stands there. In-session status updates are not similarly constrained.

**Plan.** Eager communication rule covering the three-part status, no jargon, decision-recommendation-ramifications. Align wording with the existing “non-technical operator” obligation so factory output and session chat match.

**Done when.** Updates are short, option-oriented, and readable by someone who does not know Lisa vocabulary.

---

### 8. Always say whether it’s safe to shut the session down

**What it means.** Every update includes: safe to close, or not, and why (e.g. a local process still running, a ticket not yet flipped to ready).

**Current state.** Not present.

**Plan.** Add to the communication eager rule from item 7. One line per update: `Safe to close: yes/no — <reason>`.

**Done when.** A human can glance at the last update and know whether killing the session loses in-flight work.

---

### 9. Filed tickets must enter READY so another agent picks them up

**What it means.** The SE-6560 / SE-6799 pattern: agent closed a non-repro, filed a real defect found next to it, then left the new ticket sitting. Filing without the ready role is an incomplete handoff.

**Current state.** Monitor, verify-prd, and repair-intake file with `build_ready: true`, and the standard in-session `lisa-track` path creates complete unmatched work as a build-ready leaf before claiming it. Exploratory-qa is a **deliberate exception**: it files findings with `ready=false` by default so a human promotes them from the backlog — an instance of the human-gate exception below, but it must be named as a decision, not glossed as "automated loops file ready." The other inconsistency is paths that bypass `lisa-track` or call vendor writers directly, where omitted `build_ready` diverges by provider: JIRA leaves the ticket in its default created status (**not** ready), while GitHub and Linear default the leaf into the **ready** role; the `lisa-tracker-write` shim does not normalize. Build-intake only claims items in the ready role.

**Plan.**

1. Require defects found during other work to use `lisa-track` / `lisa-tracker-write` with explicit `build_ready: true`; do not rely on provider-specific omitted defaults. Separately, normalize omitted `build_ready` (in the shim or the vendor writers) so omission behaves identically on JIRA, GitHub, and Linear.
2. Exception: tickets that still need a human product call stay off ready (same exterior-gate idea as held-back PRDs). Record explicitly whether exploratory-qa's `ready=false` default stands as this exception (recommended: yes).
3. Create/write skills treat “filed but not ready” as incomplete unless the filer explicitly marks human-gate.
4. Optional: repair-intake or a small check that finds recently filed tickets with no ready role and no human-gate marker.

**Done when.** A ticket like SE-6799 is claimable by build-intake in the next cycle without a human flipping status.

---

### 10. Non-automated tickets must name source branch and PR target (on create)

**What it means.** Each ticket states (1) the branch to branch off of and (2) the branch to PR back into. That’s a create-time gate.

**If missing at pickup:** the implementing agent infers both, **writes the assumption onto the ticket**, and proceeds. No silent guessing.

**Current state.** Tracker create/validate gates do not require two literal branch fields, but Lisa already has the equivalent authoritative contract: runtime work carries `## Target Backend Environment`; the environment maps through `.lisa.config.json` `deploy.branches` to the exact base branch; implementation validates that remote branch, creates or syncs the feature branch from it, and targets the PR back into it. The environment is explicitly the source of truth, and an open PR targeting a different base stops for confirmation. Adding independent branch fields without precedence rules would create a second source of truth that can drift.

**Plan.**

1. Keep `Target Backend Environment` + `deploy.branches` authoritative. Never default independently to `main` or another default branch.
2. If operators need the branch names visible on the ticket, add a generated `## Branch Plan` section containing `Branch from` and `PR into`, both derived from the resolved environment mapping. Mark it as derived data, not a second authority.
3. Create/validate recomputes the branch plan from current config and rejects a conflicting human-authored branch plan rather than choosing one silently.
4. Claim/implement revalidates the derived branches against current config and the remote. For a legacy ticket with no branch plan, write the derived assumption onto the ticket and proceed; for a conflict with a human-confirmed environment or an existing PR base, stop under the existing confirmation rules.
5. Define behavior for documentation/config-only work where `Target Backend Environment` is intentionally not required.

**Done when.** Every applicable leaf ticket makes its branch plan visible, the displayed branches are mechanically derived from and validated against the authoritative environment mapping, a legacy ticket receives an explicit derived assumption before work starts, and no path can silently target a different environment branch.

---

### 11. Do not build ratchets — fix everything, lock with deterministic checks

**What it means.** Don’t “raise the floor over time.” Fix the debt now. Prevent recurrence with lint, tests, or other checks that fail closed.

**Current state. Conflicts with Lisa.** Lisa ships coverage-floor ratchets and threshold ratchets (including Stryker mutate-list / break threshold). Brownfield onboarding currently uses ratchets so a red project can adopt incrementally.

**Plan.** This is a product decision, then code. Removing a ratchet also requires an explicit replacement for the no-regression property it currently provides.

- **Recommended:** keep absolute floors (coverage minimum, mutation break threshold) as gates and remove generic “creep the number upward” machinery only where a deterministic non-regression invariant replaces it. For example, an existing BDD mapping cannot disappear unless its scenario is validly retired, and every new frontend behavior must be mapped or waived.
- **If ratchets stay:** treat this note as host-project policy only; Lisa unchanged.
- **If ratchets die:** choose one explicit brownfield policy per family: fully remediate before unattended operation; hold a fixed absolute floor plus a separate no-regression check; or accept that previously gained coverage may be lost. Update tests, health checks, bootstrap docs, and migration behavior accordingly.

The BDD contract needs special treatment. It intentionally lets a mid-life project begin below 100%, records the uncovered inventory as burndown, and raises the committed floor as coverage improves. A fixed floor at the initial percentage permits later loss; a fixed 100% floor requires full behavior backfill before the first frontend change. Pick one of those consequences or define a non-ratchet invariant that preserves every accepted mapping.

**Done when.** Either Lisa retains the ratchets by recorded decision, or every removed ratchet has a named absolute gate and no-regression replacement, with a tested brownfield migration path. No coverage family may become easier to regress accidentally because its ratchet was deleted.

---

### 12. Better way to capture learnings: rules vs skills vs wiki vs docs

**What it means.** People don’t know where a learning should live.

**Current state.** Lisa already has the six-rung ladder (`skill-evaluator` / gardener):

| Rung | Surface |
|---|---|
| EXECUTABLE-CONTROL | Lint, ast-grep, test, hook |
| EAGER-RULE | Auto-loaded rules tree |
| SKILL | Multi-step procedure |
| WIKI | Deep declarative knowledge |
| KEEP-IN-LEDGER | Captured, not promoted |
| RETIRE | Drop |

The gap is discoverability and follow-through, not a missing taxonomy. `PROJECT_RULES.md` / `AGENTS.md` are explicitly *not* learnings destinations.

**Plan.**

1. Don’t invent a second taxonomy. Point operators and agents at the existing ladder.
2. Eager one-pager: “where does this go?” with the table above, in the canonical eager pack selected by item 1 or in the wiki, not a new system.
3. Make sure learnings-audit (gardener) is an offered automation so promotions actually happen.
4. After item 1, the eager-rule rung names the selected canonical rules directory, not `PROJECT_RULES.md`.

**Done when.** A candidate learning is routed by the ladder without a human asking “is this a rule or a wiki page?”

---

### 13. If it needs to get done eventually, do it immediately

**What it means.** Don’t file a “later” note and walk away. Do the work in this session.

**Tension.** Lisa’s exterior gates (protected deploys, low-confidence learnings, held-back PRDs) exist on purpose. “Immediately” must not override those.

**Plan.** Eager rule: if the factory is *allowed* to do it (file the ticket, flip ready, add the lint, fix the test), do it now. If it requires an exterior human gate, do the allowed part now (file, mark the gate) and say what’s waiting on a human.

**Done when.** “I’ll get to that later” is not an acceptable close for in-scope work.

---

### 14. Mutation testing and property testing — how they work, are they enforced, are they in the workflow?

**Answer (no Lisa change required unless we decide to tighten).**

**Mutation testing — two layers**

- **Skill** (`mutation-testing`): on-demand, AI-guided mutants on changed files. Not a required step in implement or verify.
- **Gate** (Stryker / `mutation.gate.json` or Rails `mutation.gate.yml`): opt-in, configurable. Health check flags “disabled with no justification.” Not forced on every project the way coverage is.

**Property testing**

- `fast-check` is **forced** on governed TypeScript projects via `package.lisa.json`.
- The library is present; writing property tests is **not** a required workflow step on every ticket.
- Lisa itself has at least one (`json-merge.property.test.ts`).

**Optional follow-up (only if we want them in the workflow).** Add an implement/verify checkpoint: for changed pure logic, add or extend a property test; for high-risk changed units, run the mutation skill. That is a new requirement, not current behavior.

---

### 15. UI added without Figma as source

**What it means.** Figma remains the design source of truth. If UI is invented in code, either sync it back to Figma or mark the code as “not in the design source.”

**Current state.** Lisa has Figma as a source-artifact type on tickets (`lisa-tracker-source-artifacts`) and implement treats a linked Figma file as a required tool. There is no “code-only UI must be annotated or synced back” rule.

**Plan.**

1. Implement / review rule: if there is no Figma source for a UI change, either update Figma or add a designated comment (exact marker TBD, e.g. `// DESIGN-SOURCE: none — not in Figma`).
2. Prefer sync-back when Figma access exists; comment is the exception.
3. Host design-system projects may already have `.claude/rules/figma-design-system.md`; don’t collide — extend or point at that.

**Done when.** A UI change with no Figma source is either reflected in Figma or explicitly marked in code, and review fails closed if neither happened.

---

### 16. `LINEAR_API_KEY` via Bitwarden / `bws`

**What it means.** Operational, not a Lisa feature. The key is on the Bitwarden required list; `bws` can pull it if the access token is in the keychain.

**Plan.** No product change. The existing item 3 secrets contract already covers it. If a session needs Linear and the key isn’t in the environment, invoke `lisa-secrets-access`; its Bitwarden adapter may use `bws` when the bootstrap access token is available. Do not bypass the skill by calling the provider directly, and do not ask the human to paste the value.

---

### 17. `[features].codex_hooks` is deprecated — use `[features].hooks`

**What it means.** Codex config warning. Lisa docs already say `[features].hooks`; `codex_hooks` is deprecated.

**Current state.** Lisa already owns this migration. Its Codex settings installer requires `[features].hooks = true`, replaces `codex_hooks` in place while preserving an inline comment, and removes `codex_hooks` when both keys are present. Regression tests cover both cases.

**Plan.** No new Lisa feature. Run current `lisa apply` on known hosts, then audit only projects or user-level Codex configs outside Lisa’s project-scoped ownership. Do not create a second migration path.

**Done when.** No known host or user config still sets `codex_hooks`, and the existing Lisa migration tests remain green.

---

### 18. BDD alignment with e2e

**What it means.** Gherkin scenarios and e2e tests should be the same contract: every scenario has an e2e that runs it; every e2e traces to a scenario. No orphan tests, no untested scenarios.

**Current state.** Lisa has a BDD coverage gate, but it enforces less than the contract's prose. The gate rejects a mapping that names a nonexistent scenario, and — since the fail-open fixes (`b71e494`) — stale mapping evidence removes the coverage credit rather than merely warning. But "every required scenario-platform obligation has a mapping or dated waiver" is a **flow obligation on `lisa-verify`, not a gate rule**: the gate's enforced defect set is only `empty-contract` / `floor-missing` / `floor-regression`; uncovered obligations are listed as gaps and only fail when coverage drops below the committed floor. Waivers, where present, are strictly dated and expiring. `exclusions` is documented in the contract and present as an empty array in the template, but **no gate code reads it**. And the discovery gap stands: the only filesystem walk enumerates `bdd/features/*.feature` — nothing globs runner test directories, so a newly added, undeclared e2e test is invisible to the gate.

**Plan.**

1. Preserve the enforced checks (mapping → existing scenario, stale-evidence credit removal, floor non-regression), and decide whether obligation coverage should be promoted from a `lisa-verify` flow obligation to a gate defect code.
2. Define vendor-neutral runner discovery configuration: which globs enumerate e2e specs for each configured runner and how projects override them.
3. Fail when a discovered e2e spec is neither represented by a coverage-map mapping nor listed in `exclusions` with a reason. This requires *implementing* `exclusions` in gate code — today it is documented but unread; it only becomes meaningful once "unmapped test" can be computed, which requires the discovery in step 2. Add red-leg tests for an unmapped spec, a valid exclusion, and a stale exclusion.
4. Align with item 11: if the coverage-floor ratchet goes away, replace its no-regression behavior explicitly; do not merely freeze a low fixed floor.

**Done when.** A PR that adds an undisclosed e2e spec, a mapping to no scenario, or a required scenario obligation with neither automation nor a valid waiver fails the gate, while deliberate non-product tests pass only through an explicit exclusion.

---

### 19. Enforce configured credential-provider precedence over interactive MCPs

**What it means.** When a project is configured for a credentials provider (e.g. Bitwarden), agents should resolve secrets *and tool auth (CLIs)* through that provider first, and fall back to interactive/browser-auth MCPs only when the provider path is genuinely unavailable.

**Current state. Precedence exists but is per-vendor and partly the opposite of this rule.**

- `lisa-linear-access` resolves the Linear MCP **first** when authenticated, falling back to `LINEAR_API_KEY` + GraphQL only in headless environments.
- `lisa-notion-access` is also MCP-first: tier 1 is the Notion MCP (if authenticated and identity-matched), tier 2 the internal-integration token via curl.
- `lisa-atlassian-access` already follows the proposed rule **for writes**: token-auth curl is mandatory-preferred whenever available, because the cloudId-scoped URL cannot be redirected by the user-global acli active account; acli writes are a guarded fallback with post-write tenant assertions. Reads, however, prefer acli, then MCP, then curl.
- `lisa-secrets-access` has the building blocks — the `tool:` note line declaring which CLIs a credential drives, the one-store rule, the consumable-credential rule — but no substrate-ordering rule.

**Plan.**

1. Decide the precedence policy explicitly. For Linear and Notion this is a **behavior reversal**, not codification. MCP-first was chosen for real reasons (an already-authenticated MCP is zero-setup and identity-verified; the token path needs the provider bootstrap present), so the flip must be argued: determinism, headless parity (cron/cloud sessions have no browser, so provider-first makes interactive and headless sessions behave the same), and tenant safety (the Atlassian write rule exists precisely because interactive auth binds to whatever account the human last used).
2. Ship **one shared vendor-neutral precedence contract** (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent per-skill prose), cited by every `*-access` skill: configured-provider token/CLI substrate first when its bootstrap is available and identity-matched; interactive MCP as fallback; identity-match verification stays mandatory on every substrate either way.
3. Update `lisa-linear-access` and `lisa-notion-access` tier ordering to cite the contract; generalize the Atlassian write-tenant-safety rationale into the shared contract instead of restating it per vendor.
4. Keep `lisa-secrets-access` as the chokepoint feeding the token path (item 3); the `tool:` note line already tells a session which CLIs the provider expects it to drive.

**Done when.** Every `*-access` skill resolves substrates in the contract's order; a Bitwarden-configured project with the bootstrap token present resolves secrets and tool auth through the provider path without touching browser auth; and MCP fallback still works when the provider path is genuinely unavailable.

---

## Suggested work units

| ID | Work | Where | Depends on |
|---|---|---|---|
| A | Decide the canonical host-rules path and agy delivery policy; migrate `PROJECT_RULES`; add an ownership-safe managed `AGENTS.md` pointer for new and existing hosts | Lisa | Decision |
| B | Eager rules pack: local-CI-first, don’t-wait, blocked≠waiting, parallel plans, status format, safe-to-close, plain language, do-it-now, wiki-on-demand; point to the existing secrets-access contract | Lisa shipped rules + managed host `AGENTS.md` block | A |
| C | Create/validate gate: render and validate a branch plan derived from `Target Backend Environment` + `deploy.branches`; claim-time revalidate and document legacy assumptions | Lisa tracker create/validate + implement | — |
| D | Close in-session ticket paths that bypass `lisa-track` / explicit `build_ready: true`; preserve human-gated backlog paths | Lisa write/create skills | — |
| E | Audit host vault adoption of the existing secret-note contract and repair missing notes or bypassing consumers; decide whether note checks tighten from warn-level existence to enforced format | Host + Lisa consumer audit | — |
| F | UI-without-Figma: sync back or annotate | Host + Lisa implement/review rule | — |
| G | Add configured-runner test discovery; require every discovered e2e spec to be mapped or explicitly excluded | Lisa BDD gate | H if ratchet policy changes no-regression behavior |
| H | Ratchet policy decision plus an explicit no-regression replacement and brownfield migration for every removed family | Lisa | Decision |
| I | Run existing Codex settings migration on hosts; audit only configs outside Lisa ownership for leftover `codex_hooks` | Host | — |
| J | One shared substrate-precedence contract: configured-provider token/CLI first (when bootstrap available and identity-matched), interactive MCP fallback; update Linear/Notion/Atlassian access-layer tier ordering to cite it | Lisa `*-access` skills + shared rule | Decision |
| K | Downstream rules cleanup: migrate the 14 canonical repos carrying `.claude/rules/PROJECT_RULES.md` (plus topic-rule files and one eager-loaded `PROJECT_LEARNINGS.md`) through the six-rung ladder into the item-1 architecture | Host fleet via `lisa-update-projects` | A |
| L | Fleet BDD gate resync: migrate the three in-scope v1-monolith adopters (acmeorgd, acmeorgb, acmeorga frontend; admin-frontend excluded by owner call) onto Lisa's v2 gate with v1→v2 map/waiver migration, CI enforcement, and upstream-harvest of the downstream inventions (discovery/exclusions, flake classifier, zero-coverage-arm detection) | Host fleet + Lisa BDD gate | G |
| M | Lisa bug burn-down from the 2026-08-12 fleet audit: skip_jobs substring matching, create-only guard delivery, learnings-ledger-in-rules-dir data loss, ledger trim/whitelist, sync fillMissing provenance, Linear ready→Todo, retired create-only callers, silent postinstall, worktree corruption | Lisa | — |
| N | Absorb fleet inventions: false-green/zero-coverage family, loop standing-rulings memory, agent-artifact PII scan, deploy-verification timing, claim-time already-implemented guard, retry-by-side-effect-class, pre-commit extension slot | Lisa | — |

A–D, G, H, and J require Lisa changes. E, I, and most of F are downstream. The Lisa-owned portion of item 17 is an existing capability to verify; item 3 is mostly existing capability plus the enforcement-tightening decision in E.

---

## Decisions still needed

1. **Host rules and agy (items 1 and 5 / A).** Choose the exact agent-neutral path and decide whether the `AGENTS.md` pointer intentionally reverses agy’s accepted no-eager-rules exception. Recommendation: decide this explicitly before changing templates, then ship an idempotent managed-block migration for existing hosts.
2. **Ratchets (item 11 / H).** Kill them in Lisa, make them opt-in, or keep them and apply “fix everything” only on host projects. Recommendation: absolute floors without generic creeping ratchets only where a deterministic no-regression replacement and brownfield migration are defined first.
3. **Wiki load (item 6).** Soften “consult first” to “query when you need depth.” Recommendation: yes, for context budget.
4. **In-session tickets auto-ready (item 9 / D).** Recommendation: yes for complete defects found during other work; no for tickets that still need a human product call. Target bypassing create paths rather than weakening the explicit human-gate control. Two sub-decisions to record: whether exploratory-qa's deliberate `ready=false` default stands (recommendation: yes — it *is* the human product-call exception), and normalizing omitted `build_ready` so it behaves the same on JIRA (today: not ready), GitHub, and Linear (today: ready).
5. **Mutation/property in the workflow (item 14).** Recommendation: leave as-is (forced library, opt-in mutation gate, on-demand skill) unless we explicitly want a new implement checkpoint.
6. **Credential-provider substrate precedence (item 19 / J).** Reverse the Linear/Notion MCP-first ordering to configured-provider-first? Recommendation: yes, via one shared contract — token/CLI substrate first when the provider bootstrap is available and identity-matched, interactive MCP as fallback. It aligns interactive sessions with headless behavior and generalizes the tenant-safety logic the Atlassian write path already enforces.

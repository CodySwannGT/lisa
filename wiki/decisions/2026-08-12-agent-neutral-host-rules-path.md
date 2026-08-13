# Decision: Agent-Neutral Host-Rules Path, agy Delivery, and Wiki Load Posture

Date: 2026-08-12

Status: Accepted

Covers decisions **D1** and **D3** of `plans/improvement-notes-implementation.md`
(work units A, B, K). Partially supersedes the agy arm of
[2026-05-28 Pattern B Per-Agent Plugin Variants](2026-05-28-pattern-b-per-agent-plugin-variants.md)
— see "agy" below.

## Context

`projectRulesFile` defaults to `.claude/rules/PROJECT_RULES.md`
(`src/core/project-config.ts:36`) — a Claude-shaped path that does not travel across
agents. Host projects that want durable operating rules therefore write them into a
directory only one agent auto-loads.

A 2026-08-12 audit of the downstream fleet showed what that produces. Fourteen
canonical repos carry `.claude/rules/`, with three mutually incompatible conventions
for the same filename:

- tunnlai/frontend: 838 lines, roughly half of it ESLint rules restated as prose
  (~32 machine-checkable, ~22 wiki-shaped, ~8 genuinely eager).
- tunnlai/tunnl-backend: 48 lines of provenance-tagged hard-won traps — the opposite
  genre, and the higher-value one.
- tunnlai/tunnl-infrastructure, propswap/infrastructure, and others: the empty
  template. tunnlai's infra traps were written into `AGENTS.md` and then deleted
  wholesale (`4058e71`) with no gate noticing the knowledge loss.

Nothing enforces a shape, nothing promotes a prose rule to a lint rule, nothing
demotes a codebase fact to the wiki. Two files in the fleet are not rules at all but
Lisa bug reports (geminisportsai infra `945b39c`, `b9b2ef3`).

## Decision

### 1. The canonical host-rules path is `.agents/rules/`

Host-authored, agent-neutral, one directory.

**This is a canonical *source* path, not a claim that every agent auto-loads it.**
Only Antigravity discovers `.agents/rules/` natively. Claude Code auto-loads
`.claude/rules/`, Cursor `.cursor/rules/*.mdc`, Copilot
`.github/copilot-instructions.md` plus `.github/instructions/*.instructions.md`, and
Codex builds an instruction chain from `AGENTS.md` files root-down. The `AGENTS.md`
pointer block (item 2) makes the directory *reachable* on the agents that read
`AGENTS.md` and follow relative references; it does not make it *eagerly loaded*
anywhere except Antigravity. Work unit A owns the per-agent delivery bridge and must
state, per agent, whether the rules arrive eagerly or on-demand — the parity tests
assert that real behavior rather than uniform delivery (see item 5 for the agy gap,
which is the one case where the difference is accepted rather than bridged). Chosen over `agents/rules/` because the
dot-prefixed spelling matches the existing `.agents/` tree (which already holds
`skills/` and `plugins/`) and because `.agents/rules` is **already reserved** in
`AUTO_LOADED_RULES_DIR_PREFIXES` (`src/core/project-config.ts:67`) — the blocklist
that keeps the learnings ledger from resolving into an eager-rule tree. Adopting the
spelling the guard already anticipates avoids a rename later and inherits the
ledger-collision protection for free.

### 2. Ownership is split and explicit

- `.agents/rules/` is **host-authored**. Lisa never writes rule bodies into it.
  This holds for work unit B's eager pack too: B does not ship a Lisa-generated pack
  *into* the host directory. `.agents/rules/` is the pack's **destination rung**, and
  content arrives there by human-gated promotion through the ladder — the gardener
  proposes, a human approves the ticket, and the promoted rule is written as host
  content the host then owns. Lisa's own shared rules never take that route; they stay
  on the `plugins/src/base/rules/` fan-out below. So there is no generated-file class
  in `.agents/rules/` and nothing for apply to overwrite or reconcile.
- Lisa's own shared rules keep originating at `plugins/src/base/rules/` and reaching
  agents through the existing per-agent build fan-out and `inject-rules.sh`.
- `AGENTS.md` receives a **Lisa-managed pointer block** naming the host-rules
  directory. Pointer only — never rule bodies. This is the mechanism the 2026-06-06
  update established (canonical, rule-free `AGENTS.md`) and it is preserved.

### 3. `projectRulesFile` and `PROJECT_RULES.md` are retired

The single-file concept goes away. `DEFAULT_PROJECT_RULES_FILE`, the sync-registry
entry, the create-only template, learnings-audit paths, and
`config-resolution.md` all move to the directory model. Existing host files are
migrated through the ladder (work unit K), not deleted in place: machine-checkable
content becomes lint/hook, wiki-shaped content becomes wiki pages, genuinely eager
rules move to `.agents/rules/`, and embedded Lisa bug reports become tracked Lisa
issues. Because `PROJECT_RULES.md` is the *human decree surface*, reclassification
rides human-gated tickets (the gardener model), never a silent agent rewrite.

### 4. Migration for installed projects is an idempotent managed block

`AGENTS.md` stays create-only for **overwrites**, but apply/doctor already makes
bounded managed edits to an existing file (`src/core/instruction-files-migration.ts`
strips the legacy `LISA_RULES_START..END` block and reconciles the agy
project-learnings bridge). The pointer block extends that existing machinery: add or
update the block, never touch surrounding host prose, no-op on repeat runs. A
template-only change is insufficient — current apply intentionally does not overwrite
an existing `AGENTS.md`.

### 5. agy: the no-eager-rules exception is **not** reversed

The 2026-06-06 decision accepted that agy receives no eager-rule injection because its
plugin hooks do not fire in `-p` headless mode. That stands. agy gets the same
canonical `AGENTS.md` with the same pointer block as every other agent; whether agy
*acts* on the pointer is a function of its own file-reading behavior, not of Lisa
baking anything.

This is deliberate and narrow. A pointer that says "read the files in
`.agents/rules/`" is not the same mechanism as baking rule bodies into `AGENTS.md`:
the earlier decision removed *content duplication*, and the pointer duplicates
nothing. But it does functionally restore rule *reachability* for agy, so the parity
tests must assert the real behavior rather than claiming identical delivery. Where
agy's delivery differs, the test names the gap.

### 6. Wiki posture softens from "consult first" to "query on demand" (D3)

The eager `wiki-knowledge-source` rule currently says *consult the wiki first* and
*use what the wiki says as the authoritative answer*. That is stronger and more
context-expensive than intended. It becomes: the wiki exists, query it when you need
depth, do not load it at session start. The query skill remains the retrieval path.

A packaging bug is **identified here and fixed by work unit A**, not by this
documentation-only change: the eager rule ships in the **base** plugin while
`lisa-wiki-query` ships only in the **wiki** plugin, so base-only projects get a rule
pointing at a skill they do not have. Two remedies are open — condition the rule on
the wiki plugin's presence, or move the skill into base. Choosing between them is
delegated to work unit A rather than settled here, because the choice turns on
packaging details (whether base may carry a wiki-shaped skill at all) that A has to
work out anyway. Until A lands, base-only projects still receive
`wiki-knowledge-source` without `lisa-wiki-query`; A is not done until that is closed
with a test proving a base-only install has no dangling rule.

## Alternatives Considered

- **`agents/rules/` (undotted).** Rejected: collides with no existing convention,
  clutters the repo root, and forfeits the `AUTO_LOADED_RULES_DIR_PREFIXES` reservation.
- **Keep `projectRulesFile` and just make it configurable per agent.** Rejected: it
  preserves the single-file blob that the fleet audit shows accreting into three
  incompatible genres. The problem is not the path, it is the absence of routing.
- **Reverse the agy exception and bake rules again.** Rejected: it reintroduces the
  content duplication PR #1150 removed, and the headless-hook gap it works around is
  still real. Better to accept a documented gap than a silent divergence between the
  file and the rule source.
- **Keep "consult the wiki first."** Rejected on context budget. The wiki is deep
  knowledge, and paying for it on every session start is exactly the cost the
  on-demand rungs of the ladder exist to avoid.

## Consequences

- Work unit A can proceed: path chosen, ownership defined, migration mechanism
  identified, agy behavior fixed.
- Work unit B's eager pack targets `.agents/rules/` as the EAGER-RULE rung.
- Work unit K's fleet cleanup has a destination for each class of existing content.
- Parity tests must encode the agy gap explicitly rather than asserting uniformity.
- `wiki/documentation/overview.md` is stale on this topic (it still says debrief writes
  to `PROJECT_RULES.md`) and is swept as part of work unit A.

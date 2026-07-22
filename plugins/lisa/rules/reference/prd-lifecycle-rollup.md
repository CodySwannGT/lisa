# PRD Lifecycle Rollup & Generated-Top-Level-Work Contract

This is the single vendor-neutral source of truth for how a PRD owns the work it generates and how its lifecycle rolls up to `shipped` from that work. Every PRD-source and PRD-intake skill (`prd-backlink`, `prd-ticket-coverage`, `*-prd-intake`, `*-to-tracker`) cites this rule by slug rather than restating it, so PRD→child linking and PRD closure rollup behave identically across GitHub, Linear, JIRA/Atlassian, Confluence, and Notion instead of drifting per vendor.

It defines four coupled things:

1. **Generated top-level work** — what a PRD owns as children (its created Epics / top-level Stories), explicitly **excluding** leaf Sub-tasks.
2. **Per-vendor terminal-state predicate** — how "this generated child is done" is decided for each source/tracker.
3. **PRD `shipped` transition + verified native closure** — when and how a PRD rolls up to shipped, remains eligible for verification, and closes only after verified.
4. **Idempotency dedupe key** — the child-ref identity that makes linking and rollup safe to re-run.

This is the PRD-level companion to `leaf-only-lifecycle`: that rule governs the *build* lifecycle of leaf work units and how a **parent container** rolls up from its leaf children; this rule governs the *PRD* lifecycle and how the **PRD** rolls up from its generated top-level children. The two share the rollup shape (terminal children → parent advances) and the multi-env terminal handling, applied at different levels of the hierarchy.

## Why this exists

PRD intake currently comments back with created ticket links, but the PRD is not necessarily the structural parent of the work it generated. That makes lifecycle rollup weaker than it should be: humans cannot always navigate from PRD to generated top-level work using the host tool's hierarchy UI, agents must parse free-form comments instead of reading a first-class relationship, and PRD shipped/closed state is not automatically derived from whether its generated work is done. Worst of all, cross-vendor implementations drift in how they record the PRD-to-work relationship and when they close a PRD.

The desired model is vendor-neutral: **the PRD is the source-of-truth parent for the top-level work it generated, and PRD lifecycle completion rolls up from that child set.** That belongs here, in a cross-vendor rule, and every backlink / intake / coverage path enforces it.

This surfaced in real GitHub-backed PRD intake (`CodySwannGT/advisory-rankings`): PRD issue #64 generated top-level Epic #65 plus child Stories/Sub-tasks. #65 should be a child/sub-issue of #64, and #64 should eventually transition/close when #65 and its descendants are complete — not before, and not twice.

## Generated top-level work (the contract)

**Generated top-level work** is the set of work units a PRD's intake/decomposition *directly created at the top of the hierarchy* and now owns as children:

| Class | Examples by type | Owned by the PRD as a child? |
|---|---|---|
| **Generated top-level work** | the created **Epic(s)**, and any **top-level Story** created directly under the PRD (a Story with no parent Epic) | **Yes** — these are the PRD's children for rollup |
| **Descendant work** | **Sub-tasks**, and **Stories that hang under a generated Epic**, and any leaf (Bug/Task/Improvement) under a top-level unit | **No** — owned by their top-level parent, not by the PRD directly |

The boundary is **structural, mirroring `leaf-only-lifecycle`'s container/leaf taxonomy but one level up**:

- A PRD owns its **top-level** generated units. Those top-level units own their own descendants (per `leaf-only-lifecycle`'s parent-status-rollup state machine).
- Leaf Sub-tasks are **never** direct children of the PRD when a top-level Epic/Story hierarchy exists (PRD #525 non-goal: "Do not make leaf implementation tasks direct children of the PRD when a top-level Epic/Story hierarchy exists"). The PRD owns top-level generated work; those top-level work units own their descendants.
- When a PRD decomposes into a flat set with no Epic (e.g. a few top-level Stories or a single leaf Task and nothing under it), the **top-level** items it created are its generated top-level work, whatever their type. The rule is "what the PRD created at the top," not "only Epics."

### How each vendor records the PRD→child relationship

The relationship is recorded with the source tool's **native hierarchy first**, falling back to a **durable documented section** in the PRD where native hierarchy is unavailable or the source and destination are different systems (PRD #525: vendors need not all expose identical native hierarchy):

- **GitHub Issues** — native **sub-issues**: the generated Epic issue becomes a sub-issue of the PRD issue when the repo supports sub-issues and source and tracker are the same repo. Otherwise a documented `## Tickets` / generated-work section.
- **Linear** — native **parent / project** relationships: a generated top-level Issue uses `parentId`, or a generated Project groups generated Issues; the PRD's relationship to its top-level Project/Issues is recorded natively where the PRD also lives in Linear.
- **JIRA** — native **Epic link / parent field** or a documented issue-link type for the PRD→Epic relationship where available.
- **Confluence / Notion** — no native issue hierarchy for tracker work: the PRD page carries a stable, machine-readable **generated-work section** (e.g. `## Tickets` / `## Generated Work`) listing the top-level refs and URLs.
- **Cross-vendor** (e.g. Notion PRD → JIRA tracker) — the destination ticket cannot become a native child of the PRD, so the relationship is **always** recorded in the PRD source artifact's documented section.

The documented-section fallback is always written so the generated child set is readable later without relying only on free-form comments. Comment summaries are still useful human-facing audit trails and are not removed (PRD #525 non-goal).

### Vendor relationship and closure matrix

Use this matrix when implementing or auditing a PRD-source integration. It describes the native relationship to prefer, the documented fallback that must remain durable, and the closure behavior after the all-terminal rollup condition is met.

| PRD source / tracker shape | Native hierarchy mechanism | Documented fallback | Closure behavior |
|---|---|---|---|
| **GitHub Issues (source and tracker in the same repo)** | Link generated top-level work as native sub-issues of the PRD issue when the repo supports GitHub sub-issues. The PRD's direct sub-issues are the generated top-level child set; descendants under those children are excluded from PRD rollup. | Always maintain the machine-readable `## Tickets` / `## Generated Work` section keyed by `owner/repo#number`, and use it when sub-issues are unavailable, disabled, or incomplete. | Rollup changes the PRD lifecycle label from `prd-ticketed` to `prd-shipped` when every required generated top-level issue is terminal and leaves the issue open for `/lisa:verify-prd`. Verified PASS closes the issue natively. |
| **Linear** | Use Linear native grouping where the PRD also lives in Linear: generated top-level Issues are related through `parentId`, or a generated Project groups the generated Issues. Read only top-level Issues for PRD rollup. | Use the PRD's machine-readable generated-work section when the destination tracker is not Linear or native project / parent relationships cannot represent the PRD-to-work link. Entries are keyed by Linear issue or project identifier / UUID. | Rollup removes `prd-ticketed` and adds `prd-shipped` to the PRD project when every required generated top-level Issue / Project is completed and leaves it active for `/lisa:verify-prd`. Verified PASS archives/completes it natively. |
| **JIRA / Atlassian tracker work** | Prefer native Epic / parent fields, or a documented issue-link type where the PRD-to-Epic relationship can be represented in JIRA. JIRA child terminal state is read from the issue's Done status category. | If the PRD source is not JIRA or the native link cannot attach tracker work to the PRD artifact, record generated top-level JIRA issue keys in the PRD's generated-work section. | Rollup may transition a JIRA-hosted PRD to the configured shipped status only after all required generated top-level issues are in the Done status category. Verified PASS performs native completion where supported. |
| **Confluence PRDs** | No native issue hierarchy for tracker work. Confluence's native structure is used for PRD lifecycle lanes by parent page, not for destination work children. | The Confluence page's machine-readable `## Tickets` / `## Generated Work` section is the primary child source. Top-level generated work entries are keyed by destination ticket ref. | Rollup re-parents the PRD page from the `ticketed` parent to the `shipped` parent when every required generated-work entry is marked done and leaves the page active for `/lisa:verify-prd`. Verified PASS archives it where supported. |
| **Notion PRDs** | No native issue hierarchy for tracker work. Notion's native status/select property stores PRD lifecycle state, not generated ticket parentage. | The Notion page's machine-readable `## Tickets` / `## Generated Work` section is the primary child source. Top-level generated work entries are keyed by destination ticket ref. | Rollup sets the configured Notion status/select value to `Shipped` when every required generated-work entry is marked done and leaves the page active for `/lisa:verify-prd`. Verified PASS archives it where supported. |
| **Cross-vendor PRD -> tracker** | Native hierarchy cannot cross systems, so the destination ticket is not expected to become a native child of the PRD artifact. Native tracker hierarchy still applies inside the destination system among generated Epics, Stories, and Sub-tasks. | The source PRD artifact's generated-work section is authoritative for the PRD-to-top-level-work child set, and each entry links to the destination ticket URL / key. | The PRD source owns the lifecycle transition. It evaluates terminal state using the destination tracker's predicate, applies the source vendor's `shipped` transition, leaves the PRD open/active, then `/lisa:verify-prd` owns verified native closure. |

## Per-vendor terminal-state predicate

A generated top-level child is **terminal** (counts as done for rollup) when it reaches the source/tracker's done/shipped state. The predicate is vendor-specific; the *semantics* ("this child has shipped") are not:

| Vendor | A generated top-level child is terminal when… |
|---|---|
| **GitHub Issues** | the issue is **closed** *and* (where the build-status label is used) carries the resolved `done` role label (`status:done` by default — env-keyed; see below). A closed-as-not-planned issue is terminal-but-dropped: it does not hold the PRD open but is excluded from "shipped" (treated like a won't-do leaf). |
| **Linear** | the Issue/Project is in a **completed** workflow state (`done`-category), **or** a **canceled** or **duplicate** state (both terminal-but-dropped, like not-planned — do not hold the PRD open, excluded from shipped). Linear exposes `duplicate` as its own first-class `state.type`, distinct from `canceled`; an Issue marked as a duplicate (via Linear's native action or a team's Duplicate workflow state) is terminal and must be treated like canceled, never as still-open. |
| **JIRA** | the issue's status is in the **Done status category** (`statusCategory.key == "done"`). |
| **Confluence / Notion** | the documented generated-work entry is marked **done** in the PRD's machine-readable section (the durable equivalent of a closed ticket, since these sources have no native ticket state). |

Notes:

- **Required vs. optional children.** Only the generated top-level children that must ship for the PRD to be complete are counted toward the all-terminal check. Won't-do / canceled / duplicate / not-planned children are terminal-but-dropped: they do not hold the PRD open and are excluded from the shipped set. This mirrors `leaf-only-lifecycle`'s "required leaves" qualifier.
- **Recursion is delegated, not duplicated.** A generated Epic is terminal only when *it* has rolled up to its own terminal state per `leaf-only-lifecycle`'s parent-status-rollup (all its required Stories/Sub-tasks terminal). This rule does not re-derive an Epic's state from its leaves — it reads the top-level child's own resolved state and trusts `leaf-only-lifecycle` to have rolled that up bottom-up.
- **Blocked dominates at the report level.** If any required generated top-level child is blocked or incomplete, rollup leaves the PRD open and reports the incomplete child set (PRD #525: "rollup leaving a PRD open when at least one generated top-level child is incomplete"). The PRD is only advanced when **all** required top-level children are terminal.

### The terminal `done` is the configured, env-keyed value — multi-env capable

Where a vendor's terminal predicate references the build-status `done` role (GitHub/Linear labels), that value is the project's configured `done` — which is **env-keyed** (`config-resolution` "Env-keyed `done`"): a map keyed by environment (`dev`, `staging`, `production`), resolved from the merged PR's base branch. This rule does **not** hardcode a `dev → staging → prod` promotion chain; a multi-env project counts a child as terminal when it reaches whichever `done` value matches the environment it shipped to.

**Single-environment collapse (this repo).** Lisa's own deploy has only `main`/`production` (`deploy.branches = production: main`, no dev/staging), so `done` is a single value, not a map, and the build lifecycle collapses to one chain: `ready → claimed (in-progress) → review (code-review) → done`. A generated top-level child is terminal when it reaches the single `status:done`; rollup never resolves a `dev` or `staging` `done` in this repo. This is the *collapsed* case of the generic rule, not a different rule — projects with more environments keep the env-keyed map.

## PRD `shipped` transition and verified native closure

When **all required** generated top-level children are terminal, the PRD rolls up to its `shipped` PRD-lifecycle state and remains open/active for the initiative-level verification loop:

1. **Transition to `shipped`.** Set the PRD to the configured `shipped` role (`config-resolution` PRD-lifecycle roles: `prd-shipped` label for GitHub/Linear, `Shipped` status for Notion, the shipped parent page for Confluence). The PRD lifecycle is `ready → in_review → (blocked | ticketed) → shipped → verified`; rollup performs the `ticketed → shipped` hop only, and only on the all-terminal condition. The subsequent `shipped → verified` (pass) / `shipped → ticketed` (fail) hops are owned by PRD-level verification (`/lisa:verify-prd`), **not** by this rollup — see "PRD-level verification vs ticket verification" below.
2. **Leave `shipped` open for verification.** Rollup never closes, archives, or completes the PRD at the `shipped` hop. `shipped` is the queue for `/lisa:verify-prd`, so closing here would hide the PRD from the acceptance gate.
3. **Verified closes natively.** When `/lisa:verify-prd` passes, it transitions `shipped → verified` and then closes, archives, or completes the PRD where the source tool supports a native terminal action. The verified native close is mandatory and idempotent; there is no project-configurable close-on-verified escape hatch.
4. **Partial completion is a no-op + report.** If only some required children are terminal, leave the PRD in its current state and report the incomplete/blocked child set. Do not advance, do not close.

The PRD never advances to `shipped` on its own authority — it is **derived** from the generated-top-level-child set, exactly as a container's state is derived from its leaves in `leaf-only-lifecycle`.

## PRD-level verification vs ticket verification

`shipped` and `verified` are two different terminal facts about a PRD, and they are established by two different flows. Keeping them distinct is the whole point of the `verified` state:

| | `shipped` | `verified` |
|---|---|---|
| **Meaning** | All generated top-level work is terminal — the work graph is *complete* | The shipped product has been *empirically checked against the PRD itself* |
| **Established by** | This rollup (`ticketed → shipped`), derived from child-ticket state | `/lisa:verify-prd`, the initiative-level acceptance gate |
| **Evidence** | The terminal-child set (closed issues / done labels / completed states) | Spec-conformance against the PRD's requirements + empirical proof (browser/computer use, API/CLI/DB checks, screenshots, logs) |
| **Ownership** | Set by the intake rollup phase; product may also set by hand | Product-owned, like `draft` and `shipped`; set only by `/lisa:verify-prd` |

`shipped` is **necessary but not sufficient** for `verified`: a PRD can have every ticket closed while still missing a requirement, diverging from its acceptance criteria, or failing a real user workflow. `verified` is what proves the shipped product actually matches the PRD.

**`/lisa:verify` (one work item) vs `/lisa:verify-prd` (the whole initiative).** These are deliberately separate scopes:

- **`/lisa:verify`** empirically verifies a **single work item** (a ticket / story / sub-task) in its target environment as part of that item's Build/Fix/Improve flow. It is what drives a build ticket to its `done` state; it operates at the *leaf/build* level (see `leaf-only-lifecycle`). It does **not** read the PRD or judge initiative-level acceptance, and it is **not** replaced by PRD verification.
- **`/lisa:verify-prd`** is the **initiative-level acceptance gate**. It runs *after* the PRD is `shipped` (all generated top-level work terminal), reads the PRD and its generated child set, confirms the children are terminal, then runs spec-conformance against the original PRD requirements plus empirical verification of the shipped surface. On pass it transitions the PRD `shipped → verified` and posts evidence; on fail it **re-opens the PRD `shipped → ticketed`** (never `blocked`), creates **build-ready fix tickets** for the missing or incorrect behavior (registered as the PRD's generated work) and posts a product-readable failure report — the fix tickets auto-build, rollup re-ships the PRD once they are terminal, and a later cycle re-verifies (self-healing; see "Closing the loop" below). Re-runs are idempotent (no duplicate evidence, fix tickets, or lifecycle transitions).

**No extra failure states, and verification never uses `blocked`.** A failed PRD verification does **not** move the PRD to `blocked`; it re-opens the PRD `shipped → ticketed` and creates build-ready fix tickets (see "Closing the loop"), forming a self-healing loop rather than parking the PRD for a human. It introduces no `prd-verifying` or `prd-verification-failed` state — the lifecycle stays intentionally small, and `blocked` remains the *intake* (ready-stage validation) failure state, not the verification one. `verified` is terminal and product-owned (like `draft` and `shipped`); a PRD is never moved to `verified` solely because its tickets are closed, and a PRD is never closed/archived before verification has passed. The vendor maps for the `verified` role (`prd-verified` label for GitHub/Linear, `Verified` status for Notion, the verified parent page for Confluence) live in the `config-resolution` rule.

### Closing the loop: PRD intake dispatches `/lisa:verify-prd` for shipped PRDs

`shipped → verified` does not happen on its own — something has to run the acceptance gate. The PRD-intake scanners close that loop: in addition to the `ticketed → shipped` rollup, each PRD-intake cycle **dispatches `/lisa:verify-prd` for a shipped PRD** so a shipped PRD does not sit unverified forever. This is a **dispatch**, not a transition — the intake scanner still never *sets* the verification outcome itself; `/lisa:verify-prd` (which it invokes) performs the `shipped → verified` (pass) or, on fail, the `shipped → ticketed` re-open (it **never** uses `blocked`), with its own guard, evidence, and build-ready fix-ticket creation.

**The self-healing FAIL loop.** When verify-prd fails it re-opens the PRD `shipped → ticketed` and creates **build-ready** fix tickets (registered as the PRD's generated work). Because the fix tickets are build-ready they are auto-claimed by the build queue with no human promotion; once they reach terminal, the `ticketed → shipped` rollup (Phase 3f) re-ships the PRD, and the next cycle's verify dispatch (Phase 3g) re-verifies. PASS ends at `verified`; FAIL starts another round. The loop **never auto-halts** (the failure report carries a verification-round count for human visibility) and **never** parks the PRD in `blocked`.

Bounded, like the ready claim: `/lisa:verify-prd` is a heavy full flow (spec-conformance + empirical verification + fix-ticket creation), so a scanner verifies **one shipped PRD per cycle** and lets the scheduler drain the rest — the same one-item-per-cycle discipline the `ready` claim uses. After verify-prd runs, the PRD leaves `shipped` (to `verified` on pass, or `ticketed` on fail), so it is not re-picked by the shipped query that cycle; a PRD whose generated work is not actually terminal is guard-stopped by verify-prd and left `shipped` (verify-prd's gate, not the scanner's). This dispatch is **behaviorally identical across all four PRD-intake skills** (the `github` / `linear` / `notion` / `confluence` `*-prd-intake` Phase 3g); only the `shipped`-role query surface differs.

## Idempotency dedupe key

Linking and rollup MUST be safe to re-run: re-running intake, backlink, or rollup never produces duplicate child links, duplicate sub-issues, duplicate generated-work entries, or a double `shipped` transition (PRD #525: "Re-running backlink or rollup is idempotent").

The dedupe key is **child-ref identity** — the stable, vendor-native identifier of each generated top-level child:

- **GitHub** — `owner/repo#number` (the issue ref).
- **Linear** — the issue/project identifier (e.g. `TEAM-123`) or its UUID.
- **JIRA** — the issue key (e.g. `PROJ-123`).
- **Confluence / Notion** — the destination ticket ref recorded in the generated-work entry (the entry is keyed by that ref, not by list position).

**Match by stable ref, never by title.** Identity is the child-ref above and *only* the child-ref — never the child's title, summary, or any other mutable field. A child whose **title changed but whose ref is unchanged is the same child**: re-running linking/backlink matches it by ref, updates the displayed title in place, and does **not** create a second link or a duplicate generated-work entry. Conversely, two distinct refs are two distinct children even if their titles happen to be identical. Title-based matching would both miss a renamed child (duplicating it) and falsely collapse two same-named children, so it is never used as the dedupe key (PRD #525: "Dedupe matches by stable ref not title").

Apply it as follows:

- **Linking** is keyed by child-ref: before adding a native child link or a documented generated-work entry, check whether that exact child-ref is already linked/listed; if so, it's a no-op. The documented generated-work section is **regenerated** from the current child set on each run rather than appended, so re-planning never accumulates stale or duplicate entries (the same regenerate-don't-append discipline `prd-backlink` already uses for its `## Tickets` section).
- **Rollup** is keyed by the PRD's current state: a PRD already in `shipped` (and closed, when closure is configured) is a no-op — rollup does not re-transition or re-close it. Computing the all-terminal condition over the child-ref set is itself idempotent (a pure function of the children's current states).

## Citation

Skills that link generated work to a PRD or roll a PRD up cite this rule by slug (the `prd-lifecycle-rollup` rule) instead of restating it:

- **PRD backlink / native linking** (`lisa-prd-backlink`) — record generated top-level work as native PRD children where supported; always write the documented generated-work fallback; dedupe by child-ref. *(LPC-1.1 #580, LPC-1.2 #582)*
- **PRD coverage** (`lisa-prd-ticket-coverage`) — read the generated top-level child set deterministically from the recorded relationship, not from free-form comments.
- **GitHub PRD shipped rollup** (`lisa-github-prd-intake`) — detect terminal/incomplete/blocked child sets, transition to `prd-shipped`, and leave the PRD open for `/lisa:verify-prd`. *(LPC-1.3 #583)*
- **Linear / Confluence / Notion PRD shipped rollup** (`lisa-linear-prd-intake`, `lisa-confluence-prd-intake`, `lisa-notion-prd-intake`) — mirror the GitHub shipped rollup with each vendor's terminal predicate and keep the PRD active for verification. *(LPC-1.3 #584)*
- **Repair close-out** (`lisa-repair-intake`) — re-run the same generated-top-level-work terminal
  predicate to close out PRDs that were left open after all associated child work became terminal,
  without setting the product-owned `verified` role.
- **Idempotency** (all of the above) — dedupe-by-ref linking and no-op already-shipped rollup. *(LPC-1.4 #585)*
- **Vendor matrix documentation** — describe native-hierarchy vs documented-link fallback per supported vendor against this contract. *(LPC-1.5 #586)*

This is the PRD-level companion to `leaf-only-lifecycle` (which governs the build lifecycle and parent-from-leaves rollup); together they define the full hierarchy: a PRD owns its generated top-level work, which owns its leaves, and terminal state rolls up bottom-to-top — leaf → top-level unit → PRD.

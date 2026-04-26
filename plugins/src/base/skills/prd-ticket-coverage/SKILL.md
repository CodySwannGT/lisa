---
name: prd-ticket-coverage
description: "Verifies that every requirement in a Notion PRD is covered by at least one created JIRA ticket — no silent drops. Parses the PRD into atomic items (goals, user stories, functional/non-functional requirements, acceptance criteria, important notes), maps each to the created tickets, and produces a coverage matrix and verdict (COMPLETE / COMPLETE_WITH_SCOPE_CREEP / GAPS_FOUND / NO_TICKETS_FOUND). Used by notion-prd-intake post-write to gate the Status=Ticketed transition; can also be invoked standalone for after-the-fact audits."
allowed-tools: ["Skill", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-get-comments", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# PRD Ticket Coverage Audit: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A PRD URL alone — auto-discover created tickets via the PRD's epic remote link.
2. A PRD URL plus an explicit list of ticket keys — `<PRD URL> tickets=[KEY-1,KEY-2,...]`. Use this when called from `notion-prd-intake` (which knows the keys it just created).

Verify that every atomic item in the PRD is covered by at least one of the listed/discovered JIRA tickets. The output gates whether the PRD's `Status` should remain `Ticketed` or revert to `Blocked`.

## Why this exists

Per-ticket gates (`jira-validate-ticket`) prove each created ticket is well-formed in isolation. They do NOT prove the *set* of created tickets is complete relative to the source PRD. Silent drops happen — an agent generates 8 tickets when the PRD called for 9, and nothing notices. This skill is the catch.

## Phases

### Phase 1 — Resolve inputs

1. Parse `$ARGUMENTS`:
   - PRD URL → extract page ID.
   - Optional `tickets=[...]` → list of explicit ticket keys.
2. Fetch the PRD via `notion-fetch` with `include_discussions: true`. Capture: title, body, child Epic pages, all comment threads.
3. If the PRD has child Epic sub-pages (a multi-epic PRD like Home revamp), fetch each in parallel with `include_discussions: true`. The audit walks the full PRD tree.
4. If `tickets=[...]` not provided, locate the JIRA epic by:
   - Looking for a JIRA URL in the PRD body, comments, or the PRD's most recent "Ticketed by Claude" comment posted by `notion-prd-intake`.
   - Searching JIRA via `searchJiraIssuesUsingJql` for an epic whose summary or description references the PRD title or page ID.
   - If no epic found, return verdict `NO_TICKETS_FOUND` with a clear remediation — coverage cannot be assessed without the ticket set.
5. Once the epic is known, fetch all child stories and sub-tasks via JQL: `"Epic Link" = <EPIC-KEY>` and recursively for sub-tasks.

### Phase 2 — Extract atomic PRD items

Walk the PRD content and produce a list of **atomic items** — testable, ticketable units of work. Each item gets a stable identifier so the matrix is auditable.

The item types to extract:

| Type | Where it appears in the PRD | Example identifier |
|------|----------------------------|--------------------|
| `goal` | `## Goals` section bullets | `goal:1`, `goal:2`, ... |
| `non-goal` | `## Non-goals` (for scope-creep detection) | `non-goal:1` |
| `user-story` | Per-Epic page, "User Story" sub-headings | `epic-1.story-1.1` |
| `functional-req` | "Functional Requirements" sub-section | `epic-1.story-1.1.fr-1` |
| `non-functional-req` | "Non-functional Requirements" sub-section | `epic-1.story-1.1.nfr-1` |
| `acceptance-criterion` | Inline AC under a user story | `epic-1.story-1.1.ac-1` |
| `important-note` | Bold "Important note:" callouts | `note:1` |
| `mobile-spec` | Mobile-specific behavior callouts | `epic-1.story-1.1.mobile-1` |
| `state` | Empty / error / loading state notes | `epic-2.story-2.1.state:empty` |
| `permission` | Role-scoped permission notes | `epic-2.story-2.1.perm:admin` |
| `decision` | Confirmed decisions in comments (e.g. "Engineering: ...") | `comment:42` |

**Items NOT to extract** (these are not coverage gaps if missing):
- Open Questions / `[Needs validation]` items — these are PRD-side blockers, not ticket scope.
- Original concept thesis or annex/historical content — context, not requirements.
- "Out of scope" items in the PRD — explicitly excluded by product.

For each extracted item, capture: `{ id, type, source (PRD section / line), text (concise summary), keywords (3-5 terms for matching) }`.

### Phase 3 — Map items to tickets

For each created ticket (epic + each story + each sub-task), capture: `{ key, summary, description, acceptance_criteria, scope_signals (keywords from summary + AC) }`.

Build a coverage matrix:

```text
PRD item id  →  [ticket keys that cover it]
```

Matching rules (in priority order):

1. **Direct quote / strong keyword overlap**: the ticket's summary or AC explicitly names the PRD item's keywords. High confidence.
2. **Domain match**: PRD item describes a UI affordance ("Tasks widget") and a ticket scopes that affordance (`[CU-2.1] Tasks widget — empty state`). Medium-high confidence.
3. **Scope inheritance**: PRD item is a sub-detail of a parent (e.g. an AC under a user story); the ticket covers the parent user story. Medium confidence — flag for review if no more specific ticket exists.
4. **Cross-ticket coverage**: PRD item spans multiple tickets (e.g. a permission rule that applies to several widgets). Each contributing ticket is recorded.

Items with **zero** matching tickets are coverage gaps.

### Phase 4 — Detect scope creep (informational)

For each created ticket, identify any tickets whose scope_signals do NOT trace back to a PRD item, AND are not justifiable as standard infrastructure tasks (e.g. `X.0 Setup` stories for data model / migrations are typically infrastructure scaffolding, not scope creep).

Scope creep is informational, not blocking — but worth surfacing because it usually indicates the agent invented work.

### Phase 5 — Determine verdict

| Condition | Verdict |
|-----------|---------|
| All extracted PRD items have ≥1 matching ticket; no scope creep | `COMPLETE` |
| All extracted PRD items have ≥1 matching ticket; one or more scope-creep tickets | `COMPLETE_WITH_SCOPE_CREEP` |
| One or more PRD items have zero matching tickets | `GAPS_FOUND` |
| The created-tickets list is empty or unfetchable | `NO_TICKETS_FOUND` |

`GAPS_FOUND` is the only verdict that should gate the PRD's `Status`. Scope creep is advisory — surface it, but do not block.

### Phase 6 — Emit report

Output a single fenced text block. Callers parse it; do not add free-form prose around it.

```text
## prd-ticket-coverage: <PRD title>

PRD page: <URL>
Tickets audited: <epic-key> + <story-count> stories + <subtask-count> sub-tasks
Atomic PRD items extracted: <n>

### Coverage matrix
| PRD item | Tickets |
|----------|---------|
| <id> (<type>) — <text> | <ticket-key>, <ticket-key> |
| <id> (<type>) — <text> | <ticket-key> |
| <id> (<type>) — <text> | **(none)** |
| ... | ... |

### Gaps  (PRD items with zero ticket coverage — blocks Ticketed status)
- <item-id> (<type>) — <text>
  - *Source:* <PRD section reference>
  - *Suggested fix:* <add a ticket scoped to X / extend ticket Y to cover this / clarify whether this is in scope>

### Scope creep  (tickets without PRD trace — informational, does not block)
- <ticket-key> — <summary>
  - *Why flagged:* <reason — e.g. "no matching item in PRD; not an infra task">

### Verdict: COMPLETE | COMPLETE_WITH_SCOPE_CREEP | GAPS_FOUND | NO_TICKETS_FOUND
### Gap count: <n>
### Scope-creep count: <n>
```

## Rules

- Read-only — never write to JIRA, never write to Notion (callers do that based on the verdict).
- Never silently drop a PRD item from extraction. If an item is ambiguous about whether it's scope, include it in extraction with type `ambiguous` and let the matching phase resolve it. The point of the audit is to catch silent drops; the audit can't have its own.
- Be explicit about confidence in matches — the matrix is for humans to skim; vague matches help no one. If a match is rule-3 ("scope inheritance"), say so.
- Scope creep is INFORMATIONAL. It is normal for an agent to add infra tickets (`X.0 Setup`) the PRD doesn't explicitly enumerate. Only flag scope creep when the ticket genuinely doesn't trace to PRD content AND isn't standard scaffolding.
- The `GAPS_FOUND` verdict is the gate. The caller (e.g. `notion-prd-intake`) uses it to decide whether to revert `Status` from `Ticketed` to `Blocked`.

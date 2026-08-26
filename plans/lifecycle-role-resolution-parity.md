# Standardize lifecycle-role resolution across JIRA / GitHub / Linear

## Context

An agent moved two issues on a downstream board into the Linear state `Awaiting Code Review` — a
human-only state that is **not** configured in that project's `.lisa.config.json`. Tracing it
surfaced a class of drift, not a one-off bug.

That project's config binds `linear.workflow` = `{ready, claimed, blocked, done, qa}`.
There is deliberately **no `review` key**: the project's policy is that a PR-open ticket stays in
`claimed` until it reaches an environment. Four independent defects combined to override that.

### Measured evidence

**1. `read_role` is copy-pasted, and the copies have diverged.**

12 skills inline their own `read_role()` bash helper. Hashing the function bodies gives **11
distinct implementations** — only `lisa-linear-build-intake` and `lisa-linear-evidence` agree:

```
skills/lisa-github-build-intake     ab911225…
skills/lisa-github-prd-intake       4e509720…
skills/lisa-github-write-prd        4e7edb0f…
skills/lisa-jira-build-intake       658e63ac…
skills/lisa-linear-build-intake     7d261a72…  ┐ the only pair
skills/lisa-linear-evidence         7d261a72…  ┘ that matches
skills/lisa-linear-prd-intake       21bba5bd…
skills/lisa-notion-prd-intake       f916a809…
skills/lisa-repair-intake           49a300d3…
skills/lisa-setup-github            28b3714f…
skills/lisa-setup-linear            70dd4853…
skills/lisa-verify-prd              8dd41d25…
```

This is the root cause. Everything below is a symptom of having no single resolver.

**2. "Unset" cannot be distinguished from "not customized."**

`lisa-linear-evidence:27` resolves `REVIEW=$(read_role review "In Review")`. The helper is
local-config → global-config → **default**, so an absent `review` key yields the literal
`In Review`. The project's policy — *we have no review step* — is inexpressible.

JIRA already solves this correctly. `lisa-jira-evidence/scripts/post-evidence.sh:160`:

```bash
REVIEW=""                       # ← empty default
_cfg=$(jq -r '.jira.workflow.review // .jira.workflow.code_review // empty' .lisa.config.json)
...
if [ -n "$REVIEW" ]; then  jira issue move "$TICKET_ID" "$REVIEW"
else  echo "No jira.workflow.review configured; leaving $TICKET_ID in its current (claimed) status"
```

Its header comment states the contract outright: *"skipped entirely when review is unconfigured —
stays in claimed."* That is the behavior the whole codebase should have.

**3. The sync skills do not resolve roles at all.**

`grep -c read_role` across the three sync skills: **jira 0, github 0, linear 0.** All state/label
names are literals. `lisa-linear-sync` is the one that matters because it is also the only sync
skill with a write path:

| | `lisa-jira-sync` | `lisa-github-sync` | `lisa-linear-sync` |
|---|---|---|---|
| resolves roles from config | ✗ (literals, but text says "configured … or no transition when unconfigured") | ✗ (literals) | ✗ (literals) |
| can write the lane | ✗ suggest-only | ✗ "This skill never relabels" | **✓ `--update-state`** |
| unset `review` ⇒ skip | ✓ documented `:75`, `:100` | ✓ no review lane at all | ✗ defaults |
| anti-free-select clause | ✓ `:78` | ✗ | ✗ |

**4. A read-only fallback is being used for writes.**

`config-resolution.md:459` defines a Linear-only affordance: when a configured name is missing, a
skill may fall back to team states by `type` — `claimed`/`review` → **the lowest-position
`started`** — *"but only to read … it must never invent a state to write into."*

That fallback explains the exact state chosen. That board's `started` states by position:

| # | position | state | bound role |
|---|---|---|---|
| 1 | -1989.26 | Blocked | `blocked` |
| 2 | -1478.50 | In Progress | `claimed` |
| **3** | **-1209.69** | **Awaiting Code Review** | **none** |
| 4 | -1079.70 | In Review | none |

`blocked` and `claimed` are taken; the next unbound `started` state is `Awaiting Code Review`.
Not fuzzy matching — position ordering, used for a write the rule forbids.

**5. The docs already contradict each other**, independently of Linear:

- `config-resolution:355` lists `review: "In Review"` in the Linear defaults;
  `config-resolution:448` says *"projects … can omit it and lifecycle skills will skip the
  intermediate transition."* Both in the same file.
- `lisa-tracker-sync:24` documents a `--update-label` flag "on GitHub";
  `lisa-github-sync:80` says *"This skill never relabels."* A caller passing `--update-label`
  gets a silent no-op on GitHub and a real write on Linear for the equivalent flag.
- `lisa-tracker-sync` frontmatter says *"Suggests (never auto-transitions) the next status"*
  while its own `:68` documents both lane-write flags.

## What must NOT be flattened

Standardizing the **contract** — not the vendor mechanics. These differences are real:

- The lane is a different object per vendor: GitHub `status:*` label, JIRA status, Linear native
  workflow state.
- GitHub genuinely has no review lane (`config-resolution:442`, "no default review label"). Do not
  invent one.
- Linear's `type`-aware fallback is legitimate **for reads** — Linear states carry a `type`, JIRA
  statuses and GitHub labels do not.

## Design

Follow the pattern the repo already uses twice: shared policy lives in one place, vendor arms cite
it. `--rollup`'s state machine lives in `lisa-tracker-sync` and `lisa-github-sync:84` says
*"cite that rule, do not restate the policy."* Shared executable logic lives in
`plugins/src/base/scripts/*.mjs` and skills shell out via `${CLAUDE_PLUGIN_ROOT}/scripts/…`
(precedent: `lifecycle-label-trust.mjs`, `automation-run-record.mjs`).

### Rule R1 — absent means skip, never default

A lifecycle role that is **absent** from config resolves to empty, and the caller **skips the
transition**. Only `ready`, `claimed`, `blocked` and `done` carry built-in defaults; `review` and
`qa.*` are optional and have **no default**. This is JIRA's existing behavior, generalized.

### Rule R2 — a fallback may inform a read, never supply a write target

The Linear `type`-aware fallback stays for reads and is refused for writes, enforced by the
resolver rather than restated in prose.

### Rule R3 — one resolver

New `plugins/src/base/scripts/resolve-lifecycle-role.mjs`. Single implementation of local-overrides-
global, env-keyed `done`, R1 and R2. All 12 skills call it instead of inlining bash.

## Work items

| # | File | Change |
|---|---|---|
| 1 | `scripts/resolve-lifecycle-role.mjs` **(new)** | The resolver. `--role`, `--vendor`, `--intent=read\|write`, `--env`. Exit 0 + value; exit 0 + empty for an optional unset role; exit 2 for a required unset role. Refuses to emit a fallback value when `--intent=write`. |
| 2 | `scripts/__tests__/resolve-lifecycle-role.test.mjs` **(new)** | Cases: absent optional role ⇒ empty; absent required role ⇒ exit 2; local overrides global; env-keyed `done`; write-intent refuses fallback; all three vendors. |
| 3 | `skills/lisa-linear-sync/SKILL.md` | Resolve roles via the script; drop the four literals from the milestone table and Phase 4; skip any milestone whose role is unset. |
| 4 | `skills/lisa-linear-evidence/SKILL.md` | Replace `read_role review "In Review"` with the resolver; add the explicit skip branch mirroring `post-evidence.sh:174`. |
| 5 | `skills/lisa-jira-sync/SKILL.md` | Resolve via the script (behavior already correct — this removes the literals so it cannot drift). |
| 6 | `skills/lisa-github-sync/SKILL.md` | Same; and settle `--update-label` — implement it or delete it from the shim (see Decision D1). |
| 7 | `skills/lisa-tracker-sync/SKILL.md` | Hoist the anti-free-select clause from `lisa-jira-sync:78` so all three arms cite one copy. Fix the frontmatter/`:68` contradiction. |
| 8 | `rules/eager/config-resolution.md` + `rules/reference/config-resolution.md` | Remove `review` from the Linear default map (`:355`) so it agrees with `:448`. State R1 and R2 as normative. |
| 9 | remaining 10 `read_role` skills | Swap the inlined helper for the resolver. Mechanical; no behavior change intended. |
| 10 | `bun run build:plugins` | Regenerate `lisa`, `lisa-agy`, `lisa-copilot`, `lisa-cursor`, `.codex-plugin` per the AGENTS.md parity rule. |

## Decision D1 — may a sync skill write the lane?

Three files disagree today. Proposed resolution, matching the strictest existing arm and the shim's
own stated intent:

- **Sync suggests; it never writes.** Lane writes belong to the build-intake / agent owner, which is
  already true on JIRA and GitHub.
- Remove `--update-state` from `lisa-linear-sync` and `--update-label` from the shim's docs.
- `--rollup` keeps its write path — parent derivation is its whole purpose and is separately gated.

This is a **behavior change on Linear**: callers currently passing `--update-state` stop moving the
ticket. That is the intended outcome, and it is what makes that project's policy hold.

## Acceptance criteria

```gherkin
Scenario: An unset optional role skips the transition
  Given .lisa.config.json has linear.workflow with no "review" key
  When a lifecycle skill resolves the review role for a pr-ready milestone
  Then the resolver returns empty
  And no state transition is attempted
  And the ticket remains in its claimed role

Scenario: A fallback never supplies a write target
  Given a Linear team with states not named in the configured workflow map
  When a role is resolved with --intent=write and the configured name is missing
  Then the resolver refuses to return a positional or type-derived state
  And it reports a setup defect naming /lisa:setup:linear

Scenario: One resolver, no copies
  Given the skills tree
  When read_role() function bodies are counted
  Then there are zero inlined definitions
  And every lifecycle-role read goes through resolve-lifecycle-role.mjs

Scenario: The three vendors agree on the contract
  Given lisa-jira-sync, lisa-github-sync and lisa-linear-sync
  When each is asked to handle a milestone whose role is unconfigured
  Then all three post a comment and perform no transition
```

## Out of scope

- Adding a `review` role to any project's config. The point is that omitting it must work.
- Changing the downstream Linear board (retiring `Awaiting Code Review` / `In Review`). Those stay
  human-only states; this change is what stops agents reaching them.
- The JIRA↔Linear ticket-mirror integration that files tickets already in `Blocked`. Separate defect,
  separate owner.

## Repository

`CodySwannGT/lisa` — PR targets `main`. Edits in `plugins/src/base/`; the five agent variants are
generated by `bun run build:plugins`.

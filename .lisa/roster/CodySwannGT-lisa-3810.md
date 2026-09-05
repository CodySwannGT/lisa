# Roster Decision — CodySwannGT/lisa#3810

Flow: Implement / **Fix** (type:Bug). Work item bound in an isolated worktree, on branch
`fix/3810-cleanup-unreadable-guard` for the deletion-hazard pull request; the remainder of the
ticket is checkpointed on `fix/3810-worktree-discoverability`.

**Nested-flow note.** This flow runs inside an existing team; this session is a teammate, not the
lead. Per `lisa-implement`'s nested branch, named teammates can only be added by the team lead, so
specialists were requested from the lead and bounded one-shot work delegated to anonymous subagents
whose results return here. That constraint is recorded rather than used to justify doing the work
inline.

**Outcome of that request: no fan-out.** The lead declined five named specialists as
disproportionate for a two-point item and directed the fallback — bounded anonymous subagents plus
an independent verifier. So the INCLUDE lines below record which specialist *type* each bounded
subagent was spawned as, not a named teammate on the roster. **The named lifecycle specialists were
unavailable, and this flow does not report them as run.** An unavailable check is not a passing one.

**Delivery split.** The lead further directed that gap 2 — the cleanup script reading an unreadable
worktree as clean and then deleting it — ship as its own pull request ahead of the rest, because it
is the only arm with data-loss consequence. This roster covers both pull requests; the remainder of
the work is checkpointed on `fix/3810-worktree-discoverability`.

## Every agent type the runtime exposes

| | agent type | reason |
| --- | --- | --- |
| INCLUDE | `Explore` | Mandatory per the skill. Already used for the bounded input-resolver reconnaissance that mapped all five worktree-surveying surfaces. |
| INCLUDE | `general-purpose` | The runtime's only unrestricted delegate; used for the input-resolver transaction (resolve/claim/bind) and for bounded implementation slices where no narrower specialist fits. |
| INCLUDE | `lisa:test-specialist` | The deliverable is largely test coverage — the discriminating case (a real out-of-tree worktree with uncommitted changes) is covered by nothing today, and `worktree-inventory.ts` has no test file at all. |
| INCLUDE | `lisa:bug-fixer` | type:Bug with a mandatory Reproduce sub-flow: a failing test proving `doctor-worktree-hygiene` cannot see an out-of-tree worktree must exist before any fix. |
| INCLUDE | `lisa:quality-specialist` | Reviews the branch against the coding philosophy and the repo's immutability/complexity budgets before PR. |
| INCLUDE | `lisa:verification-specialist` | Non-negotiable: writes the schema-v2 verdict, and must not be the agent that implemented the change. |
| INCLUDE | `lisa:learner` | Captures MLD to the ledger at task end, per the skill. |
| EXCLUDE | `lisa:architecture-specialist` | The design is settled by the ticket itself — Direction 1 (`git worktree list`) and four surfaces already implement it. No architecture to trace. |
| EXCLUDE | `lisa:security-specialist` | No auth, secrets, input-handling, or trust-boundary change. The one adjacent concern (a deleting surface reading an unreadable worktree as clean) is a correctness defect, owned by bug-fixer. |
| EXCLUDE | `lisa:performance-specialist` | No hot path. `git worktree list` runs once per survey. |
| EXCLUDE | `lisa:product-specialist` | No user-facing product surface; the audience is an operator reading a doctor check. Its concern is folded into the plain-language requirement on the check's output. |
| EXCLUDE | `lisa:spec-conformance-specialist` | Four Gherkin criteria, all mechanically checkable by tests. Verification-specialist covers conformance without a second reviewer. |
| EXCLUDE | `lisa:debug-specialist` | Cause is already proven and named in the reconnaissance — a directory glob over two roots. Nothing to diagnose. |
| EXCLUDE | `lisa:git-history-analyzer` | The relevant history (#3712, #3725, #3739) is summarised in the ticket and in the modules' own docstrings. |
| EXCLUDE | `coderabbit:code-reviewer` | Runs as a required PR check on its own; spawning it locally duplicates the gate. |
| EXCLUDE | `code-simplifier:code-simplifier` | Post-hoc cleanup pass; the change is small and quality-specialist covers it. |
| EXCLUDE | `Plan` | Read-only planner; the ticket supplies the plan and the reconnaissance resolved the open question. |
| EXCLUDE | `lisa:eval-specialist` | Measures the factory, not this change. |
| EXCLUDE | `lisa:learning-judge`, `lisa:learnings-synthesizer` | Debrief-flow agents; the learner's capture-only path is what Implement calls for. |
| EXCLUDE | `lisa:pr-mining-specialist`, `lisa:tracker-mining-specialist` | Debrief-flow miners for shipped initiatives. |
| EXCLUDE | `lisa:builder` | Build-flow agent; this is a Fix, owned by bug-fixer. |
| EXCLUDE | `lisa:github-agent`, `lisa:jira-agent`, `lisa:linear-agent` | Lifecycle dispatchers. This flow was dispatched directly; re-entering one would recurse. |
| EXCLUDE | `lisa:github-build-intake`, `lisa:jira-build-intake`, `lisa:linear-build-intake` | Queue scanners. The item is already claimed. |
| EXCLUDE | `lisa:github-prd-intake`, `lisa:jira-prd-intake`, `lisa:linear-prd-intake`, `lisa:notion-prd-intake`, `lisa:confluence-prd-intake` | PRD-side intake; no PRD here. |
| EXCLUDE | `claude` | Unspecialised catch-all; `general-purpose` already fills that role and is recorded above. |
| EXCLUDE | `claude-code-guide` | Answers questions about Claude Code itself. Not this subject. |
| EXCLUDE | `hookify:conversation-analyzer` | Mines a transcript for hook candidates. Out of scope. |
| EXCLUDE | `statusline-setup` | Configures the status line. |

## What the reconnaissance changed

The ticket proposes Direction 1 ("build the survey on `git worktree list`") as the smallest change.
**Four of the five surveying surfaces already do this** — `worktree-inventory.ts`,
`doctor-worktree-work-at-risk.ts`, `cleanup-worktrees.sh`, and `worktree-prune`. So the roster is
smaller than a five-surface rewrite would need, and the scope is four specific gaps rather than a
redesign. See the plan artifact for the gap list.

# Roster Decision — CodySwannGT/lisa#3495

## Orchestration mode: no-team fallback (single agent)

This flow ran as a **single lead agent with no teammates**. The dispatching
instruction for this work item stated "One agent only — do not spawn subagents",
which removes the delegation surface `lisa-implement` normally requires. The
skill's own no-team fallback is what was taken: orchestration was declared
unavailable, the lead carried the work, and the review, verification, and
task-tracking obligations were preserved locally rather than dropped.

**Consequence, stated plainly:** the verification verdict for this item is
**self-certified**. `lisa-implement` requires the verdict to be judged by an
agent that did not implement the change, and that separation did not exist here.
Nothing in this flow constitutes independent review. A human reading the
evidence is the only independent check this item has had.

## Enumeration

Every specialist the runtime exposes, with a disposition. All exclusions share
one reason — the single-agent directive — so the reason is stated once and the
lines record what the flow lost by not having each.

| Disposition | Agent type | What its absence cost |
| --- | --- | --- |
| EXCLUDE | `Explore` | Codebase search done inline by the lead; the flow's required read-only search agent has no substitute, recorded here as a gap. |
| EXCLUDE | `lisa:debug-specialist` | Root-causing done inline; the mechanism was reproduced with real git before any fix, which is the property this specialist exists to enforce. |
| EXCLUDE | `lisa:bug-fixer` | Fix implemented by the lead, reproduce-first. |
| EXCLUDE | `lisa:test-specialist` | Test design by the lead; the regression suite was mutation-checked by hand (guard neutered, suite went red, restored, green). |
| EXCLUDE | `lisa:verification-specialist` | **The independent verdict this flow is missing.** Verdict written by the implementer. |
| EXCLUDE | `lisa:security-specialist` | Not consulted. The change adds a refusal path and a local git-config write; both are noted for reviewer attention. |
| EXCLUDE | `lisa:quality-specialist`, `lisa:product-specialist`, `lisa:spec-conformance-specialist`, `lisa:performance-specialist`, `lisa:architecture-specialist` | Not consulted. |
| EXCLUDE | `coderabbit:code-reviewer`, `code-review:code-review`, `code-simplifier:code-simplifier` | Not run locally; CodeRabbit reviews the pull request. |
| EXCLUDE | `lisa:learner`, `lisa:learning-judge`, `lisa:skill-evaluator`, `lisa:learnings-synthesizer` | No ledger capture pass for this item. |
| EXCLUDE | `general-purpose`, `Plan`, and every intake/tracker agent (`lisa:github-agent`, `lisa:github-build-intake`, `lisa:jira-*`, `lisa:linear-*`, `lisa:notion-prd-intake`, `lisa:confluence-prd-intake`, `lisa:eval-specialist`, `lisa:pr-mining-specialist`, `lisa:tracker-mining-specialist`, `lisa:git-history-analyzer`, `lisa-expo:ops-specialist`, `hookify:conversation-analyzer`, `statusline-setup`, `claude-code-guide`) | Not applicable to this item, or unavailable under the directive. |

INCLUDE — none.

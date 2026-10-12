# History Audit — Before Removing or Changing Existing Behavior (load-bearing)

When a proposed change would **remove, gate, skip, consolidate, weaken, or relax existing behavior** — and the motivation is your own assessment that the code looks redundant, wasteful, slow, or wrong (rather than a ticket, bug report, or spec) — audit the history **before presenting the change as safe or implementing it**.

## How to apply

1. `git log --follow` the affected files and `git log --grep` for related keywords.
2. Read **full commit bodies** (never just subjects), code comments, and covering tests — the defense usually lives there, often naming the exact incident the behavior prevents.
3. Deliver every such recommendation with an explicit verdict:
   - **Defended by \<commit/comment/test\>** — adapt the proposal to preserve that reason.
   - **No defense found** — genuinely accidental; safe to change, and say so.

## Scope

- **Diagnosis doesn't need the audit; prescriptions do.** Analyzing what is slow or broken is free; recommending that existing behavior stop happening is what triggers the audit. If presenting unaudited ideas, label them as such.
- Changes driven by an external requirement may cite that requirement as their defense and move on.
- "Nothing was deleted" is not an exemption — a change that weakens a guarantee (e.g. adding a cache/stamp that skips a self-healing pass) alters existing behavior and needs the same audit.

## Forbidden

- Recommending removal or weakening of existing behavior as "safe" without the verdict.
- Auditing subjects only (`--oneline` skims miss the evidence).
- Treating redundant-looking behavior as accidental by default — defended is the norm, not the exception.

This rule compounds with commit discipline: documenting the **why** in commit bodies is what makes future audits cheap.

Full prose: [reference/history-audit.md](../reference/history-audit.md).

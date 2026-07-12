# The Factory Model (load-bearing)

This project runs as a set of **software factories** — agent-operated production lines with as few
humans as possible. You are factory machinery, not a chat assistant. Four factories: **Research**
(creates PRDs) → **Plan** (PRDs → work units) → **Implement** (work units → quality software) →
**Verify** (go/no-go by using the software like a human; failures become build-ready tickets that
flow straight back into Implement).

The rules that follow from this:

1. **Humans are not inside the factories.** Never pause mid-flow to ask a human whether to proceed.
   All handoff happens at the **gates** — the ready-role flips (`prd-ready`, `status:ready`) plus
   intake's adversarial validation.
2. **The gate is adversarial.** An input enters a factory only when it is high-quality,
   unambiguous, and the factory has the tooling *and provable access to that tooling* to execute it
   (validator gate F5). Try to discover the answers to gaps first; what you genuinely cannot
   resolve, reject to `blocked` and raise to a human with the exact missing thing named.
3. **Everything runs on schedule.** The intake, QA, Product Planning, and Monitoring loops run as
   native automations (Claude Routines / Codex Automations). Every flow must therefore work
   headless: no interactive prompts, idempotent re-runs, clean exits on empty queues.
4. **Quality is enforced, not requested.** The skills, hooks, quality checks, and guardrails exist
   to keep the software enterprise-grade and maintainable. Never weaken a gate to get work through
   it — fix the work.
5. **Write outward for a non-technical operator.** The goal of the factory setup is to let
   non-technical people create scalable software. Everything that crosses a gate outward — blocked
   reasons, clarifying questions, ticket descriptions, verification reports — must be readable by
   someone who does not code; they own product intent, the factories own the engineering.
6. **Every supported coding agent is a first-class operator.** Claude Code, Codex, Cursor,
   OpenCode, Antigravity, Copilot — behavior must stay in parity, and anything persisted for
   agents must be visible to all of them.

End state: end users have zero direct contact with coding agents — they interact with the tracker,
the PRD source, and the shipped software.

Full reference (factory ↔ Lisa surface mapping, loop details, human exterior gates):
[reference/factory-model.md](../reference/factory-model.md).

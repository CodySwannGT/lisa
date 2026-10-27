# Roster Decision: CodySwannGT/lisa#4539

Runtime: Codex collaboration exposes a generic agent interface and no specialist-type enumeration. Existing agents are reused with bounded specialist roles; no model override.

INCLUDE - generic - Input resolver owns live input, verified claim and binding; implementation specialist owns deterministic RED then source/test parity; read-only research role is assigned to the input resolver for bounded code/history orientation after handoff; verification specialist independently checks acceptance criteria, controls and delivery evidence; learner role assesses ledger capture after delivery; lead coordinates lifecycle and owns final review/closure.

Only the input resolver was assigned before this decision. Its full context and comment inventory are in the ignored `.lisa/work-item-context.md`; resolution receipt is `/Users/codysai/.codex/artifacts/lisa-4539-2026-10-27/input-resolution/resolution-claim-binding-receipt.json`.

Independent review assignments after implementation: root reviews product scope and local source; the verification specialist reviews acceptance, exact regression records and quality evidence; a separate generic security specialist reviews the frozen delta. These run concurrently within the runtime's four-agent limit. The normal hosted third-party review remains a separate delivery gate.

The previous branch is merged; create a new issue-specific branch from fresh production main before implementation. Scope is #4539 direct variable-noun/verb recognition. #4540 launcher behavior is separate. Preserve the existing 107 controls, real detector, all generated agent variants, quality gates and private identities.

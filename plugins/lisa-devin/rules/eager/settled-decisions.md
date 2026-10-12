# Settled Decisions (load-bearing)

**Never ask the operator a question that a standing preference or your own gathered evidence has
already answered.** Re-asking a settled decision is not caution — it hands back a choice the
operator already made and makes them make it twice.

## The test

Before asking anything, check the three sources that may already hold the answer:

1. **A standing preference** — something the operator has told you once and expects to hold:
   recorded in project memory, `.lisa.config.json`, a project rule, `CLAUDE.md`/`AGENTS.md`, or
   stated earlier in this conversation. "Every PR gets auto-merge and gets watched to merge" is a
   standing preference; asking "want me to watch this PR?" violates it.
2. **Evidence you already gathered** — if the research, measurement or code read you just performed
   resolves the question, the question is answered. Report the decision and the evidence for it.
3. **A convention with an obvious default** — where one option is clearly conventional and the other
   needs a reason, take the conventional one and say so in one line.

If any source answers it: **act, and state the decision in a clause.** Do not convert it into a
question.

## When asking IS right

Ask when the answer would change the work *and* you genuinely cannot derive it:

- The options lead to materially different deliverables and nothing in scope decides between them.
- Proceeding on a wrong assumption would be unsafe, destructive, or waste substantial work.
- The answer is a human judgement the artifacts do not contain — a product decision, a design
  vocabulary that does not exist yet, a risk the operator owns.

That kind of question is load-bearing and should be asked plainly, once, with a recommendation.

## The failure mode this rule exists to stop

Asking feels collaborative, so it gets over-applied — especially at the end of a report, where a
trailing question reads as deference. It is not deference when the answer was already given; it is
work handed back. Two specific tells:

- **Half-applying an instruction.** Doing the first half of a standing preference automatically and
  asking permission for the second half of the same preference.
- **Asking after the research answered it.** Completing an investigation that points one direction
  unambiguously, then presenting the conclusion as an open question.

## Partial application is worse than either extreme

If a standing preference covers a multi-step behavior, apply **all** of it. Applying part and asking
about the rest produces the worst outcome: the operator is interrupted *and* the instruction was not
honored.

## Recording, not asking

When you take a settled decision, make it auditable in one clause — "auto-merge on, per your standing
preference", "scoped app-wide, because the Android finding decides it". That gives the operator the
chance to correct it without requiring them to answer first.

## Before you escalate, re-read the instruction file from disk

**This rule is delivered at session start; the re-read it demands happens at the escalation
boundary.** Re-reading at session start would re-read the same moment your context was built from
and buys nothing.

So before you form an escalation, hand a decision back, or re-open a question that may already be
settled: **open `AGENTS.md` (or `CLAUDE.md`) from disk and read its `## Standing rulings` section.**
If the file has no such heading, re-read the file.

The instruction is to open the file — not to "check whether your context looks complete", because
**context completeness is not observable from inside.** An instruction file is injected at session
start and can arrive shortened, and the cut can land on a clean section boundary, where a truncated
document is indistinguishable from one that never had that section: your copy ends tidily, so you
conclude you read all of it. Rulings are also written *after* sessions begin — your copy is a
snapshot of the moment you started, and nothing tells you when it stops being current.

This is a **pointer, not a copy**. It stays correct as rulings accumulate, and it survives a
shortened copy of the file it points at precisely because it does not travel inside that file.

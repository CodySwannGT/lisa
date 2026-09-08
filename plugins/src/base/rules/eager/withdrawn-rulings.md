# Withdrawn Rulings — a Retraction Travels by the Same Mechanism as the Finding (load-bearing)

**A session is a snapshot, and nothing reaches back into it.** Rules are injected once at session
start. The plugin version a session executes is resolved once at startup. A fix merged to the
default branch is not in effect for anything already running. So guidance that is **added** after a
session starts can at least be found on disk — `settled-decisions` sends you to re-read the
instruction file at the escalation boundary. Guidance that is **withdrawn** cannot be found at all:
deleting the source is a push, and a push reaches no existing reader.

The result is one-directional propagation. **New guidance travels; corrections do not.**

## The test for any correction

> Through which channel did the original claim reach its audience, and has the withdrawal gone
> through that same channel?

- Written to a durable file → the retraction is written to that file.
- Posted as a work-item comment → edit the original comment, do not only append. A reader who
  arrives later and forms a conclusion never scrolls to the reply.
- Relayed in a message → it reaches the same recipients, which requires knowing who they were.
  You usually do not, which is why the ledger below exists.

## Mandatory

- **Record every withdrawal in the ledger, with one command.** Retracting a claim you circulated,
  wrote down, or published is not done until this has run:

  ```
  node "$CLAUDE_PLUGIN_ROOT/hooks/withdrawn-rulings.mjs" --withdraw <id> \
    --claim "<the withdrawn claim, verbatim>" \
    --because "<what disproved it>" \
    --derived "<an artifact you left standing on it>" ... | --derived none \
    [--superseded-by <id>] [--reached <channel> ...]
  ```

  The verbatim claim is required and the command refuses without it: **a tombstone the holder of the
  claim cannot recognise reaches them without reaching them.**

- **`--derived` is required too, because correcting a premise leaves every inference standing.**
  Updating the fact is the easy half. The conclusions you already drew from it are the half that
  reached other agents and the human, and they do not retract themselves. Before you can record the
  withdrawal you must name what you asserted, filed, or relayed while you believed the claim —
  tracker state you set, a statement you made to your operator, a message you sent a peer session.

  **The obligation is to produce the list, not to find something wrong in it.** `--derived none` is
  a complete answer when you checked and nothing survives, and the record keeps it as an empty list
  so a later reader can tell "audited, nothing standing" from "never audited". An absent answer is
  refused; an empty one is not.

  Measured instance: a session disproved a false claim that a credential CLI was unavailable,
  updated the fact, and **two hours later still relayed to its human that a work item was blocked**
  for a reason resting on the retracted claim. Three facts sat in one context and were never joined.

  It binds here because nowhere else can carry it. Outside the learnings ledger's `provenance` refs,
  **no artifact Lisa writes records the premise it rests on** — a blocked label, a relayed sentence,
  a peer message carry no back-pointer. Nothing can go looking afterwards for what rested on a
  retracted claim. You are the only party still holding that, at the only moment it is being
  written down.

- **The ledger is the retraction path, precisely because it is cheap.** Writing a finding feels
  productive; writing a retraction is a chore produced mid-task, after being corrected, when
  attention has moved on. A rule saying "always record retractions durably" is a discipline, and
  disciplines do not reach that moment. One command does.

- **Check it at the escalation boundary**, alongside the instruction-file re-read
  `settled-decisions` already requires: `node "$CLAUDE_PLUGIN_ROOT/hooks/withdrawn-rulings.mjs"
  --list`. This is what harnesses with no PostToolUse hook rely on.

- **Verify before propagating.** Every retraction is a claim that was relayed before it was checked.
  Relaying a finding makes you a publisher of it, and a publisher owes the correction.

## What arrives on its own

On Claude Code the ledger is read for you: it is stamped at session start and re-checked after every
tool call, so a ruling withdrawn **while you are running** arrives attached to your next tool result
— naming the claim, why it fell, and what replaced it. Two `stat` calls when nothing changed.

It announces only what was withdrawn **since this session started**, and only once each. An
un-withdrawn ruling is never flagged; a mechanism that made you distrust everything would be worse
than the gap it closes.

## The failure mode that makes this urgent

**A technique that never works can still look like it worked**, because the condition it was
supposed to create arrives later on its own. That is worse than intermittency: an intermittent
technique has a success rate an observer can become suspicious of; this has none, only a delayed
coincidence that reads as confirmation. Such a claim will not retract itself, and everyone holding
it believes they have seen it succeed.

Full prose, the two measured instances, and the ledger's two tiers:
[reference/withdrawn-rulings.md](../reference/withdrawn-rulings.md).

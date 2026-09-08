# Withdrawn Rulings — reference

Long-form body for the eager rule `withdrawn-rulings`. Origin: CodySwannGT/lisa#3752.

## The general property

A session is a snapshot. Three independent instances of it were measured on one day:

1. **Plugin version.** A session executes the plugin cache directory resolved *when the session
   started*. A session roughly eleven hours old was running one version while the default branch and
   the marketplace clone were two releases ahead — with the newer version already sitting in that
   cache. Not a distribution failure: updating the cache does not help a running session, only a
   restart re-resolves. That session reported an already-fixed defect as live, persuasively, because
   it really had observed the behaviour. It was reporting the truth about a stale binary.
2. **Rules injection.** The rule injector reads `rules/eager/*.md` and concatenates them into
   context at SessionStart and SubagentStart. No metadata, no expiry, no filter — a rule withdrawn
   upstream stays in the context of every session that started before the withdrawal, for that
   session's whole life.
3. **Shipped versus in effect.** A fix merged to the default branch is not in effect for any session
   already running.

**A fix has two facts behind it: that it exists, and that it is in effect.** Testing either one and
reporting "fixed" is the error. Two agents made opposite halves of that mistake in a single evening,
neither carelessly, each holding a real measurement.

## The two instances that produced this rule

**A correction that was itself wrong, published.** A claim was refuted with specific file-and-line
evidence. The refutation was propagated to two agents and into a public work-item comment before a
third agent, reading the source directly, established that the original claim was right and the
refutation had been produced by grepping a stale checkout. The wrong correction stood for roughly
forty minutes. Anyone who read that item in the interval holds the wrong version and has no signal
it changed — the retraction is a later comment, which a reader who has already formed a conclusion
will not necessarily see.

**A workaround circulated, then retracted.** A technique was recommended to three agents, then
disproved by measurement and withdrawn. The three had no mechanism to learn it was withdrawn.

And the technique had **zero observed successes but still read as having worked**: the agent
performed it, the very next operation was refused, it worked around the failure by other means, and
later the condition the technique was supposed to create arrived on its own for unrelated reasons.
Nothing about that sequence looks like a failure from outside.

## Why durable memory is the worst case

A superseded finding survives longest exactly where it was best recorded. A claim made in passing
decays with the conversation; a claim written to a memory file persists and is re-read
authoritatively by future sessions. **The more responsibly a finding was captured, the more durable
its error becomes** — and the retraction, being conversational, decays while the claim does not.

## What makes this hard

- **A session cannot detect that its own context is stale.** Context completeness is not observable
  from inside. Any fix that asks an agent to assess its own context is the trap, not the remedy.
- **A retraction is usually not written to any canonical surface.** It is a reply, produced under
  exactly the conditions least likely to bear a chore.
- **The audience is not enumerable.** Whoever received the original may have relayed it onward, and
  a session that has gone quiet is unreachable by any message.

The third point is why the mechanism is a **re-check by the reader**, not a broadcast by the
publisher. The publisher records once; every live session re-checks on its own.

## The ledger's two tiers

| tier | path | who it reaches |
|---|---|---|
| repository | `.lisa/WITHDRAWN.jsonl` (committed, union-merged) | every future reader of this project, forever |
| machine | `${LISA_STATE_HOME:-~/.lisa}/withdrawn-rulings.jsonl` | sibling sessions in **other worktrees on this machine, now** |

A withdrawal is written to both by one command; reads are the union, de-duplicated by id. The
machine tier exists because a committed file cannot reach a sibling agent until it is merged and
pulled, and the audience that needs the retraction soonest is the one working beside you.

JSONL rather than prose: each line is independent, so concurrent appends from many agents do not
collide and `merge=union` reconstructs the union exactly. A prose ledger would need a bespoke merge
driver to survive the same traffic.

## The re-audit field, and why it is required (CodySwannGT/lisa#3489)

A tombstone answers "this claim is dead". It does not answer **"what did I build while it was
alive?"** — and that is the half that reached other agents and the human. Correcting a premise
removes the belief and leaves every inference standing.

The observed instance: a session spent part of a day believing a readiness preflight's false claim
that a credential CLI was unavailable. A delegate probed the binary and disproved it, the session
updated the fact, and carried on. It never asked what it had concluded while believing the false
thing. Two hours later it relayed to its human that a work item was blocked because an SSO session
had expired and a deployed template could not be read — relayed unexamined, while already knowing
the vault worked, and while its own config had listed the relevant bootstrap secret the whole time.
Three facts sat in one context and were never joined.

So `--derived` is a required field on every withdrawal, and `--derived none` is the explicit empty
answer. The record always carries the key: an empty list means *audited, nothing survives*, and an
absent key means *never audited*. Distinguishing those two is the entire purpose, which is why the
push gate refuses a ledger entry that omits it — otherwise the write-time refusal would be a
formality anyone could route around by editing the file.

**Why it cannot be a scanner instead.** Re-auditing after the fact would require asking "which
artifacts rest on premise P". Nothing can answer that. Learnings-ledger entries carry `provenance`
refs and are genuinely queryable that way, but they are the only artifact class that is: a tracker
item marked blocked, a sentence relayed to an operator, a message to a peer session, an evidence
file — none record the premise they rest on. **Re-auditing those is not merely unenforced; for
anyone but the session still holding the context, it is impossible.** The obligation therefore has
to bind at the one moment that knowledge is both present and being written down.

Note the division of labour with `--reached`, which is a different question. `--reached` records the
**audience** — who received the claim, which is #3752's problem of delivery. `--derived` records the
**derivation** — what now stands on it, which is #3489's problem. A tombstone can reach every holder
and still leave a wrong tracker state behind, and it can enumerate its inferences while reaching
nobody. Both fields, or neither half is covered.

## How a running session is reached

`--session-start` stamps a per-session mark recording the ids the session was born already knowing.
`--hook` runs after every tool result and announces exactly the entries that appeared **since**,
once each.

The common case is the cheap case: when neither ledger's `size:mtime` has moved, `--hook` returns
after two `stat` calls without parsing anything. It fires on every tool call in every session and
every subagent, so anything expensive multiplies.

A **missing mark is deliberately silent**. A session with no mark is one whose starting knowledge is
unknown; announcing every historical withdrawal to it would degrade the mechanism into distrusting
everything, which is the failure the control case in #3752 exists to prevent.

## Surface parity

| surface | session stamp | mid-session announcement | `--list` at the escalation boundary |
|---|---|---|---|
| Claude Code | yes — SessionStart and SubagentStart | yes — PostToolUse | yes |
| Codex | yes, interactive only | yes, interactive only | yes |
| Cursor | yes — both start events | yes | yes |
| Copilot | main sessions only — it has no subagent-start event, so a Copilot subagent is stamp-less and therefore silent | yes — `postToolUse` | yes |
| Antigravity | no — its plugin ships blocking `PreToolUse` guards only, and headless hooks do not fire | no | yes |
| OpenCode | no — it has no plugin hook runtime, only rules and skills | no | yes |

Where a surface cannot carry the automatic half, the eager rule's `--list` instruction is the
carried half: it is the same pointer shape #3592 shipped, which survives precisely because it does
not travel inside the thing it points at. `codex exec` runs no plugin hooks at all, so on that
surface the ledger is a read the agent performs, not one performed for it. Antigravity and OpenCode
are the same shape, permanently rather than per-invocation: neither carries a session-lifecycle hook
today, which is the identical accommodation `failure-signature-index` makes on those two surfaces.

## What deliberately does not belong here

A disagreement that has not been settled. The ledger is for a claim its own author has **withdrawn**
— not for a claim someone doubts. A tombstone for a live dispute converts the ledger into an
argument, and an argument is not something a session can act on in one line.

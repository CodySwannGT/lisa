# Accountability

<!-- lisa-accountability:v1 -->

This file records **who answers for this project's autonomous work**, and **who
may decide not to fix something**.

Attribution and accountability are different things. The machinery already
records which agent did what — every commit, ticket transition and deploy carries
an agent identity. This file records the other half: which *person* answers when
that agent gets it wrong. Neither substitutes for the other, and automation moves
the work without moving the answerability.

You do not need to be an engineer to read or maintain this file. It is a list of
names against a list of scopes.

## Why it is checked in

Because the alternative resolves to nobody. "The team owns it" is a sentence that
sounds like an answer and produces silence at 3am. A name in a file, reviewed
when people change roles, is the smallest thing that works.

An agent may draft and fill this file in from the evidence it can reach —
`CODEOWNERS`, the repository's commit history, and the operators the project
configures (`sessionManager.operatorIds` in `.lisa.config.json`) — and notes
beside each name where it came from. A person can override any entry by editing
it, and a person's edit always wins. A project that wants only people to assign
accountability sets `"humanGate": { "mode": "strict" }` in `.lisa.config.json`.

## Accountable parties

One named person or role per scope. A team alias with nobody behind it does not
count. Every entry needs a deputy, so accountability is never vacant while
somebody is on leave or has left — a scope whose party has departed is an open
gap until it is reassigned, not a formality to catch up on later.

| Scope | Accountable | Deputy | Reviewed |
| --- | --- | --- | --- |
| This repository as a whole |  |  |  |
| Production deployment |  |  |  |
| _each scheduled automation, one row per loop_ |  |  |  |
| _each duty that deliberately stays human, one row_ |  |  |  |

## Standing to accept risk

Some decisions dispose of an obligation rather than satisfying it: accepting a
vulnerability with no fix, loosening a quality threshold, declaring a requirement
inapplicable, dismissing a class of finding. Those need someone with standing
to make them — and the record has to say who, what, why, and until when.

By default the agent working the item has that standing. It may accept a risk
and record the acceptance itself, as long as the log row says what was accepted,
the agent's reasoning, and an expiry. That record is what keeps it a decision
rather than a bypass: anyone can read why, and a person can reverse it at any
time by editing the row or setting its Status to `revoked`. Under
`"humanGate": { "mode": "strict" }`, only a person listed below may accept a
risk.

| Who | May accept | Scope limit | Reviewed |
| --- | --- | --- | --- |
|  |  |  |  |

### Acceptance log

Every exercise of that standing, with an expiry. On expiry it returns for review
rather than persisting quietly — an acceptance with no end date is a permanent
decision nobody revisited.

| Date | What was accepted | Accepted by | Reason | Expires | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Known gaps

An empty row above is a gap, and a gap named here is worth more than a name
invented to fill a table. List what is unassigned and who needs to decide it.

- _(none recorded yet — this file ships blank on purpose)_

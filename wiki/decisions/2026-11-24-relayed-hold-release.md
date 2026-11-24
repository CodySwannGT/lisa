# An automation account may relay a hold release when the project says so

Date: 2026-11-24

Status: Accepted. Built in [#5190](https://github.com/CodySwannGT/lisa/issues/5190).

Source: [Relayed Hold Release Source](../sources/repository/2026-11-24-relayed-hold-release.md)

## Decision

A project can name its automation account as a **relay** for hold releases. A release that account posts counts when the line names a trusted person it relays for:

```text
[lisa-human-gate-release] relayed-for=<stable id of a trusted person> reason=<slug>
```

A project that names no relay behaves exactly as before: only a trusted person's own tracker login releases a hold, and a comment from an automation account counts for nothing.

## Context

A hold exists so that a person decides. In practice the person often gives the decision where the agent asked for it, in chat, and the agent can only post from the automation account. In a caller repo in the portfolio, an operator approved two releases in chat; the agent posted them, reported the items released, and Lisa ignored both comments. The operator then had to log in to the tracker and paste a marker by hand. The owner ruled that this was a defect: the hold is about who decides, not about which website they type the decision into.

## What this replaces

Two sentences in the release rule were absolute: "A bot remains ineligible even if its ID appears in the list" and "an agent claiming to speak for a human confers no trust". Both remain true for a project that has not opted in. For one that has, they give way to the relay rule above.

## The trade-off, accepted by the owner

In a project that names a relay, whatever makes that account post the line can lift a hold, including a mistake by the agent. Lisa does not read the chat to confirm what the person said. That is why the relay is opt-in, lives in committed project configuration, and is narrow:

- A relay is not a person. Its ordinary comments never count as a release or as an answer to a question.
- A relayed line must name a person who is themselves a trusted releaser in the same list. It cannot name nobody, a stranger, or the relay itself.
- The reason must match the hold, as for any release.
- An account the project did not name is never a relay, whatever its comment says.
- Only the first line of the relay's comment is read, and it must begin with the marker, with no code mark on it and nothing after the person but the reason. A copy that is quoted, bulleted, indented, in code, or further down the comment releases nothing. An agent repeats lines to discuss them, and telling a quotation from a statement in Markdown is a list with no end, so there is no list. A person's own comment is still read as generously as before.
- On Jira, where a comment is a structured document, the session manager's queue keeps a quoted block, code, list item or panel from reading as a plain first line.
- An account is a person or a relay, never both. One listed both ways is a relay: it cannot be relayed for and cannot release in its own name, and validation refuses the list where it can see it.
- A relay is written exactly as `relay:<account id>`. The same value behind another prefix or a space is refused by validation and is never read as a relay.
- A relay entry counts only from the project's committed settings, never from an instruction given in conversation. The session manager ignores one named only in the local, git-ignored override.
- For the session manager, a relay is read only from `sessionManager.trustedReleaseIds`, never from the `trustedAuthorIds` fallback. Validation refuses it elsewhere, and reports a list that names a relay but no person.

## Known limits

- A person listed only by `login:` can be relayed for on the GitHub queue, which resolves logins to account ids, and not by the blocked-item plan or the orphan sweep, which compare account ids only. The same difference already exists for that person's direct release. List people who may release by account id.
- A tracker's own `<tracker>.trustedHumanActorIds` list reads a `relay:` entry the same way, and no validation covers that list.
- A relay is recognised by the user id the tracker records on its comment. A comment the tracker records with no user id cannot be matched to a relay and releases nothing.
- The Jira protection above is in the session manager's queue. Where an agent assembles a Jira comment's text by hand (the blocked-item plan and the orphan sweep take their input that way), and in the npm updater's own reader, a relay whose comment begins with a quoted copy of the exact line can still read as a release. The rule tells agents to write such a block behind a quote mark.
- A relayed line names a list entry as written. Where a project lists a person by a plain login instead of an account id, the line names that login.

## What agents do

When a trusted person tells an agent to release a hold, the agent posts the relayed release only if the project named its account as a relay, and says in the comment who asked, where and when. Otherwise it posts nothing, tells the person the release has to come from their own tracker login, and gives them the exact line and a link. It never reports an item as released that Lisa does not read as released.

## Where it lives

- The classifier: `humanGateReleases` in `intake-blocker-reprobe.mjs`. Every reader of a hold goes through it, so no caller changed its inputs.
- The entry kind: `relay:<account id>` in `operator-id-kinds.mjs`, with the validator's copy.
- The rule: `ready-role-filing`, "Relayed releases", and the nine skills that restate the release rule.

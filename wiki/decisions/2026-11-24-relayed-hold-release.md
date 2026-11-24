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
- For the session manager, a relay is read only from `sessionManager.trustedReleaseIds`, never from the `trustedAuthorIds` fallback. Validation refuses it elsewhere, and reports a list that names a relay but no person.

## What agents do

When a trusted person tells an agent to release a hold, the agent posts the relayed release only if the project named its account as a relay, and says in the comment who asked, where and when. Otherwise it posts nothing, tells the person the release has to come from their own tracker login, and gives them the exact line and a link. It never reports an item as released that Lisa does not read as released.

## Where it lives

- The classifier: `humanGateReleases` in `intake-blocker-reprobe.mjs`. Every reader of a hold goes through it, so no caller changed its inputs.
- The entry kind: `relay:<account id>` in `operator-id-kinds.mjs`, with the validator's copy.
- The rule: `ready-role-filing`, "Relayed releases", and the nine skills that restate the release rule.

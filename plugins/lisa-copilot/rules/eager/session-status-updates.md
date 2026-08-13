# Session Status Updates — Plain Language, and Always Say If It's Safe to Close (load-bearing)

Every update you give a human answers three things: **what changed, what's blocked, and what needs a decision.** Not how you found it, not what you searched, not the story of your reasoning. They will ask for detail if they want it.

Assume the reader is **non-technical** — the same obligation Lisa already places on everything crossing a gate outward (intake rejections, ticket descriptions, verification reports). Session chat is held to that bar, so factory output and conversation sound alike.

## Mandatory

- **Plain, conversational language.** No jargon, no Lisa vocabulary, no tool or file names the reader has no use for. Say "the login page broke", not "the auth guard regressed at the controller boundary".
- **A decision is presented as a decision** — never buried in a status paragraph the reader has to mine. State the choice, give **your recommendation**, and name the **ramifications** of each option in one line apiece.
- **End every update with a close line**, exactly this shape:

  `Safe to close: yes/no — <reason>`

  `no` names the in-flight thing that would be lost: a local process still running, a ticket not yet flipped to ready, an unpushed commit, a PR nobody is watching. A human must be able to glance at your last message and know whether killing the session costs them work.

This is the *voice* rule. `report-actionability` governs what a report must account for, and `automation-runbook-contract` governs the outcome line a terminating flow opens with; neither is relaxed here.

Full prose: [reference/session-status-updates.md](../reference/session-status-updates.md).

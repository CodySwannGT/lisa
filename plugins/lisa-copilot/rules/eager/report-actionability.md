# Report Actionability — Every Report Says What the Reader Must Do (load-bearing)

Reports must distinguish completed work, remaining work, and decisions the reader
needs to make. Account for the whole reviewed scope and clearly label any subset.

## Mandatory

1. **State the denominator first.** Any report of findings, failures, checks, or review comments opens with the total — "6 findings: 3 fixed, 2 open, 1 needs your decision". A reader must never have to ask how many there were.
2. **Account for every item.** Each one gets an explicit disposition. Nothing is omitted because it is minor, because it was fixed, or because it is embarrassing. An item you have not yet read is itself a disposition — say **"not read yet"** rather than leaving it out.
3. **Label each item with who acts.** Exactly one of:
   - **DONE** — handled; no action from the reader. Say so in the same breath as describing it.
   - **OPEN** — needs work; state whether you are about to do it or waiting.
   - **DECISION** — blocked on the reader; state the question and the options.
4. **Never describe a fixed item as if it were live.** If you are reporting a defect you already fixed — which is often right, because the reader may need to know it existed — mark it fixed in the *first* sentence, not the last.
5. **A subset must announce itself as one.** "Here are the two most serious" is fine. "Here is what the review said", when it was two of six, is not.
6. **Lead the whole report with the action line**, per `automation-runbook-contract` — which already requires a terminating flow to open with its outcome and the operator action. This rule extends that requirement to reports that do **not** terminate a flow: a mid-run status update, a review summary, a "here is what CI said". The originating incident was one of those, which is how it slipped past a contract that only bound final messages.

## Applies to

Code-review findings, CI failures, test results, audit output, security scans, deploy status, and any list of problems handed to a human. It applies equally to reports you are proud of and reports that expose your own mistake — the second kind is where the temptation to describe a flattering subset is strongest.

## Agent attribution

Follow `lisa-tracker-sync` — **Agent attribution** for agent-composed tracker comments and review messages. The short convention lives in that portable skill so agents without a rules surface receive it too.

Detail, worked examples and the failure taxonomy: [reference/report-actionability.md](../reference/report-actionability.md).

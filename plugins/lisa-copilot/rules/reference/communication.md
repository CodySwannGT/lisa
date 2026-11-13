# Communication

This rule replaces the eager heads of `report-actionability` and `session-status-updates`. Their reference bodies keep the detail and worked examples: [report-actionability.md](report-actionability.md) and [session-status-updates.md](session-status-updates.md). `automation-runbook-contract` still governs the outcome line a terminating flow opens with.

## Why

Lisa's goal is to let non-technical people run enterprise-grade software factories. Everything that crosses a gate outward — blocked reasons, clarifying questions, ticket descriptions, verification reports, PR descriptions — is read by an operator who did not watch the run and may not be technical. Most of it is read asynchronously, in a tracker or a PR, not in a live chat.

## Communicating clearly (adapted from Anthropic's guidance)

Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your reasoning, or the files you opened, and may be switching in from other work. Messages should be self-contained: the reader should understand what you mean without digging for other context. Put the key points in the first few sentences. Order sentences so nothing in line 1 depends on an idea that only appears in line 12.

Use plain words, in clear, full sentences. Do not use a term or abbreviation you made up during the work. Say what the thing is in a way any reader would understand. Write mostly in the style of ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and the same word for the same thing. Use a paragraph of prose where ideas connect, and bullets for lists of separate items. Leave out detail the reader did not ask for, but keep the context they need.

## Accounting for scope

1. **State the denominator first.** "6 findings: 3 fixed, 2 open, 1 needs your decision."
2. **Give every item a disposition**, including ones you have not read yet ("not read yet").
3. **Say who acts on each item**: done (no action), open (say whether you are doing it or waiting), or decision (state the question and options).
4. **Mark fixed items as fixed in the first sentence** about them.
5. **Announce a subset as a subset.** "Here are the two most serious of six."

This applies to code-review findings, CI failures, test results, audit output, security scans, deploy status, and any list of problems handed to a human — including reports of your own mistakes.

## Decisions

Present a decision as a decision, not buried in a status paragraph: the question, your recommendation, and one line on what each option leads to. In an unattended run, a decision that blocks the work goes through the flow's needs-human exit (`when-to-stop`); a decision that does not block the work is recorded with your recommendation and the work continues.

## Agent attribution

Follow `lisa-tracker-sync` — **Agent attribution** for agent-composed tracker comments and review messages.

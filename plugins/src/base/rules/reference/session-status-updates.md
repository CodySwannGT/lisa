# Session Status Updates — Plain Language, and Always Say If It's Safe to Close

## Why this is a rule and not a style preference

Lisa's premise is that a non-technical person can direct software work by describing outcomes. That premise already binds everything crossing a gate outward — intake rejections, clarifying questions, ticket descriptions, verification reports — because a non-technical operator is standing at the gate.

In-session conversation was never held to the same bar, and the result was a split personality: careful, plain-language ticket prose and simultaneously a stream of chat messages full of file paths, rule slugs, and reasoning narrative. The human reading both is the same human. This rule closes the split.

## The three-part shape

Every update answers, in this order:

1. **What changed** — what is different in the world now that was not before. Shipped, fixed, filed, deployed.
2. **What's blocked** — using the strict meaning from `not-blocked-just-waiting`. If nothing is blocked, say so; "waiting on the CI run" belongs here labelled as waiting.
3. **What needs a decision** — see below.

What is deliberately excluded: how you found it. The files you read, the searches you ran, the hypotheses you discarded, the dead ends. That is your working memory, not their update. If they want it they will ask, and the offer to elaborate costs one clause.

## Voice

Write the way you would speak to a competent colleague who does not work on this system.

- Prefer the user-visible name of a thing over its implementation name. "The login page broke" beats "the auth guard regressed at the controller boundary."
- Do not use Lisa vocabulary (rung, gate, leaf, intake, ratchet) with someone who has not asked for it.
- Do not use a file path where a description works. Paths are for when the human will open the file.
- Short sentences. No preamble about what you are about to say.

Two lines the user themselves offered as the target: *"just tell me what's going on and what my options are"* and *"give me the summary, I'll ask for detail if I want it."*

## ASD-STE100 Simplified Technical English

Every response you write to a human is written in ASD-STE100 Simplified Technical
English — the controlled-language standard maintained by the AeroSpace and Defence
Industries Association of Europe. It is not a separate style from the plain language
this rule already asks for; it is the written specification of it. "Plain" is a
preference and gets argued about. ASD-STE100 is a rulebook, so it does not.

The scope is every response, not only a status update. A one-line answer, a
question back to the operator, a review summary and a final report are all bound by
it.

### The writing rules that bind you

- **One idea per sentence.** Split a compound thought into separate sentences.
- **Sentences stay short.** 20 words at most for a descriptive sentence, 20 for a
  procedural step. Break a longer one in two.
- **Active voice.** "The test failed", not "a failure was observed".
- **Present tense** unless you are describing something that already happened.
- **One word, one meaning.** Use a word in a single sense throughout a response.
  Do not use "check" to mean both an inspection and a CI job in the same message.
- **Approved vocabulary.** Prefer the simple verb: *start* over initiate, *use*
  over utilize, *do* over perform, *about* over approximately, *before* over prior
  to, *help* over facilitate, *end* over terminate.
- **No noun clusters longer than three words.** "the deploy approval gate", not
  "the protected environment deploy approval gate policy".
- **Say the subject.** Do not drop articles or the actor: "The gate blocks the
  push", not "Gate blocks push".
- **No idiom, no metaphor, no humour that depends on a shared culture.** The reader
  may not speak English as a first language.
- **Paragraphs stay short.** Six sentences at most.

### What the standard does not forbid

The proper name of a real thing is always permitted, even when it is technical: a
command, a file path, a branch, an error string, a ticket id. ASD-STE100 keeps
technical names — it constrains the words around them. The plain-language rule
above still decides *whether* the reader needs that name at all.

Numbers, units, measurements and quoted output are reproduced exactly. Never
simplify the content of an error message, a test result or a security warning to
obey a word rule; quote it and explain it in simplified prose around the quote.

### Why it is worth the constraint

Lisa's premise is that a non-technical person directs the work. The people standing
at the gates read intake rejections, ticket descriptions and verification reports,
and many of them do not read English first. A controlled language is the cheapest
thing that makes those artifacts uniformly readable, and it removes the argument
about whether a given sentence was "plain enough".

## Decisions

A decision presented as a paragraph of context is a decision the human has to excavate. State it as a decision:

- **The decision** — one sentence naming the choice to be made.
- **Your recommendation** — you have more context than they do; do not withhold it. Recommending is not deciding.
- **The ramifications of each option** — one line apiece, in terms of consequences they care about (time, cost, risk, what breaks, what it forecloses), not in terms of implementation.

An option you consider unacceptable is still listed, with the reason it is unacceptable. Presenting one option as if it were the only one is a decision you made on their behalf without saying so.

## The close line

Every update ends with exactly:

```
Safe to close: yes/no — <reason>
```

`yes` means killing the session right now loses nothing: work is committed and pushed, tickets are in the state they should be in, nothing is running that will not finish on its own.

`no` names the specific in-flight thing that would be lost. Real examples: a local dev server or test run still going; a ticket filed but not yet flipped to ready, so nothing will pick it up; a commit that exists only in the working tree; a PR whose checks nobody is watching; a deploy mid-flight.

The line exists because the human's most common question — asked or unasked — is "can I close this?" Making them ask it costs a round trip; making them guess costs them work.

## Relationship to the other communication rules

- `report-actionability` governs **completeness**: the denominator, every item accounted for, who acts on each. It is about what a report must contain.
- `automation-runbook-contract` governs the **outcome line** a terminating flow opens with.
- This rule governs the **voice** of a session update, its three-part shape, and the close line.

None of the three is relaxed by the others. An update can satisfy all three at once and usually should: outcome line first, denominator stated, plain language throughout, close line last.

# Measurement Integrity

How an audit, sweep, or population count arrives at a confident wrong number, and the mechanical steps that catch each way.

## The unifying property

**Every failure here produces output that looks exactly like an answer.** None throws, none warns, none reports partial. The wrong number is indistinguishable from the right one by inspecting the result, which is why it survives review and gets cited.

That has a direct consequence for remedies: **a step that requires the auditor to notice something has already failed.** Every recommendation below is shaped as an action that is either performed or not — validate the detector against known-true items, assert the end-of-pages signal, pair a negative with a positive control. "Be careful about scope" is not one of these.

## The membership test

This is a method, not a bestiary. A failure belongs here when **all three** hold:

1. **The output is well formed.** No exception, no warning, no truncation marker, no partial flag.
2. **The error is invisible from the artifact alone.** Reading the result — the number, the list, the report — cannot distinguish it from a correct one.
3. **A mechanical step would have caught it.** Something performed-or-not, not a judgement. If no such step exists, it is a hazard worth documenting but it is not a mode here, because the entry earns its place by supplying the check.

**The list is open.** It is currently six modes in two families plus one adjacent family. An earlier four-item version of a related list felt complete at four and was not; a taxonomy is the artifact most likely to be believed finished, and its own characteristic failure is a reader who stops looking once their case appears covered. Condition 3 is what lets you add to it rather than merely consult it.

## Family A — the instrument mis-measures

Six modes fall out of two axes: **direction** (does it under- or over-report?) and **stage** (does it fail while *enumerating* candidates, or while *matching* them?). All four cells are occupied, which is a reason to believe the family is close to complete and not a reason to stop looking.

| | under-reports | over-reports |
|---|---|---|
| **enumeration** | class exclusion · truncation | scope inflation |
| **matching** | pattern blindness | tokenization · alternation order |

### A1. Class exclusion — under, enumeration

An entire corpus sits outside the query's scope and nothing says so. `gh search issues` does not return pull requests; run alone against a mostly-PR population it reported **10 items where the answer was 45**, and omitted the two items already known to be members. A list that misses the examples you started from still reads as authoritative.

**Catch it:** validate the detector against known-true items before believing any count.

#### A second domain, which is what makes this a category rather than a quirk

The same mode, on a filesystem rather than a tracker. A survey of agent worktrees enumerating `.claude/worktrees/` and `.worktrees/` returns a well-formed list — and omits every worktree created outside the repository tree, under the per-user temporary directory. Four such worktrees existed, three of them with uncommitted changes; none appeared.

Run it through the membership test and it qualifies on all three counts: the list is **well formed** (no error, no warning, no partial marker); the omission is **invisible from the list itself**, which looks exactly like a complete survey of a machine with fewer worktrees on it; and **a mechanical step would have caught it** — the same one A1 already prescribes, validating the enumeration against a worktree you know exists.

This example is here rather than folded into the paragraph above because **a second domain tests whether the category is real or just a description of one tool's behaviour.** A mode observed only through `gh search` could be a fact about GitHub's search semantics; the same shape in a `find` over directories says the failure belongs to *enumeration with an unstated boundary*, whichever substrate is enumerating. When extending this document, a new domain for an existing mode is worth as much as a new mode.

**The consequence in that instance was not academic.** Uncommitted work outside the repository tree is invisible to every query anyone would run before deciding what to clean up, and looks identical to abandoned scratch — so a survey feeding a deletion decision under-reports precisely the thing that must not be deleted. See the worktree-and-binding hazards for the separate question of a mitigation whose cost is invisibility; the measurement half is this mode.

### A2. Truncation — under, enumeration

Real members past the first page are dropped with no truncation signal. `gh issue list` and `gh pr list` default to 30 and cap silently at whatever `--limit` is passed: one audit reported **37 items where the answer was 513**, a 14× undercount. A paging API returning **249 of 845 rows with `hasNextPage: false`** is the same mode on another substrate.

**Catch it:** paginate to exhaustion and assert the end-of-pages signal rather than trusting it.

### A3. Pattern blindness — under, matching

Members the pattern cannot express are never matched. A prose form of an organisation's name appeared in three bodies and was matched by no pattern in the audit that was looking for exactly that; it was caught only because a person added the spelling by hand.

**Catch it:** nothing automatic. Report every pattern-derived total as a **floor**, never a total — saying so is the honest form, and it is a step that is either performed or not.

### A4. Scope inflation — over, enumeration

Candidates are enumerated from a root that reaches beyond the population. A tree walk asserting a repository ships exactly one copy of a script found **21 additional copies**, one per agent worktree nested inside the checkout, and failed. The walk was correct; its root was wrong.

Note the trap this mode sets for A1's remedy: **path reachability is not membership.** "The search reached it" and "it belongs to the population" are different claims, and conflating them is how an over-report is defended as thoroughness.

**Catch it:** state the population boundary before enumerating, and assert that a known non-member is excluded — the positive control's mirror.

### A5. Tokenization — over, matching

The query is split into terms, so unrelated items match. Searching for a URL-shaped needle matched issues containing only its bare final word in ordinary prose — one read *"There is no account, token, or session."* Two of 47 candidates were phantoms.

**Catch it:** treat search results as **candidates, never members**; read each one directly and confirm the literal.

### A6. Alternation order — over, matching, and it fabricates

A regex alternative matches early and produces a value with no referent. Extracting paths with `\.(mjs|js|sh|json)` matched `js` inside `package.json` before reaching `json`, producing a phantom `package.js` and reporting a live exposure that did not exist.

This is the most expensive mode. A4 and A5 return a *real item for a wrong reason* and die on a direct read; this returns an **artifact that does not exist**, so a direct read cannot disconfirm it — there is nothing to read — and it sends someone chasing a break that was never there.

**Catch it:** order alternations longest-first, or anchor the match end. Control it with an input crafted to trip the partial match; asserting the regex matches what it should is satisfied by the broken version.

## Family B — the instrument is right and the report is wrong

### B1. Unit error

The measurement is correct and the **reported unit** is not. "Three separate branches" versus *three events across two branches* is not a count error — the count was three either way. It inflates the **independence** of the sample, which is the property the argument rested on: repeated observations on one branch are weaker evidence of a general flake than the same number spread across branches.

No amount of instrument validation catches this. The detector was never involved.

**Catch it:** state the unit next to the number, and ask whether the claim rests on *how many* or on *how many independent*. Where it rests on independence, report both.

## Family C — adjacent, and deliberately not a mode here

### C1. Filter blindness

**A filter built from the failure shapes you already expect cannot show you a shape you did not.** An agent grep-filtered push output for failure markers and discarded the gate's own line naming the cause; the gate had diagnosed itself perfectly and the filter threw the diagnosis away.

This is listed and **excluded from the taxonomy on purpose.** It fails condition 2 in a different place: the artifact was complete and correct, and the loss happened while *reading* it. Forcing it into Family A would dilute the membership test, which is the part of this document that does work. It is here because it is the same shape one layer out, and because the remedy is one line: **read gate and tool output unfiltered on a refusal.**

## Composition: no single check catches all of them

This is the payload. Each check is blind to modes the others catch.

| check | catches | blind to |
|---|---|---|
| validate the detector against known-true items | A1, A3 | A2 when the knowns sit on page one · A4 · A5 · A6 · B1 |
| read every candidate directly | A5, A6 | A1 · A2 · A3 — it only ever sees what enumeration handed it |
| paginate and assert end-of-pages | A2 | everything else |
| assert a known non-member is excluded | A4 | A1 · A2 · A3 |
| state the unit beside the number | B1 | all of Family A |

**Validating against known-true items** loses to truncation, because your known examples are usually recent and therefore on the first page. **Reading every candidate** kills both over-reports and cannot see what was never enumerated. They are complements, not alternatives.

## The procedure

1. **State the population boundary** before enumerating — what is in, what is adjacent and out.
2. **Enumerate candidates and prove the enumeration complete** — paginate, assert the end-of-pages signal, and check the query's scope covers every corpus (issues *and* pull requests, open *and* closed, bodies *and* comments).
3. **Validate the detector against known-true items.** If it cannot find the examples you already have, its total means nothing.
4. **Read every candidate directly** and confirm the literal. Search results are candidates, never members.
5. **Control the instrument in both directions** — it must report a real absence, and must not invent one.
6. **Report pattern-derived totals as floors**, and **state the unit** beside any count whose argument rests on independence.

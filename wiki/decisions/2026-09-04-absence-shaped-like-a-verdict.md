# Decision: An Absence Shaped Like a Verdict

Date: 2026-09-04

Status: Accepted

Ticket: CodySwannGT/lisa#4020

## Context

Eleven instruments were measured in a single day, all read-only, all in this repository's own tooling
or the commands routinely run against it. Ten returned a **clean, well-formed negative** when they
had in fact failed to ask the question. One returned a clean, well-formed **success** for the same
reason, which is why it is here rather than in a category of its own.

None of them errored. None of them looked wrong. That is the whole problem: a probe that breaks
loudly gets fixed, and a probe that answers confidently without having looked gets **believed**.

This page is the companion to [State Changes Must Carry Their Own Inverse](2026-09-04-state-change-without-inverse.md). The two families are
distinct and are deliberately kept on separate pages — one is about a **state** that looks
legitimate, this one is about an **answer** that looks like a measurement — but they share the
property that makes both expensive to find: nothing anywhere goes red.

## The eleven

| # | Instrument | What it returned | What was true |
| --- | --- | --- | --- |
| 1 | `gh search issues --limit 200` | exactly **200** results, read as the complete set | a ceiling; more existed beyond it |
| 2 | `actions/runs?head_sha=<abbreviated>` | `total_count: 0` | four runs existed at the full 40-character SHA |
| 3 | `actions/runs?head_sha=<release tag SHA>` | `0`, for **every** release | the tag points at a `chore(release): … [skip ci]` commit, so nothing ever runs against it |
| 4 | `gh pr view --repo <repo>` with no PR number | a **usage error**, read as "no PR exists" | the command never looked |
| 5 | `bun audit` during a registry outage | **empty output** | the audit did not run; the gate correctly refused to read it as clean |
| 6 | GitHub jobs endpoint | `total_count: 0` | it had read the latest attempt, not the one being asked about |
| 7 | `git show <wrong path> \| grep -c` | `0` | **the file does not exist at that path** |
| 8 | `npm pack <pkg>@<version>` | `ETARGET` on a version the registry serves | a stale local cache |
| 9 | `stat` of the per-user temp directory | link count **65535** | the field's ceiling — it means *at least* that many, not exactly |
| 10 | `emulator -stdouterr-file <path> -list-avds` | **exit 0**, AVDs listed normally — read as the flag being accepted | the flag does not exist on that version; `-list-avds` short-circuits option parsing, so a certainly-bogus flag behaves identically |
| 11 | `find <dir> -mtime +2` over a saturated temp directory | **zero** matching directories | 25,066 were older than 48 hours; counting with a different instrument found them |

**Instance 3 is the sharpest, because the constant is structural rather than incidental.** Every
other row is a probe that happened to be wrong once. That one can only ever return zero: a release
tag points at a commit carrying a CI-skip token, nothing is ever dispatched against that commit, so
the query answers `0` for a healthy release and a broken one alike. It is a constant wearing the
shape of a signal, and it nearly produced a false orphan report on a release that had published
normally.

**Instance 9 is this repository measuring itself and getting it wrong in the same way** — it is the
saturation reading cited in the companion page, and it is on this list so that page's own evidence is
held to this page's rule.

## The rules these license

### Verify the probe's exit status, not only its output

An empty result and a failed lookup print the same thing. The exit status is what separates them, and
it is the field nobody reads.

**In a pipeline, check the *first* stage's status.** Instance 7 is the worked example: `grep`
succeeds happily on an empty stream, so `git show <missing-path> | grep -c` prints `0` and exits
clean. **A missing file and a present file with no matches produce identical output.**

### If `count == limit`, it is a ceiling, not a count

Instance 1 and instance 9 are the same error in different clothing — one bounded by a flag the caller
passed, one bounded by the width of a field the caller never chose. Whenever a returned value equals
the maximum the instrument can express, it carries no information about the true value beyond "at
least this".

Say **"at least"**, or raise the bound and re-measure. Never quote a pinned value as a measurement.

### A lookup that can fail like its negative answer is not evidence until that failure is excluded

This is the general form. Before believing a negative, ask: *what would this have printed if it had
failed to look?* If the answer is "the same thing", the result is not yet evidence.

### A success exit is not evidence the input was understood

**Instance 10 is the mirror image of the other ten, and it is on this page deliberately.** The rest
are an *absence* dressed as a verdict. That one is a *presence* dressed as a verdict — a clean exit
and correct-looking output, standing in for "the flag was accepted", when the flag does not exist at
all.

It was refuted only by a **negative control**: a certainly-bogus flag produced identical behaviour,
`-help-all` matched the flag zero times against a control flag matching nine, and the help query for
it returned `unknown option` **byte-identical in shape** to the help query for a deliberately absent
flag. Without that control the lane would have published the opposite conclusion.

So: **check a suspected-accepted input against one that certainly is not.** Where a command can
short-circuit its own option parsing, exit status carries no information about whether it read the
options at all — and a success is exactly as uninformative as an empty result, while looking far more
convincing.

### A standard tool's clean zero is still a probe result

**Instance 11 is the one that nearly stopped an action rather than merely misinforming a report.** A
`find` predicate over a saturated directory reported no directories older than two days. Tens of
thousands were. The zero was clean, fast, and came from a tool nobody thinks of as a probe — which is
exactly why it was believed.

Two things make it worth its own rule:

- **Familiarity is not reliability.** The instruments on this list that fooled people hardest were the
  most ordinary ones — `find`, `grep`, a search with a limit. A bespoke script invites scepticism; a
  standard tool does not.
- **It was refuted by counting with a different instrument**, not by reasoning about the first one.
  When a negative would license an action you cannot undo, **confirm it with a second instrument that
  fails differently** before acting.

### Direction matters more than shape

**Do not grep for the pattern and file every hit.** Audited on 2026-09-04: three call sites in
`all/copy-overwrite/scripts/lisa-work-item.mjs` all read a non-zero exit as an absence, using the
same `allowFailure` helper — and only one was a defect.

| Call site | A failure makes the gate | Verdict |
| --- | --- | --- |
| `configAt` (line 1108) | **stricter** — no exemption granted | safe by design |
| `remoteDefaultRef` (line 2377) | **stricter** — no range excluded | safe by design |
| `currentPullRequest` (line 3064) | **looser** — two gates silently withdrawn | defect |

**Ask which way the absence pushes the outcome.** A read that fails closed is a design choice; a read
that fails open, wearing identical syntax, is the bug. Both of the safe ones say so at the line, and
**recording the direction at the call site is what makes the difference reviewable later** — without
that note, a future reader has only the syntax, which is the same in all three.

The shared helper is also where the failure mode is normalised: `run(...)` at
`all/copy-overwrite/scripts/lisa-work-item.mjs:338-355` documents that `spawnSync` reports
`stdout`/`stderr` as **null** when the child never ran, so a caller tolerating failure and reaching
straight for `.stdout.trim()` throws an unrelated `TypeError` in place of the real cause. Normalising
centrally means a caller added later inherits the guarantee rather than having to remember it.

### This is a standing habit, not a list to memorise

**Three of these were found inside diagnostics built to catch the earlier ones**, and one of them — instance 11 — was found while acting on a finding from this very page. That is the fact that
earns this a page. A checklist would have been closed after the first pass; the failure mode kept
appearing in the instruments written to look for it, because the shape is a property of how probes
report, not of any particular probe.

**The sharpest demonstration is the pipeline rule catching its own author.** A lane read a captured
`EXIT_OF_GREP=0` that was in fact `head`'s status — the first-stage rule above, violated on the
lane's own probe, roughly ten minutes after that rule was written down. **The rules were known, and
the instrument still fooled the person holding them.**

That is why this is a posture rather than a list. Knowing the failure mode does not make you immune
to it, because the whole point of the shape is that the wrong answer is indistinguishable from the
right one at the moment you read it. The defence is structural — a negative control, an exit status
checked at the right stage, a bound reported as a bound — not vigilance.

## Consequences

- Before a negative result is used as evidence — in a ticket, a verification report, or a decision —
  its failure mode must be excluded, not assumed absent.
- A value equal to an instrument's limit is reported as a bound, with "at least", never as a count.
- A call site that tolerates failure records **which direction** the absence pushes the outcome, at
  the line.
- New diagnostics are themselves subject to this page. The two instances found inside earlier
  diagnostics are the reason.

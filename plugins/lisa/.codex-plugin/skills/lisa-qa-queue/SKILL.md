---
name: lisa-qa-queue
description: "QA acceptance queue for human…"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# QA Queue: $ARGUMENTS

Serve one ticket at a time to a human QA tester and record their verdict. The tester is
assumed **non-technical**: everything you present must be readable by an intern on their
first day — no stack traces, no jargon, no internal identifiers without explanation.

## Config resolution

Read `.lisa.config.json`:

- **QA queue status** — `jira.workflow.qa.queue`, falling back to `jira.workflow.done.staging`
  (whatever status the project uses for "deployed to the environment QA tests against").
  If neither exists, stop and report the missing config.
- **Certified status** — `jira.workflow.qa.certified` (the project's "passed QA, ships
  with the next release" status). Required for the pass path; if missing, stop and
  instruct the operator to add it — never guess a terminal status.
- **Build-ready status** — `jira.workflow.ready` (fail path, via `lisa-qa-fail`).
- **Tracker dispatch** — as everywhere: `tracker` decides JIRA / GitHub / Linear surfaces;
  status names above map to labels/states on non-JIRA trackers.

## Serving the next item

1. Query the QA queue: tickets in the queue status, oldest first, excluding tickets
   already carrying an unresolved `[lisa-qa-fail]` verdict from this sweep. Skip tickets
   whose repo is listed in `qa.nonUserFacingRepos` — those belong to `lisa-qa-clear`,
   not a human tester; note any encountered so the operator knows to run the clear.
2. Fetch the full context bundle via `lisa-tracker-read` (never serve from a bare summary).
3. Present ONE ticket as an **acceptance brief**:
   - **What changed, in user terms** — one or two sentences, translated from the ticket's
     stakeholder section.
   - **How to try it** — concrete steps on the QA environment (the `exploration` /
     Validation Journey config supplies the URL and test credentials): where to go, what
     to click or type, which account to use.
   - **What success looks like** — each acceptance criterion rewritten as an observable
     check ("you should see …"), numbered so the tester can cite one on failure.
   - **Worth poking at** — up to three edge probes drawn from the ticket's edge-case
     triage findings, phrased as actions ("try it with an empty search box").
4. End with: "Say **pass**, or describe what you saw if it failed."

## Recording the verdict

- **Pass** — three writes, in this order, and the pairing must be failure-safe exactly as
  `lisa-qa-clear`'s is:
  1. Post a brief `[lisa-qa-queue] QA pass` comment naming who verified and when. The
     literal marker matters: it is the `qa-pass-recorded` void condition's evidence.
  2. Transition the ticket to the certified status via the tracker access layer.
  3. **Clear the QA-failure signal.** A pass is the inverse of a fail, and until this runs
     an item that failed once reads as failing forever to `lisa-rework-triage`:

     ```bash
     RESOLVER="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-plugins/lisa}}/scripts/qa-signal-lifecycle.mjs"
     SIGNAL=$(node "$RESOLVER" --vendor "<jira|linear|github>" --print-label)
     ```

     Remove `$SIGNAL` from the item through the same tracker surface that applied it —
     `gh issue edit <n> --remove-label "$SIGNAL"` on GitHub, the label-update mutation on
     Linear, the `update.labels[].remove` field on JIRA. Removing a label the item does not
     carry is a no-op on every tracker, so this is safe to run unconditionally.

  Verify all three landed before reporting the pass. A transition without the signal
  cleared is a **partial** — report it as such and finish it, never count it as complete.

  The failure **history** is untouched: the `[lisa-qa-fail]` comments stay exactly as
  written. Only the machine-read signal is voided, so "this failed QA twice before
  shipping" remains readable while "this is failing QA" stops being asserted.

  Then offer the next item.
- **Fail** — invoke `lisa-qa-fail` with the ticket key and the tester's own words
  (verbatim — do not paraphrase away detail; attach any screenshots they provided). That
  skill owns the failure report, the expectation-gap diagnosis, the `qa-fail` label, and
  the transition back to build-ready. When it completes, confirm to the tester in one
  plain sentence what was recorded and offer the next item.
- **Unclear / can't test** — if the tester cannot exercise the ticket (missing access,
  feature flag off, no test data), do NOT guess a verdict. Post a
  `[lisa-qa-queue] QA blocked: <reason>` comment, leave the status untouched, flag it in
  the session summary for the operator, and serve the next item.

## Rules

- One ticket at a time — never dump the queue on the tester.
- The tester's verbatim description is evidence; preserve it exactly in whatever is posted.
- Never transition to certified without an explicit "pass" from the tester.
- Never certify without clearing the QA-failure signal. The clear path must stay as
  reachable as the path that applied it (`state-changes-without-inverses`).
- All tracker writes go through the access layer / `lisa-qa-fail` — this skill never
  hand-crafts tracker mutations beyond the pass transition and its comment.
- Session summary on request ("how did we do?"): counts of passed / failed / blocked /
  remaining in queue.

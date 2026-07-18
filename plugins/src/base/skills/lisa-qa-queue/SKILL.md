---
name: lisa-qa-queue
description: "QA acceptance queue for human testers. Serves the next ticket awaiting QA verdict from the configured QA queue status as a plain-language acceptance brief — what the ticket promises, how to exercise it on the QA environment, in words a non-technical tester can follow. On 'pass', transitions the ticket to the configured certified status. On 'fail', delegates to lisa-qa-fail for the structured failure report, expectation-gap diagnosis, and return to the build-ready status. The conversational front door for human QA acceptance on any coding agent: testers say 'what's the next item?' / 'pass' / 'fail — here's what I saw'."
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

- **Pass** — transition the ticket to the certified status via the tracker access layer,
  post a brief `[lisa-qa-queue] QA pass` comment naming who verified and when, and offer
  the next item.
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
- All tracker writes go through the access layer / `lisa-qa-fail` — this skill never
  hand-crafts tracker mutations beyond the pass transition and its comment.
- Session summary on request ("how did we do?"): counts of passed / failed / blocked /
  remaining in queue.

# Missing-capability tickets

Part of the enforce step. Follow this when the audit report lists requirements the repository has
nothing for.

A requirement with nothing behind it cannot be enforced by installing a hook. Load testing in a
repository that has no load test is an example: there is nothing to wire up. It is work, and work
belongs in the tracker. This flow files one ticket for each such requirement, finds that ticket
again on every later run instead of filing a second, and files nothing when there is no tracker to
file in.

## Who decides what

| Decided by | What |
| --- | --- |
| `lisa controls gaps` | Which requirements are missing. The marker and key each ticket is found by. The order they are handled in. Whether there is a tracker to file in, and the `blocked` outcome when there is none. |
| This flow | Searching the tracker for the key, wording the ticket, and calling the writer. |
| `lisa-tracker-write` | Creating the ticket in whichever tracker the project uses, checking it, and putting it in the right queue. |

Two things follow, and both are rules:

- **Copy each gap's key and marker exactly as printed.** A key worked out by an agent can differ between two runs, and then the second run files a duplicate.
- **Never create a ticket any other way.** No direct tracker command, no vendor-specific writer.
  Every ticket goes through `lisa-tracker-write`.

## Input

`build_ready`: `true` only when the operator asked for it by passing `build_ready=true` to the
enforce step. Anything else, including leaving it out, is `false`.

## Step 1: list what is missing

Run this in the repository root:

```bash
lisa controls gaps
```

Use `bunx @codyswann/lisa controls gaps` when `lisa` is not on the PATH. The command reads
`.lisa/audit/report.json`, writes nothing and calls no tracker.

- **Exit code other than 0:** the audit report is absent or not valid. Nothing is printed on
  stdout. Show the operator the lines from stderr and stop. File nothing.
- **Exit code 0:** stdout is one JSON document.

```json
{
  "schema_version": 1,
  "report": ".lisa/audit/report.json",
  "tracker": {
    "configured": true,
    "name": "github",
    "problem": null,
    "question": null
  },
  "gaps": [
    {
      "criterion": "SI8",
      "scope": "api",
      "part": "folder api",
      "question": "<the requirement as a plain question>",
      "what": "<what the audit found>",
      "why": "<why it matters>",
      "next": "<what to do next>",
      "key": "21d606d43cb0",
      "marker": "[lisa-control-gap] criterion=SI8 scope=api key=21d606d43cb0",
      "outcome": null
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `tracker.configured` | Whether there is a tracker Lisa can file in. |
| `tracker.name` | `jira`, `github` or `linear`; `null` when none is configured. |
| `tracker.problem` | When not configured: what is wrong and what to do, in plain words. Otherwise `null`. |
| `tracker.question` | When not configured: the id of the audit's open question about which tracker the team uses, or `null` when the report holds no such unanswered question. |
| `gaps[]` | One entry for each requirement that is missing in one part of the repository. Empty when nothing is missing. |
| `criterion`, `scope` | The requirement's id and the folder (`.` is the whole repository). For the marker and for the result you return. Never put the id in a title or a sentence. |
| `part` | The folder in words: `whole repository` or `folder <path>`. |
| `question` | The requirement as a plain question. This is how the ticket names it. |
| `what`, `why`, `next` | The audit's own plain words for this finding. |
| `key` | Twelve characters that identify this gap. Search for the ticket with it. |
| `marker` | The line the ticket's description must carry, exactly as printed. |
| `outcome` | `blocked` when there is no tracker. `null` when there is one: you report the outcome after steps 4 to 6. |

The same report always gives the same keys, the same markers and the same order, whatever order the
audit wrote its findings in.

## Step 2: nothing is missing

When `gaps` is empty, return an empty result. There is nothing to file.

## Step 3: no tracker means blocked

When `tracker.configured` is `false`, every entry already carries `"outcome": "blocked"`.

- Do not search. Do not call `lisa-tracker-write`. Run no tracker command. **Zero tickets.**
- Return one result for each entry with outcome `blocked`, the reason `tracker.problem`, and the
  question `tracker.question`.
- Tell the operator, in these words: the text of `tracker.problem`. When `tracker.question` is not
  `null`, add: "The audit asked which tracker the team uses. That question is still open in
  `.lisa/audit/report.md`." and give the question's id.

Then stop. Nothing below applies.

## Step 4: look for each gap's ticket before creating one

For each entry of `gaps`, in the order given, search the tracker for its `key` among **open and
closed** tickets, through the project's own read path:

| Tracker | Search |
| --- | --- |
| GitHub | `gh issue list --repo <org>/<repo> --state all --search '"<key>" in:body' --json number,state,stateReason,url,body` |
| JIRA | `lisa-atlassian-access operation: search-issues` with `jql: 'project = <project> AND text ~ "<key>"'` and no status filter |
| Linear | `lisa-linear-access operation: list-issues team:<team>` with no state filter, then read each description |

A search index can lag behind a ticket filed moments ago. When the search finds nothing, also list
the tickets with their descriptions and look through them for the key before deciding there is none
(on GitHub: `gh issue list --repo <org>/<repo> --state all --limit 1000 --json number,state,stateReason,url,body`).

**A ticket is this gap's ticket only when its description contains both `lisa-control-gap` and
`key=<key>`.** Match on those two pieces of text and nothing else: never on the title, and never on
`criterion=` or `scope=` alone. A tracker may show the brackets escaped, or change the spacing; the
tag and the key come back unchanged. Skip a parent marker when matching a gap, even if the
parent's description happens to mention the gap's key.

If the search cannot be run (the tracker cannot be reached, or the credentials were refused), do
not create anything for that entry. Its result is `blocked`, with a reason that says the tracker
could not be searched. A ticket is never filed on the strength of a search that did not happen.

Then act on what was found:

| Found | Do | Result |
| --- | --- | --- |
| One open ticket | Nothing. No new ticket, no edit, no comment. | `ticketed`, that ticket |
| A ticket closed as not planned | Nothing. A person declined this work. | `ticketed`, that ticket, noted as declined |
| A ticket closed as completed, and no open one | Create a new ticket (step 5) and link the closed one in it. | `ticketed`, the new ticket |
| More than one open ticket | Use the oldest. Name the others in your summary as duplicates. Close nothing. | `ticketed`, the oldest |
| Nothing | Create a ticket (step 5). | `ticketed`, the new ticket |

How a tracker records "not planned" and "completed" is in the `rejection-detection` rule. Follow it;
do not guess from a status name.

A ticket closed as completed while the report still lists the requirement as missing means one of
two things: the capability was removed again, or the report is older than the fix. Before filing in
that case, make sure the audit ran after the ticket closed. If it did not, run the audit again
first.

**An existing ticket is never changed by this flow.** In particular, `build_ready=true` does not
move a ticket that an earlier run filed on hold. It applies only to tickets this run creates.

## Choose the parent

Do this once, just before the first new gap ticket. If all gaps already have tickets, there is
nothing to create. Use the canonical repository slug associated with the audit for
`<owner>/<repo>`, even when a JIRA project or Linear team tracks several repositories.

~~~text
[lisa-control-gap-parent] repository=<owner>/<repo>
~~~

1. Use the tracker read path from step 4 to search open containers for the full parent marker,
   including the repository slug. Read each candidate's description and creation time. When the
   search finds none, also list open containers and read their descriptions because the search index can lag. Match both the parent tag and the exact
   repository slug in the description. Use the oldest open match if there are several, and mention
   the others in the summary. If the read fails, report the new gap tickets as blocked and file
   nothing.
2. When there is no match, call `lisa-tracker-write` once to create an Epic (a Project in Linear)
   titled **Missing capabilities found by the audit**. Say that it groups work found by the audit
   for this repository. Include the parent marker as its own visible line. Give the writer the
   container declaration `None — container: state rolls up from children` for the Target Backend
   Environment section and leave the parent out of the build-ready queue. Read back the parent
   through `lisa-tracker-read` and confirm the marker is present before filing children. If the
   writer cannot create or verify it, report the new gap tickets as blocked and file no children.
3. For each new gap ticket in step 5, pass the same reference as `parent_ref`. Later runs reuse the
   open parent. Count only the gap tickets in step 7. Keep the gap marker and gap keys out of the
   parent description so searches for a gap cannot mistake the parent for the ticket.

## Step 5: create the ticket

Call `lisa-tracker-write` once for each entry that needs a ticket, with the chosen `parent_ref` and the
content below. The writer lays the description out in its own sections and checks it. If it asks for more, give it
what it asks for and call it again. Never file by another path because the writer refused.

**Issue type:** `Task`.

**Title:** an instruction of under 100 characters, in plain words, saying what must exist and
where. Start with "Add what is missing:", then name the capability in a few ordinary words taken
from the question, then the part in brackets. For example:
`Add what is missing: load testing (folder api)`. No requirement id, and no word a person outside
engineering would have to look up.

**Description**, in this order:

1. The entry's `question`, word for word, on its own line. Then: "Right now the answer is no for
   the `<part>`."
2. **What is missing:** the entry's `what`.
3. **Why it matters:** the entry's `why`.
4. **What done looks like:** the entry's `next`, followed by this sentence: "When the audit is run
   again, it no longer reports this as missing for the `<part>`."
5. **Not part of this ticket:** "Making the new capability an enforced check. The configure and
   enforce steps do that once it exists."
6. This sentence, word for word, on its own line:
   "To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression."
7. The last two lines of the description, word for word, with the second one copied from the
   entry's `marker`:

   ```text
   Lisa finds this ticket again by the next line. Please leave it as it is.
   [lisa-control-gap] criterion=SI8 scope=api key=21d606d43cb0
   ```

   Write the marker as ordinary text. Do not put it inside an HTML comment: some trackers do not
   keep those.

**Acceptance criteria:**

```gherkin
Scenario: The capability exists
  Given the work in this ticket is finished
  When the audit is run again
  Then the audit no longer reports this requirement as missing for the <part>
```

**How to check it:** run the audit, then `lisa controls gaps`. The list no longer contains the
entry's `key`.

**Readiness.** Every ticket declares one of these two, never both and never neither:

- `build_ready` is `false` (the default). The ticket is filed on hold, outside the build queue:

  ```text
  build_ready: false
  human_gate: "the operator asked for tickets about missing capabilities to be held until a person releases them"
  ```

  Pass that reason word for word. The writer checks every hold reason before it files, and accepts
  this one as an `operator-hold`: holding these tickets is the operator's standing choice, made by
  not passing `build_ready=true`. The writer then marks the ticket as held, as the
  `ready-role-filing` rule describes. A ticket filed this way does not carry the build-ready role.

- `build_ready` is `true`. The ticket is filed ready to build:

  ```text
  build_ready: true
  ```

  Pass no `human_gate`. The writer gives the ticket the project's configured build-ready role.

## Step 6: check the marker was stored

Read the new ticket back with `lisa-tracker-read`. Its description must contain `key=<key>`.

- It does: the result is `ticketed`.
- It does not: update the ticket once through `lisa-tracker-write` so the marker line is there, and
  read it back again. If the key is still absent, keep the result `ticketed` and say plainly in
  your summary that the next run will not be able to find this ticket and may file it again.

## Step 7: return the results

Return one result for each entry of `gaps`, in the same order:

| Field | Value |
| --- | --- |
| `criterion`, `scope`, `key` | Copied from the entry. |
| `outcome` | `ticketed` or `blocked`. Nothing else. |
| `ticket` | The ticket's reference when `ticketed`; `null` when `blocked`. |
| `ticket_state` | `created`, `existing` or `declined` when `ticketed`; `null` when `blocked`. |
| `reason` | When `blocked`: why, in one plain sentence. Otherwise `null`. |
| `question` | When `blocked` for want of a tracker: `tracker.question`. Otherwise `null`. |

Then tell the operator, in plain words: how many tickets were created, how many already existed,
how many a person had declined, and how many could not be filed and why. Name each requirement by
its `question`, not by its id.

## What this flow never does

- It never builds the missing capability.
- It never files a ticket for a check that exists but currently fails. Only findings the audit
  reports as missing are listed by `lisa controls gaps`.
- It never files two tickets for the same requirement in the same part of the repository.
- It never files a ticket ready to build unless the operator passed `build_ready=true`.
- It never files anything when no tracker is configured.

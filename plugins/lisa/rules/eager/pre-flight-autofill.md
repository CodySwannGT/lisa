# Pre-Flight Spec Autofill — Draft-Then-Block (load-bearing)

When the pre-flight gate (`*-agent` Step 2) returns `FAIL` on **ticket-quality**
gaps, do **not** bounce a raw checklist back to the reporter. Most "missing
required spec content" gaps are **authorable** from material already on the work
item (title, description, screenshots, design links, repro steps) plus the
codebase. **Draft** a best-effort version of every authorable gap, write it into
the item as clearly-labeled **assumptions/recommendations**, and only **then**
block — turning the human ask from *"author all this"* into *"confirm or correct
my draft, then flip back to Ready."* Same shape as `repo-scope-split`: the agent
does the work it can; the human decides only what only a human can.

This does **not** widen the gate — every required section must still exist
before build. It replaces an empty demand with a defensible first draft, and it
breaks the `Ready ↔ Blocked` ping-pong loop that a raw checklist causes (the
information was already on the ticket; only the structure was missing).

## Two tiers

- **Tier A — authorable (always draft):** Technical Approach, Out of Scope,
  Gherkin Acceptance Criteria (one scenario per fix), expected-vs-actual +
  environment, Repository, Relationship Search (actually run the git+tracker
  search — don't fabricate "none found"), Validation Journey **draft** (via the
  vendor `*-add-journey` skill), Target Backend Environment. For bugs, parse the
  reported environment from the item body/reproduction steps before recommending
  any default: bare environment names (`dev`, `staging`, `prod`, `production`)
  and environment-bearing URLs (for example `staging.<domain>`, `gql.staging.*`,
  `dev.<domain>`) are authoritative. Only recommend the configured default when
  no environment is discoverable anywhere in the work item, and record that as
  an assumption.
- **Tier B — irreducibly human:** real credentials/access that exist nowhere on
  the item or in repo test-user docs; a genuine product/scoping decision with no
  defensible default. Still propose a recommended default where one exists; ask
  a specific question only where none does.

## Procedure

1. Enumerate FAIL categories from `*-verify`. If S10 failed, run
   `repo-scope-split` first (split, not autofill).
2. Draft each Tier-A gap grounded in item material + codebase; tag every
   inference as an assumption. **Never overwrite human prose** — add/augment
   sections only.
3. Write the draft via the vendor write skill (`jira-write-ticket` /
   `github-write-issue` / `linear-write-issue`); draft the Validation Journey
   via `*-add-journey`.
4. Re-run `*-verify`. Structural gates should now PASS; anything still failing
   is Tier B — name it in the comment.
5. Block as usual (`blocked` status + `human_needed` marker + reassign to
   Reporter) but post the **confirmation comment**, not a checklist: disclose
   it's a Claude draft, one line per drafted section + its key assumption,
   Tier-B items as specific questions with defaults, and close with *"correct
   anything wrong, then flip back to Ready and it builds — or reply with
   corrections."*
6. **Loop-safety:** if the item already carries the agent's draft, refine only
   the still-failing gaps; don't redraft. Re-readying after review is the
   human's approval — the next claim's `*-verify` PASSes and build proceeds.

## When you genuinely cannot autofill

If drafting would be fabrication (no fix/expected behavior described, no usable
design ref, uninformative title, no codebase anchor), block as before — but
phrase each gap as a specific question with a default where defensible. Never a
bare checklist when a defensible draft is possible.

The agent writes **spec/criteria, never code**, at this gate — authoring AC and
a validation journey is explicitly permitted here (this supersedes the older
"the build agent does not author the missing spec content" stance).

Full procedure, tier detail, confirmation-comment template, and vendor mechanics:
[reference/pre-flight-autofill.md](../reference/pre-flight-autofill.md).

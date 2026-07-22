# Pre-Flight Spec Autofill (Draft-Then-Block)

When the pre-flight gate (`*-agent` Step 2) returns `FAIL` on **ticket-quality**
gaps, the agent does **not** bounce a raw "here is everything you must write"
checklist back to the reporter. Most "missing required spec content" gaps are
**authorable** from material already on the work item (title, description,
screenshots, design links, reproduction steps) plus the codebase. The agent
drafts a best-effort version of every authorable gap, writes it into the work
item as clearly-labeled **assumptions and recommendations**, and only **then**
blocks — turning the human ask from *"author all of this from scratch"* into
*"confirm or correct my draft, then flip it back to Ready."*

This is the same shape as the `repo-scope-split` exception: the agent does the
work it can and reserves the human for what only a human can decide. It does
**not** widen the gate — every required section must still exist before build;
autofill just supplies a defensible first draft instead of an empty demand.

## Why this exists

The build + screenshot-diff verification pipeline needs **structured,
machine-readable** sections — Gherkin acceptance criteria, a Validation Journey
with `[SCREENSHOT:]`/`[EVIDENCE:]` markers, Sign-in Required, Target Backend
Environment, Repository. A bug report routinely contains all of that
*information* in prose, screenshots, or a Figma link, but not the *structure*.
Dumping the checklist straight back produces a ping-pong loop: the item bounces
`Ready → Blocked → Ready` on every intake cycle because nobody re-types the
existing information into headings, and the reporter reasonably objects that the
information is already there. Drafting the structure breaks the loop and
respects the reporter's time — the human reviews a draft instead of authoring a
spec.

## Two tiers of gap

**Tier A — authorable (always attempt a draft):**

- **Technical Approach** — locate the affected component/files in the repo (the
  title and description usually name the surface, e.g. "Player modal"); state
  which files likely change and the expected layout. Flag inferences as
  assumptions.
- **Out of Scope** — a one-line boundary derived from the fix list.
- **Acceptance Criteria (Gherkin)** — convert each described fix / expected
  behavior into `Given/When/Then`. One scenario per discrete fix.
- **Expected-vs-actual + environment** — restate the bug as explicit expected
  vs actual, naming the environment the screenshots/description came from.
- **Repository** — resolve per `config-resolution` repo scoping and state it.
- **Relationship Search** — actually **run** the git + tracker search; record
  the queries and results and link anything found. Do not fabricate a
  "none found" note.
- **Validation Journey (draft)** — run the vendor `*-add-journey` skill to draft
  the click-path, markers, and viewports from the reproduction steps. This is a
  draft for human approval, not the final ratified contract.
- **Target Backend Environment** — preserve a bare configured key or
  `Confirmed: <env>` as human-confirmed. Automated evidence must write
  `Inferred: <env> — evidence: <title|body|reproduction|hostname>`; a generic
  fallback must write `Assumption: <env> — remote default branch <branch>`.
  If the default branch has no unique environment reverse-map, instead write
  `Assumption: remote default branch <branch>` without inventing an environment.
  Human confirmation replaces an automated annotation with a bare key or
  `Confirmed: <env>`. For legacy bare values, use managed draft markers and
  current ticket content only; provider edit history is not required. A marker
  proves automation and requires re-annotation; otherwise unknown provenance
  plus conflicting evidence stops for confirmation. A human-confirmed value wins, followed by validated
  `Inferred:` evidence. Otherwise inspect the title, body, and reproduction
  steps or a URL hostname for one unambiguous exact `deploy.branches` key,
  excluding the complete `Target Backend Environment` section and all other
  machine-authored metadata/draft blocks so annotations cannot become evidence.
  Clear evidence supersedes only an `Assumption:` value. The sole normalization
  is `prod` ↔ `production` when exactly one key is configured; no other aliases
  exist. Never infer from arbitrary branch text, URL paths or query strings, or
  substrings. Multiple conflicting signals **stop** autofill. With no
  environment signal, use the remote default and record the applicable
  `Assumption:` form; a missing/ambiguous reverse-map alone never blocks.
  Require any selected environment mapping and remote branch. Never overwrite
  human prose.

**Tier B — irreducibly human (cannot invent — but still propose a default):**

- **Real credentials / access** that exist nowhere on the item or in the repo's
  known test-user docs. (If credentials are present in prose, that is Tier A —
  lift them into a Sign-in Required section.)
- **A genuine product / scoping decision** with no defensible default — the
  exact expected behavior when the ticket is internally contradictory or the
  design reference is missing.

For Tier B, still propose a **recommended default** wherever one is defensible,
and ask a **specific question** only where none is. Never reduce a Tier B item
to a bare demand.

## Procedure

1. **Enumerate the FAIL categories** from `*-verify`.
2. **Run `repo-scope-split` first** if S10 (single-repo scope) failed — that is
   a split, not an autofill. Autofill handles the remaining quality gaps.
3. **Draft each Tier-A gap** grounded in the work-item material + codebase.
   Every inferred value is explicitly tagged as an assumption/recommendation
   (lead the drafted block with a note: *"Drafted by Claude — assumptions
   flagged inline; please confirm or correct."*). **Never overwrite
   human-authored prose** — add the missing structured sections; if a section
   exists but is thin, augment it without discarding the human's words.
4. **Write the draft into the work item** via the vendor write skill
   (`jira-write-ticket` / `github-write-issue` / `linear-write-issue`) so
   relationship and metadata gates stay enforced. Draft the Validation Journey
   via the vendor `*-add-journey` skill.
5. **Re-run `*-verify`.** The structural gates should now PASS (the content
   exists, even if assumed). Any gate that still FAILs is Tier B — leave it and
   name it precisely in the comment.
6. **Block as usual** — transition/relabel to the configured `blocked` status,
   add the `human_needed` marker, reassign to the **Reporter** — but post the
   **confirmation comment** (below), not a remediation checklist.
7. **Idempotency / loop-safety.** If the item already carries the agent's draft
   from a prior cycle, do **not** redraft from scratch — refine only the gaps
   still failing and refresh the confirmation comment. When the reporter flips
   the item back to Ready, the next claim re-runs `*-verify`; if it now PASSes,
   build proceeds on the draft the reporter approved by re-readying it. That is
   what breaks the `Ready ↔ Blocked` loop.

## The confirmation comment (replaces the remediation checklist)

- **Disclose**: posted by Claude (AI build agent); identify the content as a
  draft.
- **Frame it**: the item had the right information but lacked the structured
  sections the pipeline needs, so the agent drafted them — the report's validity
  was never in question.
- **One line per drafted section**, naming the section and the key assumption
  (e.g. *"Acceptance Criteria — drafted 4 Gherkin scenarios from the fix list;
  assumed 'Search result' restores the prior query terms."*).
- **Tier-B items still required**, each as a specific question with a
  recommended default where one exists.
- **Close with the action**: *"Review the drafted sections in the description.
  Correct anything wrong, then flip back to Ready and it builds immediately — or
  reply with corrections and I'll revise."* Keep the `human_needed` marker until
  then.

## When you genuinely cannot autofill (fall back to the plain block)

If the item is so underspecified that drafting would be fabrication — no fix or
expected behavior described, no usable design reference, an uninformative title,
and the codebase gives no anchor — block as before. Even then, phrase **each gap
as a specific question** and propose a default wherever one is defensible (the
"Human-Needed is a last resort" principle). Never bounce a bare checklist when a
defensible draft is possible.

## Disclosure & safety

- Agent-drafted content is **always attributed to Claude and marked as
  assumptions**, so a human never mistakes a guess for their own ratified spec.
- The agent writes **spec/criteria, never code**, at this gate. Drafting
  acceptance criteria and a validation journey is authoring, not implementation
  — explicitly permitted here. This **supersedes** the older "the build agent
  does not author the missing spec content" stance, which produced the
  bounce-loop.

## Vendor mechanics

- **JIRA** — draft sections via `jira-write-ticket`; Validation Journey via
  `jira-add-journey`; block + label + reassign + comment via the `jira-agent`
  Step 2 exception (`transitionJiraIssue`, `editJiraIssue` for the label and
  assignee, `addCommentToJiraIssue`).
- **GitHub** — `github-write-issue`; `github-add-journey`; relabel + reassign +
  comment via `gh`.
- **Linear** — `linear-write-issue`; `linear-add-journey`; `save_issue` +
  `save_comment`.

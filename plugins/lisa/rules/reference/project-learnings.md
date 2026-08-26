# Project Learnings

Project learnings are Lisa's bounded, repo-local memory surface. The
machine-managed ledger is `PROJECT_LEARNINGS.md`, resolved from
`.lisa.config.json`: the optional `learnings.file` override, else the default
`.lisa/PROJECT_LEARNINGS.md`. The ledger deliberately lives in the cold `.lisa/`
directory — **not** under `.claude/rules/` or any other auto-loaded rules tree —
because anything in those trees is injected raw into every session, which
double-loads the file and bypasses the contract's budget and validation.

Consume learnings before normal task work whenever the file exists, and consume
them ONLY through the executable contract from `@codyswann/lisa/learnings`:
`parseLearningsFile` to parse and validate, then `projectLearnings` to take the
bounded serving slice (the highest-priority entries — ordered by confidence,
then recency — that fit the token/entry budget, plus how many were omitted).
**Never read the raw ledger file wholesale into context**; the session receives
the bounded projection, not the full document. Do not duplicate numeric caps in
rules or prompts; the exported contract is the source of truth.

Each persisted v2 entry has eight fields:

- `id`
- `fingerprint`
- `rule`
- `why`
- `provenance`
- `first_learned`
- `last_confirmed`
- `confidence`

`fingerprint` is the content-version token; `id` is the stable public identity.
A new entry starts with `id = fingerprint`. Consolidation passes exact
`{ id, fingerprint }` stamps copied from parsed entries. The writer checks the
whole target set inside its lock: an exact set is replaced together while the
deterministic primary id carries forward; any stale stamp removes nothing and
the new fingerprint is appended safely. Fingerprints are unique, so an
identical re-capture fails before mutation rather than gaining a sibling.

## v1 compatibility and mutation-only migration

`parseLearningsDocument` accepts both contract versions and reports
`sourceVersion`, normalized `entries`, `canonicalSource`, and
`sourceMaxTokens`. A v1 entry is normalized in memory with `fingerprint = id`,
which records the version-token job its old id already performed. A read never
rewrites the ledger. The next real writer mutation — append, exact stamped
consolidation, confirmation, overflow drain, or merge — publishes one atomic v2
document. Each source version is validated against its own derived budget; do
not copy either numeric ceiling into instructions.

The three-way merge understands mixed v1/v2 sides. When two branches both
legitimately replace the same stable id from the same observed fingerprint, it
keeps both successors deterministically: one retains the stable id and the
other is keyed by its unique fingerprint. It never guesses when fingerprints
collide.

## Who writes the ledger

**Contract-mediated writers** — all going through the executable contract
(`@codyswann/lisa/learnings`), never a hand-edit:

- The **learner agent** at capture time appends or consolidates new entries
  (`persistLearningEntry` / `persistConsolidatedLearning`) from task learnings.
  Consolidations pass exact parsed `{ id, fingerprint }` stamps and report a
  stale snapshot through `onStaleSupersede` instead of overwriting its winner.
  It is capture-only: it never appends to host rules, creates skills, or
  files upstream issues — promotion is the gardener's ticket-gated job.
- **`lisa-debrief-apply`** routes accepted debrief findings in the three
  knowledge categories — recurring gotcha, process friction, convention drift —
  to the ledger through the same contract (`persistLearningEntry` /
  `persistConsolidatedLearning`, with consolidation-at-write), provenance drawn
  from the triage row's evidence links and a `high` starting confidence because
  a human Accept is corroboration. It no longer writes to machine-local memory,
  the host-rules directory `.agents/rules/` (or a surviving legacy
  `PROJECT_RULES.md`), or `AGENTS.md` (the human-authored source of truth, of
  which `CLAUDE.md` is only a `@AGENTS.md` pointer) for these categories.
- The **build-intake flows** advance `last_confirmed` at claim time
  (`confirmLearningEntry`, below).

Promotion to a higher rung (skill, eager rule, executable control, upstream
ticket) is never a writer here — it is the gardener's job, gated by a human
flipping a tracker ticket to `status:ready`.

## Claim-time confirmation (`last_confirmed`)

`last_confirmed` is advanced at claim time by the build-intake flows (step
3c.2 of `lisa-{jira,github,linear}-build-intake`) when an entry's rule
**demonstrably applied** during a claim — the rule was explicitly cited or
observably followed in the claim's plan or diff. Presence in the eagerly
loaded context is NOT application: every entry is present in every session,
so counting mere presence would confirm everything on every claim and defeat
decay entirely.

The bump goes only through `confirmLearningEntry` from
`@codyswann/lisa/learnings`: a surgical, lock-protected, atomic write that
advances only `last_confirmed` (re-validated against the
`>= first_learned` invariant), returns a structured no-op for a missing
entry or file instead of throwing, and is idempotent within a claim (a
same-date repeat returns `unchanged`). A failed bump is reported and never
blocks the build.

Only entries accepted by the executable contract may influence the session. A
missing file is expected and silent. Malformed Markdown, invalid JSONL, unsafe
paths, non-canonical content, or over-budget documents produce one readable
warning, apply no entry, and do not block unrelated work.

Precedence:

1. System, developer, user, and repo instructions still outrank learnings.
2. Committed host rules (`.agents/rules/`) remain durable human-authored
   guidance.
3. Project learnings add recent operational knowledge, but never rewrite or
   append to host rules.

## Task telemetry (MLD) is not context

Raw task-end MLD telemetry — the Mistakes / Learnings / Desires an implementing
agent records into `metadata.learnings`, and the raw yield of debrief mining — is
rung-1 capture only: it is never read into a later session's instruction surface,
never required of an agent (empty is valid), and never graded or scored. It reaches
a durable surface only indirectly — through the learner's validation into the
ledger (which sessions still consume solely as the bounded projection above), and
from there through the gardener's ticket-gated promotion a human approved. Injecting
raw self-reports, or treating their volume as a quality signal, would reward
plausible commentary over good outcomes and bypass the very budget and validation
this contract exists to enforce.

Antigravity note: agy does not receive the plugin `rules/` tree. Lisa reconciles
a bounded `AGENTS.md` bridge that points agy at this same file without copying
learning bodies or restoring the retired full rules bake.

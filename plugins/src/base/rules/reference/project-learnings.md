# Project Learnings

Project learnings are Lisa's bounded, repo-local memory surface. They are stored
in `PROJECT_LEARNINGS.md`, derived as the sibling of the configured
`.lisa.config.json` `projectRulesFile` value. With no config override, the path
is `.claude/rules/PROJECT_LEARNINGS.md`.

Consume learnings before normal task work whenever the file exists. Use the
executable contract from `@codyswann/lisa/learnings` to parse, validate, and
budget-check the document. Do not duplicate numeric caps in rules or prompts;
the exported contract is the source of truth.

Each persisted entry has seven fields:

- `id`
- `rule`
- `why`
- `provenance`
- `first_learned`
- `last_confirmed`
- `confidence`

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
2. Committed project rules remain durable human-authored guidance.
3. Project learnings add recent operational knowledge, but never rewrite or
   append to `PROJECT_RULES.md`.

Antigravity note: agy does not receive the plugin `rules/` tree. Lisa reconciles
a bounded `AGENTS.md` bridge that points agy at this same file without copying
learning bodies or restoring the retired full rules bake.

# Project Learnings (load-bearing)

Before normal task work, resolve this repository's committed `.lisa.config.json`
and derive the machine-managed learnings ledger: the optional `learnings.file`
override, else the default `.lisa/PROJECT_LEARNINGS.md`. The ledger lives cold in
`.lisa/`, NOT in an auto-loaded rules tree — so it is never injected raw into the
session.

Consume it ONLY through the executable Lisa learnings contract exported by
`@codyswann/lisa/learnings`: parse and validate with `parseLearningsFile`, then
take the bounded serving slice from `projectLearnings` (the highest-priority
entries within the token/entry budget). **Never read the raw ledger file
wholesale into context** — the whole point of the relocation is that sessions
receive the contract's bounded projection, not the full file.

Missing learnings are a silent no-op. Malformed, non-canonical, unsafe, or
over-budget learnings produce one readable warning, apply no entry, and must not
block unrelated task work. Never append automated learnings to
`PROJECT_RULES.md`; project learnings are a separate machine-managed document.

Full prose: [reference/project-learnings.md](../reference/project-learnings.md).

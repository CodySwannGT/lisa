# Project Learnings (load-bearing)

Before normal task work, resolve this repository's committed `.lisa.config.json`
and derive the canonical learnings file as the sibling of `projectRulesFile`
(default: `.claude/rules/PROJECT_LEARNINGS.md`). If that file exists, consume it
through the executable Lisa learnings contract exported by
`@codyswann/lisa/learnings` before relying on ad-hoc memory or prior-session
notes.

Missing learnings are a silent no-op. Malformed, non-canonical, unsafe, or
over-budget learnings produce one readable warning, apply no entry, and must not
block unrelated task work. Never append automated learnings to
`PROJECT_RULES.md`; project learnings are a separate machine-managed document.

Full prose: [reference/project-learnings.md](../reference/project-learnings.md).

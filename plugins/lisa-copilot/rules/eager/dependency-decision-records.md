# Dependency Decisions (load-bearing)

Material dependencies are recorded as decisions, not lockfile trivia. The
governed record is `.lisa/DEPENDENCY_DECISIONS.md`, seeded once by `lisa apply`
from the `all/create-only` template surface and never overwritten afterward.

A *material* dependency is one that owns a user-visible capability or would cost
real time to replace. Each record entry must name, in this order: why we keep it
in plain language, what it is, its owned capability, trust basis, exposure,
replacement cost, detection evidence, owner/review cadence, and last-reviewed
date. Field labels lead with the operator's question and keep the technical term
in parentheses. "Why we keep it" comes first on purpose — an entry that opens
with a version range opens with the trivia the record exists to replace.

When you add, upgrade across a major version, or remove a material dependency,
update its entry in the same change. When you cannot name the detection evidence
that would fail if an update broke the owned capability, write "nothing would
catch it" rather than inventing a check — the gap is the finding.

Write every entry so a non-technical operator can tell why the dependency is
kept and what evidence would detect a bad update. Lead with the outcome it
protects, not the mechanism.

Entries are repeatable blocks appended under `## Records`, so a seeding script
can add one without rewriting the file. An honest gap is written as
`_Not yet decided_` — never left blank.

Escalate, rather than just recording, when detection evidence says "nothing
would catch it", when `Last reviewed` predates the dependency's last major
upgrade, or when the trust basis names no maintainer or owner.

Full prose: [reference/dependency-decision-records.md](../reference/dependency-decision-records.md).

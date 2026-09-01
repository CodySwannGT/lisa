# Runbook — `enforcement-census`

Loop: `lisa-auto-lisa-enforcement-census`
Command: `/lisa:enforcement-census`
Cadence: daily

## Intent

Keeps the fleet honest about whether its checkouts are enforcing anything at all: every checkout on
this machine's fleet roster is re-measured, and the ones protected by nothing are named out loud
instead of staying silent.

## Sources of truth

The fleet roster `.lisa.workspaces.json` on this workstation — the same machine-local file
`scripts/lisa-update-local.sh` reads — and the checkouts it names, read directly from disk. Inside
each checkout: `scripts/lisa-hooks/`, `plugins/lisa/hooks/`, `.lisa/apply-receipt.json`,
`plugins/lisa/.claude-plugin/plugin.json`, `package.json`, and
`node_modules/@codyswann/lisa/package.json`. No network call, no registry lookup, no vendor API.

## Candidate selection

Every checkout the roster names, plus any discovered under a `--scan` directory, deduplicated by
real path. Bounded by the roster: a run measures what the roster names and nothing else, and says so
in its own output, because a checkout nobody listed is unmeasured rather than covered.

## Scope/bounds

The census **reads**. It never writes to a checkout, never runs `lisa apply`, never installs, never
files a ticket, and never changes an exit status on the strength of a finding. One run is finite
because the roster is finite and every read is a small file.

## Proof

The four resolution classes it prints partition the roster and sum to its size; the three vintage
classes partition the enforcing subset. Every count is derived from the checkouts on disk during the
same run — nothing is read back from a stored number, which is the failure this loop replaced.

## Autonomous-vs-approval boundary

It does everything alone, because everything it does is look. The first thing on the other side of
the line is repairing a checkout: running `npx @codyswann/lisa apply` in somebody's working copy is
a human's call, and the report names the command rather than running it.

## Escalation

A run that could not measure — no roster, an unreadable roster, no built `dist/` — reports
`recovery-required` with a one-line statement of what it could not read. It does **not** file a
ticket per unenforced checkout: those are working copies, not tracked work, and a nightly loop that
files the same tickets every night is a loop everyone learns to ignore. If unenforced checkouts
persist across runs, that is a conversation with their owners, not a backlog.

## Recovery

Restore the named input: put a fleet roster on the machine, fix the path that could not be read, or
run `bun run build:dist`. Then run `/lisa:enforcement-census` again. Until a run completes, the
fleet's coverage is **unknown** — never quote the previous run's numbers as current.

## Next-run state

Nothing is carried in memory. The next run re-reads the roster and the checkouts, so it observes
whatever is true then. Comparing runs is done by comparing their reports, which is why `--redact`
produces stable per-checkout labels.

## Retirement condition

Retire this loop when enforcement stops resolving from the checkout — if the guards ever come from
the installed package rather than from the tree an agent is working in, there is no per-checkout
resolution left to census, and this loop should propose its own teardown along with the mechanism it
measures.

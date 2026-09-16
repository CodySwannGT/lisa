# Delivery observations (optional extension)

Keep the primary 17-field usage token unchanged. New writers attach
`LisaUsageEntry.effectiveness`; the shared serializer emits the adjacent
`lisa:usage-effectiveness` token correlated by `entry_id`. Older readers may ignore
the extension. New writers preserve it when rewriting historical rows.

Each observation has `schema: 1` and all these fields, using `null` for unknown:

- `lisaVersion`, `workerConfigRevision`: observed version/revision tags.
- `workerWallMs`: actual execution duration for this run.
- `feedbackMs`: measured blocking request-to-response samples in milliseconds.
  Start when this worker issues the request; stop when its response is available.
  Waiting on another agent is queue latency and is excluded. `[]` means a measured
  run with no such requests; `null` means unavailable telemetry.
- `workerSource`: runtime evidence identifier for wall time and feedback samples.
- `attention`: observed `{id, source}` human interventions. Derive these from
  non-bot ready-role flips, blocked-item answers, and review interventions. Dedupe
  by stable tracker event identity. `[]` means the relevant history was inspected
  and contained no interventions; `null` means it was not measured. Never infer
  human minutes from gaps between comments.
- `readyAt`, `acceptedAt`: canonical UTC timestamps from the configured ready-role
  flip and terminal accepted outcome. The elapsed clock excludes pre-ready intake.
  A merge or queued deployment alone is not acceptance. `lifecycleSources` holds
  the tracker/release evidence for these timestamps.
- `reworkSources`: observed reclaims, QA bounces, or reverts. The existing
  `lisa-delivery-effectiveness` skill owns rework rates and other outcome measures;
  these are observations, not a competing score.

At the existing implement, verify, and intake accounting milestones, supply these
observations even if every measurement is unknown. Collect runtime observations
as work proceeds; do not reconstruct feedback samples from memory at the end.
Runtime APIs differ across agents: unavailable measurements remain null on any
agent rather than being estimated from tool/PR/token counts.

After the canonical usage row is read back, mirror `{entryId, artifactRef,
effectiveness}` with `lisa effectiveness record --input <json-file>`. Mirrors under
`.lisa/effectiveness/` are ignored and disposable; reconstruct them from usage
extensions when needed. Do not commit timing reports or store secrets in sources.
The command refuses a non-ignored destination. Report write failures explicitly;
they must not erase the canonical accounting row or claim measurement succeeded.

Record an actual post-control failure using `lisa effectiveness recurrence --input
<json-file>`. The object contains `invariant`, `surface`, `controlRef`,
`controlShippedAt`, `occurrenceRef`, and `occurredAt`. Both timestamps use canonical
UTC ISO strings with milliseconds. Verify that the control/learning really shipped
before this occurrence; initial failures and unshipped proposals are not recurrences.
Use a stable occurrence source, such as a test-run failure or tracker event, so
replays and reports from different agents identify the same event.

`.lisa/RECURRENCES.jsonl` is committed history: distinct occurrence identities are
the durable count. Its existing built-in `merge=union` attribute retains concurrent
branch appends, and the reader deduplicates replayed events. Never hand-increment
a counter, compact away occurrences, or add counts to the bounded learnings ledger.
Normal review, secret checks, and push requirements still apply to this file.
The writer refuses missing merge setup and conflicting evidence for one identity.

`lisa effectiveness report` is read-only. Its per-run feedback distribution, wall
time, attention count, and ready-to-accepted duration remain separate. Attention
ratios cover only the locally observed accepted outcomes, with the reported sources
and denominator. Missing local records are unknown coverage, not zero factory effort.
Rebuild local records for the requested reporting scope before making a scope-wide
claim; never extrapolate a local subset to the whole queue.

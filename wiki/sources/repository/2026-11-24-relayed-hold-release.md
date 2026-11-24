# Relayed Hold Release Source

- Ingested: 2026-11-24
- Work item: [CodySwannGT/lisa#5190](https://github.com/CodySwannGT/lisa/issues/5190)
- Branch at ingestion: `feat/5190-relay-hold-release`, cut from `main` at `49c968171a` (Lisa 8.9.0)
- Origin: a ruling by the repository owner on 2026-11-24, recorded word for word in the work item under "Owner rulings". The report that prompted it came from a caller repo in the portfolio; no host project, company or person is a source for this note.

## Scope read

- `plugins/src/base/scripts/intake-blocker-reprobe.mjs` (`humanGateReleases`, `isTrustedHumanComment`, `formatHumanGateRelease`), the one place every hold reader decides whether a release counts.
- `plugins/src/base/scripts/operator-id-kinds.mjs` and the validator's copy of the entry grammar in `plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs`.
- The session manager's release readers: `cli-queue.mjs`, `queue-github.mjs`, `cli-cycle.mjs` (blocked-item plan), `orphan-sweep.mjs`, and `config.mjs` (`trustedReleaseEntries`).
- The rule `ready-role-filing`, "Human-gate release authorization", and the nine skills that restate it.

## What was searched before deciding

- The tracker, open and closed, for a relayed or automation-posted release: none asked for it and none was declined. Related closed work: #4895 (a separate list of who may release), #4623 (kind-keyed identity entries), #4687 (how wide the human gate is).

## Pages synthesized

- [Decision: an automation account may relay a hold release when the project says so](../../decisions/2026-11-24-relayed-hold-release.md)

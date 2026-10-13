### Code review for branch `feat/4448-session-manager`

This branch was **self-reviewed**: the team that wrote it reviewed it, using five parallel reviewers and a separate confidence scorer. That is weaker than an independent review, and it does not satisfy the third-party review check.

Reviewed 15 commits with changes to 75 source files. The generated `plugins/lisa*` copies and the evidence manifest were excluded from line-level review.

The design-source gate passed: the branch touches no UI surfaces.

Found 1 issue at or above the confidence bar of 80:

1. **A ref whose number has 4 or more digits breaks worker-name parsing, so the live-worker guard never fires.** (Bug: `PROJ-1234` gives `wk-PROJ-1234-1012-1530`. The lazy pattern reads token `PROJ`, so `findLiveWorker(agents, "PROJ-1234")` returns null, `spawn` never exits 4, and every cycle can start another bypass-permission worker on the same item. Reproduced with `parseWorkerName`.)
   - File: `plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs:41`, used by `findLiveWorker` and by `spawn` in `cli-workers.mjs:128`.
   - Blocking: yes. Disposition: fixed.

Below the bar (scored 50-75), but verified real, cheap to fix, and fixed in the same pass (non-blocking):

- N (75): `trustedAuthorIds` is documented as "ids or logins", but GitHub matching uses the numeric `user.id`, so a login silently excludes every item. Files: `validate-config.mjs:~774`, `config-resolution.md:~735`.
- I (50): the session-manager status row's observed text says "No automation is expected", which contradicts its "hosted locally" reason. Files: `automation-status-expected-fleet.mjs`, `automation-status-{claude,codex}-adapter.mjs`.
- J (50): the `executionEnv` routing table can dispatch remotely before the `managedBy=` local-only refusal is reached. Files: `lisa-implement/SKILL.md:10-37`, `commands/implement.md`.
- L (50): `managedBy=` questions relayed to Telegram have no rule against including credential values or verbatim untrusted text. File: `lisa-implement/SKILL.md:30-37`.
- H (50): the validator's CLI reads only `.lisa.config.json`, while `sessionManager` is documented as local-over-global. File: `validate-config.mjs:795-801`.
- M (50): doctor shallow-merges local over global, while the runtime merges deeply. File: `src/cli/doctor-session-manager.ts:~96`.
- C (25): a ledger item with `worker: null` matches unnamed agents during `classify`. File: `cli-workers.mjs:~255`.

Deferred (scored 25-50), with the reason for each:

- B (ledger lock): the manager is the only ledger writer, so no concurrent writer exists by design.
- D (empty `trustedAuthorIds` dispatches any author): this is a deliberate default. Doctor fails public repos and warns otherwise.
- E (queue cannot see a trusted human's release of a held item): this fails closed. The item stays excluded until it is released through the tracker's normal flow. Candidate follow-up.
- F (8-hex session-id fallback): it is word-bounded and runs only when no UUID is printed.
- G (unguarded `JSON.parse` in `init-config`): only reachable when the config is half-written mid-run.
- K (duplicated interval parser): the copies match today. Candidate follow-up: a parity test.
- O (probe label on `has-session` failure): a misreport on a tmux server error, not a safety issue.

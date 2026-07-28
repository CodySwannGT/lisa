# Quality + Security Review — #1957 bare repo-name label (T3)

**Commit reviewed:** `b1052186f` (`fix(work-item): accept bare repo-name labels as repository scope`), branch `fix/1957-linear-bare-repo-label`. HEAD matches the commit for all four relevant paths (`git diff --stat b1052186f -- <paths>` is empty).

**Verdict: APPROVE — no blocking findings.** 2 non-blocking suggestions below.

---

## Security lens (must-answer questions)

### Q1 — Is the new third arm EXACT-match only? **YES — proven empirically.**

- **Code reading:** `namesFrom` (`all/copy-overwrite/scripts/lisa-work-item.mjs:420-426`) lowercases each label string (or `{name}` object) and drops non-strings. The new arm is `labelNames.includes(bare)` (`:442`) where `bare = contract.identityRepo.toLowerCase()`. `Array.prototype.includes` is whole-element strict equality — there is no substring, prefix, regex, or `startsWith` anywhere in the path.
- **Empirical probe:** extracted the shipped `namesFrom` + `assertRepoScope` verbatim from the file at HEAD and drove 17 hostile inputs through them (identityRepo `frontend`). All 17 behaved correctly:
  - ACCEPTED: `frontend`, `repo:frontend`, `FRONTEND`, `frontend` vs identityRepo `FrontEnd` (case-insensitive both directions), `{name:"frontend"}` object form, Jira component `frontend`.
  - REJECTED: `frontend-app` (suffix), `myfrontend` (prefix), `the-frontend-repo` (substring), `" frontend "` (whitespace-padded — labels are NOT trimmed, which is fail-closed: a padded label rejects rather than sneaking through), `repo:frontend-app`, `backend`, `sentry`, empty list, `{name:"frontendx"}`, component `frontend-app`, junk entries (`null`, `42`, `{}`).
- **Test-suite pins:** mixed-case acceptance (`"Widgets"` vs repo `widgets`, test :893-903) and the wrong-repo / unrelated-bare / unscoped controls (test :906-946) pin this behavior; the `repo:other` + bare-`backend` controls kill an accept-any-label mutant.

### Q2 — Can a bare label scope an item to the WRONG repo in any lane? **No new lane behavior; skip semantics unchanged.**

- The commit touched only the **body** of `assertRepoScope` (`:428-448`) — all four call sites are byte-identical to before: GitHub `:551-552` (still guarded by `if (!contract.repositoryIsIdentity)`), Jira curl `:623`, Jira acli `:681`, Linear `:768`.
- **GitHub queueRepo vs identityRepo:** `repositoryIsIdentity` (`:237`) is computed exactly as before; when queue == identity the check is still **skipped entirely** (research :542-544, now :551 after the diff shift). The new arm cannot change *when* the check runs, only what a *running* check accepts. The new GitHub test (test :470-490) exercises the split-queue lane (`repo: "identity"`, `queueRepo: "acme/widgets"`) — bare `identity` label accepted, status 0.
- The bare label must equal `contract.identityRepo` — the **current repo's own short name** (derived via `repoBasename`: config → env → git remote). A bare label naming a *different* repo (`backend`) still rejects (probe + test :925-935). So an item can only newly bind in repo X if it carries the label exactly `x` — which is precisely the documented Sentry-provenance taxonomy.
- **Accepted residual risk (by design, not a finding):** any bare label that happens to exactly equal a repo short name (e.g. a team label coincidentally named `frontend`) now scopes an item to that repo. This is the explicit intake-side rule the issue mandates mirroring (issue #1957; plan Option A; config-resolution.md:949). Exact-match + case-insensitivity is the documented boundary and it holds.

### Q3 — Does the widened acceptance interact with `repositoryIsIdentity` or the Jira component arm? **No.**

- `repositoryIsIdentity`: untouched — GitHub-contract-only field, sole consumer is the unchanged guard at `:551`.
- Jira component arm: `componentNames.includes(bare)` is semantically identical to the old `componentNames.includes(contract.identityRepo.toLowerCase())` — same value, just hoisted into `bare`. Components still accept only the exact bare name (probe confirms component `frontend-app` rejects).
- The widening is confined to the `labels` array. No other input (title, description, branch, env) feeds the decision.

---

## Quality checks

| Check | Result |
| --- | --- |
| Targeted suite | `bunx vitest run tests/unit/scripts/lisa-work-item.test.ts` → **27/27 passed** (run by this reviewer at HEAD) |
| Full-suite claim | Fixer recorded a full `bun run test` pre-commit; targeted suite independently green, change surface is one function + tests + manifest → recorded full run trusted |
| Manifest hash | `shasum -a 256` of the mjs at HEAD = `f12006df…db72` = exactly the manifest value in `src/core/upstream-evidence-manifest.ts:8` ✔ |
| Shim | `scripts/lisa-work-item.mjs` — 0-byte diff, still the 5-line re-import ✔ |
| Message-tail pins | Repo-wide grep for `require label` / `not scoped to repository`: only the source line + 7 test `toContain` pins, **all** pin the surviving `not scoped to repository <name>` prefix; no doc/skill/wiki pins either tail. New tail (`require label repo:X or bare label X`) matches shipped behavior verbatim ✔ |
| Controls complete | All four stay-rejected controls present: unscoped (test :913), bare wrong-repo `backend` + `repo:backend` (:925), unrelated bare `sentry` (:938), pre-existing `repo:other` (:843) ✔ |
| Commit hygiene | Conventional format `fix(work-item): …`; `Work-Item:` trailer is the last non-empty line (verified `cat -e`) ✔ |
| Comment citations | `:949` exact — "uniform across trackers… component alias" is at config-resolution.md:949 ✔. `:973` is off by 5 — see S2 |
| Coding philosophy | No mutation, consts only, single throw path; new test helper has JSDoc ✔ |

## Findings (ranked)

### Critical — none
### Warning — none

### Suggestion

**S1 — Duplicate Linear response builders in the test file (test-coverage/clarity, non-blocking)**
- **What:** The new hoisted helper `linearIssueResponse(labels)` (tests/unit/scripts/lisa-work-item.test.ts:173-186) builds the exact same JSON payload as the pre-existing local helper `response(labels, children)` (:827-841) — same id, identifier, team, state, node shapes. The hoist added a second helper instead of consolidating; three old use sites (:845, :857, :865) still use the local one.
- **Why:** Two identical payload builders can drift apart silently; a future payload-shape change fixed in one leaves the other stale. No behavioral difference today — both suites pass and the payloads are structurally identical for the labels-only case.
- **Fix (follow-up, not this PR):** give `linearIssueResponse` an optional `children: object[] = []` second parameter and delete the local helper at :827.

**S2 — Comment citation off by 5 lines (documentation, non-blocking)**
- **What:** The new comment in `assertRepoScope` (all/copy-overwrite/scripts/lisa-work-item.mjs:430) cites `config-resolution.md:949,:973`. The `:949` half is exact; the "match is by repo short name, case-insensitive" sentence is actually at **:968**, not :973.
- **Why:** The claimed *content* is accurate — only the second line number drifted (the research doc carried the same :973). Harmless today, mildly misleading to a future reader.
- **Fix (optional):** `:973` → `:968`, or drop line numbers and cite the section heading ("Repo scoping / The `repo:<name>` label"), which won't rot.

---

*Reviewer: quality-specialist (T3, with security lens per roster-1957). No code changes made.*

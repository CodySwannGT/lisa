# Plan — work-item-context-handoff (CodySwannGT/lisa#4323)

- Work type: Fix. Base: main (deploy.branches production=main). Branch: fix/4323-work-item-context-handoff.
- Context file (verbatim bundle): .lisa/work-item-context.md — every teammate reads it in full.
- Roster: .lisa/roster/CodySwannGT-lisa-4323.md
- Task list: TaskCreate is refused by the session's lisa 4.65.0 `block-direct-issue-create.sh` hook (false positive on a non-tracker tool); this file is the task record.

## Completion condition
- End state: a regression test that is RED on 394e2c9 and GREEN on the branch; all six plugin surfaces carry the context-file contract; after merge, the release workflow publishes a version > 4.66.4 to npm whose tarball contains the contract.
- Proof: `bunx vitest run <test>`; `git stash`-style revert check; `npm view @codyswann/lisa version` + `npm pack @codyswann/lisa@<v>` grep.
- Constraints: no behaviour change to claim/bind; context file never committed; no downstream project named.

## Tool access
- gh CodySwannGT/lisa: pass (resolver created/claimed #4323). npm registry read: probe at release.

## Tasks
1. Research (Explore) — pipeline, tests, ignore templates, callers.
2. Fix (bug-fixer) — RED test, source edits, regenerate surfaces, gates.
3. Verify (verification-specialist) — independent verdict.
4. Learnings (learner).
5. PR → merge → release → npm.

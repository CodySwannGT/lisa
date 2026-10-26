# Roster Decision — CodySwannGT/lisa#4473

Flow: Implement / Fix. Plan: restore-hosted-rails-runtime-qualification.
Parent objective: implement solutions for the remaining open Lisa issues.
This item restores a shared qualification check; it does not replace the rest of the queue.

The Codex collaboration tool exposes a generic agent with task prompts, not a
selectable specialist-type catalog. All roles below therefore use the same
inherited generic agent; no model override is requested.

INCLUDE - general-purpose - the only exposed delegation type; explicit role prompts provide the needed research, implementation, review, verification and learning separation.

## Role assignments

- input-resolver: live leaf read, idempotent claim and worktree binding; complete.
- Explore / reproduction: inspect the shipped package-preparation path and history, then reproduce the reported apt refusal in genuine Ubuntu 24.04 amd64 Docker before proposing changes.
- hosted-failure investigator: read current Actions logs/artifacts and distinguish the current qualification failure from historical evidence; no source edits.
- bug-fixer: add a reachable red control, update the exact roster/snapshot without changing package membership or permitting downgrades, and regenerate dependent outputs.
- product/spec reviewer: compare the complete issue and preserved comments with the proposed behavior and acceptance evidence.
- quality/local-code reviewer: review source, meaningful tests, artifact freshness and failure diagnostics independently of the implementer.
- security reviewer: inspect exact package provenance, snapshot identity, no-downgrade enforcement and foreign-resource preservation.
- verification specialist: execute the real before/after container proof and inspect a current GitHub-hosted qualification result; write a bounded claim/evidence verdict.
- learner: record concise task MLD through Lisa's project-learnings contract; no global memory edits.
- lead: sequencing, task metadata, access preflight, canonical Git/PR lifecycle, evidence posting and verified tracker completion.

Independent reviews run concurrently within the runtime's three available worker
slots; the native CodeRabbit PR review is inspected alongside them. A new finding
or failed check can reopen the relevant review, per convergent-review.

## Context and constraints

Every worker reads `.lisa/work-item-context.md` in full before acting.
Comment inventory: (1) 2026-10-16, CodySwannGT, decision/constraint: build-ready,
related #4470/#4383, no blockers; (2) 2026-10-26, CodySwannGT, decision: stable
implementation claim. The ignored context retains the complete comments.

Keep every supported agent's equivalent shipped surface in parity. Preserve
unrelated changes and `.lisa.workspaces.json`. Do not stage credentials,
dependency/build outputs, raw logs or the ignored context bundle.

---
name: lisa-github-claim
description: "Idempotently claims one live…"
allowed-tools: ["Bash", "Skill", "Read"]
---

# Claim GitHub Issue: $ARGUMENTS

Claim exactly one canonical `org/repo#<number>` reference. This is the reusable direct-session counterpart of `lisa-github-build-intake` Phase 3b.

1. Resolve merged `.github.org`, `.github.repo`, optional `.github.queueRepo`, and `github.labels.build` values from local-over-global config. Resolve current-repository identity independently using `repo-scope-split` / `config-resolution` (`.repo` -> `.github.repo` -> `git remote get-url origin` basename). The queue repository defaults to `<github.org>/<github.repo>`; it is only the tracker storage/scan target and never replaces current-repository identity. Resolve the ready and claimed roles from config (defaults `status:ready` and `status:in-progress`); do not hardcode lifecycle decisions.
2. Require the ref's `org/repo` to equal the resolved queue repository. Invoke `lisa-github-read-issue <ref>` immediately before mutation. When the queue repository differs from the current repository, require exactly the current-repository scope (`repo:<current>`); reject an unlabeled issue, `repo:<other>`, or an ambiguous multi-repo leaf. Also reject a closed issue, an active blocker, any issue with open child work, or a childless Epic per `repo-scope-split` and `leaf-only-lifecycle`.
3. Inspect the live build lifecycle labels:
   - Already claimed, review, environment-done, or another configured later non-terminal role -> preserve it and set `claim_outcome: reused`.
   - Ready or no build lifecycle label -> run `gh issue edit <number> --repo <org>/<repo>`, remove ready when present, and add claimed. This is the idempotency lock.
   - Terminal label/state -> reject; completed work cannot be rebound as new work.
4. If and only if the issue is unassigned, add `@me`; leave every existing assignee untouched.
5. Post the stable marker comment once, deduped against all existing comments:

   ```text
   [lisa-tracker-claim] Claimed by Lisa. Starting implementation.
   ```

6. Invoke `lisa-github-read-issue <ref>` again. Success requires the issue to remain open, leaf/current-repo (including the explicit `repo:<current>` proof for an umbrella queue), and in claimed or a later non-terminal role. If the relabel or verification fails, return failure and do not authorize a binding.
7. Return `tracker_provider: github`, canonical `work_item_ref: <org>/<repo>#<number>`, `claim_outcome: claimed|reused`, assignee outcome, and the post-write status evidence.

Never create an issue here. Never call GitHub for a configured Jira or Linear project.

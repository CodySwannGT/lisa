---
name: lisa-linear-claim
description: "Idempotently claims one live Linear leaf issue for direct Lisa work. Reuses linear-build-intake Phase 3b semantics through lisa-linear-access: configured ready-to-claimed relabel, assign-only-if-unassigned, stable managed comment, and post-write verification."
allowed-tools: ["Bash", "Skill", "Read"]
---

# Claim Linear Issue: $ARGUMENTS

Claim exactly one canonical Linear identifier such as `ENG-123`. All Linear access goes through `lisa-linear-access`. This is the reusable direct-session counterpart of `lisa-linear-build-intake` Phase 3b.

1. Resolve merged `linear.workspace`, `linear.teamKey`, and Linear build-label roles from local-over-global config. Require the identifier's team key to equal the configured team. Resolve ready and claimed roles from config (defaults `status:ready` and `status:in-progress`); do not hardcode lifecycle decisions.
2. Invoke `lisa-linear-read-issue <identifier>` immediately before mutation. Reject a completed/canceled issue, active blocker, `repo:<other>` issue, any issue with open sub-Issues, or an Epic per `repo-scope-split` and `leaf-only-lifecycle`.
3. Inspect live build labels/workflow state:
   - Already claimed, review, environment-done, or another configured later non-terminal role -> preserve it and set `claim_outcome: reused`.
   - Ready or no build lifecycle label -> invoke `lisa-linear-access operation: save-issue`, remove ready when present, and add claimed (resolve label IDs with `list-issue-labels`, creating claimed only when missing). This is the idempotency lock.
   - Terminal/completed -> reject; never regress completed work.
4. If and only if the Issue is unassigned, resolve the authenticated viewer and set its `assigneeId` through `lisa-linear-access operation: save-issue`. Leave an existing assignee untouched.
5. Post this stable comment once through `lisa-linear-access operation: save-comment`, deduped against all existing comments:

   ```text
   [lisa-tracker-claim] Claimed by Lisa. Starting implementation.
   ```

6. Invoke `lisa-linear-read-issue <identifier>` again. Success requires a non-terminal, current-repo leaf in claimed or a later non-terminal role. A failed relabel or failed verification is a hard failure and must not authorize a binding.
7. Return `tracker_provider: linear`, canonical `work_item_ref: <IDENTIFIER>`, `claim_outcome: claimed|reused`, assignee outcome, and the post-write status evidence.

Never create an Issue here. Never bypass `lisa-linear-access`.

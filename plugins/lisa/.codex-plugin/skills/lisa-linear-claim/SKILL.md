---
name: lisa-linear-claim
description: "Idempotently claims one live…"
allowed-tools: ["Bash", "Skill", "Read"]
---

# Claim Linear Issue: $ARGUMENTS

Claim exactly one canonical Linear identifier such as `ENG-123`. All Linear access goes through `lisa-linear-access`. This is the reusable direct-session counterpart of `lisa-linear-build-intake` Phase 3b.

1. Resolve merged `linear.workspace`, `linear.teamKey`, and the Linear build-lifecycle roles from local-over-global config. Require the identifier's team key to equal the configured team. Resolve the `ready` and `claimed` roles through `scripts/resolve-lifecycle-role.mjs` (`--vendor linear`). Both are REQUIRED roles with **no built-in default** — an unset one is a setup defect to report, never a name to substitute. Do not hardcode lifecycle decisions.
2. Invoke `lisa-linear-read-issue <identifier>` immediately before mutation. Reject a completed/canceled issue, active blocker, `repo:<other>` issue, any issue with open sub-Issues, or an Epic per `repo-scope-split` and `leaf-only-lifecycle`.
3. Inspect the Issue's live workflow **state**:
   - Already claimed, review, environment-done, or another configured later non-terminal role -> preserve it and set `claim_outcome: reused`.
   - In the configured `ready` state -> invoke `lisa-linear-access operation: save-issue lifecycle_role: claimed`. The access layer resolves the `claimed` role's exact configured state itself and dispatches that ID; this skill never hands it a state ID to trust. A missing or ambiguous configured state is a setup defect the layer refuses on, never created here. This is the idempotency lock.
   - In any OTHER non-terminal state -> reject. An Issue that is not in the `ready` state has not been sanctioned for build, and absence of a lifecycle marker is no longer evidence of readiness: since the lane moved to states, every Issue always has one, so "no lifecycle label" is not a state this can observe.
   - Terminal/completed -> reject; never regress completed work.
4. If and only if the Issue is unassigned, resolve the authenticated viewer and set its `assigneeId` through `lisa-linear-access operation: save-issue`. Leave an existing assignee untouched.
5. Post this stable comment once through `lisa-linear-access operation: save-comment`, deduped against all existing comments:

   ```text
   [lisa-tracker-claim] Claimed by Lisa. Starting implementation.
   ```

6. Invoke `lisa-linear-read-issue <identifier>` again. Success requires a non-terminal, current-repo leaf in claimed or a later non-terminal role. A failed state transition or failed verification is a hard failure and must not authorize a binding.
7. Return `tracker_provider: linear`, canonical `work_item_ref: <IDENTIFIER>`, `claim_outcome: claimed|reused`, assignee outcome, and the post-write status evidence.

Never create an Issue here. Never bypass `lisa-linear-access`.

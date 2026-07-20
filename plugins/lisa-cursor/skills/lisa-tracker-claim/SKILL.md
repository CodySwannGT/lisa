---
name: lisa-tracker-claim
description: "Vendor-neutral dispatcher for idempotently claiming one already live-validated leaf work item. Reads the required tracker from .lisa.config.json and delegates to lisa-jira-claim, lisa-github-claim, or lisa-linear-claim. The vendor skill owns the post-read leaf/open guard, ready-to-claimed mutation, attributable assignment, and post-write verification."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Claim: $ARGUMENTS

Thin dispatcher. `$ARGUMENTS` must contain exactly one canonical work-item reference. The caller must have already fetched it with `lisa-tracker-read`; each vendor claim skill independently repeats the live read before mutation and verifies the claim afterward so stale caller context cannot authorize a write.

## Workflow

1. Resolve merged tracker config exactly as `lisa-tracker-write` does:

   ```bash
   local_tracker=$(jq -r '.tracker // empty' .lisa.config.local.json 2>/dev/null)
   global_tracker=$(jq -r '.tracker // empty' .lisa.config.json 2>/dev/null)
   tracker="${local_tracker:-$global_tracker}"
   ```

2. Dispatch without changing `$ARGUMENTS`:
   - Missing / empty -> stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` -> invoke `lisa-jira-claim`.
   - `github` -> invoke `lisa-github-claim`.
   - `linear` -> invoke `lisa-linear-claim`.
   - Anything else -> stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Return the vendor result unchanged. Success must include `tracker_provider`, canonical `work_item_ref`, `claim_outcome: claimed|reused`, and the post-write live-read evidence.

## Contract

- Claim only an open/unresolved, current-repository leaf per `leaf-only-lifecycle` and `repo-scope-split`. Never claim a container, terminal item, inaccessible item, or item from a different configured project.
- Preserve later active lifecycle states. If the item is already in the configured claimed role or a later non-terminal role, return `reused`; never move it backward.
- A fresh claim uses the same idempotency lock as the three build-intake Phase 3b flows: move configured ready to configured claimed, or place an unlaned backlog leaf directly in claimed; assign to the authenticated user only when unassigned; never replace an existing owner.
- Fail closed if the mutation or post-write read cannot prove the claimed-or-later state. A tracker outage is a blocker, not permission to work untracked.
- This skill claims existing work only. It never creates a ticket and never writes the worktree binding.

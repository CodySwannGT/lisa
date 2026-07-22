---
name: lisa-jira-claim
description: "Idempotently claims one live Jira leaf ticket for direct Lisa work. Reuses jira-build-intake Phase 3b semantics through lisa-atlassian-access: configured ready-to-claimed transition, assign-only-if-unassigned, stable managed comment, and post-write verification."
allowed-tools: ["Bash", "Skill", "Read"]
---

# Claim Jira Ticket: $ARGUMENTS

Claim exactly one canonical Jira key. All Jira access goes through `lisa-atlassian-access`; do not call MCP tools or `acli` directly. This is the reusable direct-session counterpart of `lisa-jira-build-intake` Phase 3b.

1. Resolve merged `atlassian.cloudId`, `jira.project`, and `jira.workflow` values from local-over-global config. Require the key's project prefix to equal the configured Jira project. Resolve ready, claimed, review, environment, and terminal roles from config; do not hardcode status decisions.
2. Invoke `lisa-jira-read-ticket <key>` immediately before mutation. Reject a resolved/terminal ticket, active blocker, `repo:<other>` ticket, any item with open children/subtasks, or an Epic per `repo-scope-split` and `leaf-only-lifecycle`.
3. Inspect the live workflow role:
   - Already claimed, review, environment-done, or another configured later non-terminal role -> preserve it and set `claim_outcome: reused`.
   - Ready or an unlaned backlog leaf -> invoke `lisa-atlassian-access operation: transition key: <key> to: <configured-claimed>` and require success. This is the idempotency lock.
   - Terminal/resolved -> reject; never regress completed work.
4. If and only if the ticket is unassigned, assign it to the authenticated account through `lisa-atlassian-access` (prefer the identity-probed account id / `@me` semantics documented by Jira build intake). Leave an existing assignee untouched.
5. Post this stable comment once through `lisa-atlassian-access operation: comment`, deduped against all existing comments:

   ```text
   [lisa-tracker-claim] Claimed by Lisa. Starting implementation.
   ```

6. Invoke `lisa-jira-read-ticket <key>` again. Success requires an unresolved, current-repo leaf in claimed or a later non-terminal role. An unreachable transition or failed verification is a hard failure and must not authorize a binding.
7. Return `tracker_provider: jira`, canonical `work_item_ref: <KEY>`, `claim_outcome: claimed|reused`, assignee outcome, and the post-write status evidence.

Never create a ticket here. Never bypass `lisa-atlassian-access`.

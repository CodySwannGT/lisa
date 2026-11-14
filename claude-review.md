### Code review for branch `claude/4873-npm-updater-vendor-gate-publish-cancel`

Reviewed 6 commits with changes to 58 files (self-reviewed; local review, not the ruleset's third-party review).

Design-source gate: PASS (no UI surfaces).

No blocking issues found. Five reviewers covered CLAUDE.md/AGENTS.md/PROJECT_RULES compliance, a shallow bug scan, history-aware bugs, prior PR comments (PR #4881), and code-comment compliance.

Non-blocking findings, all applied in the follow-up commit:

1. **Hooks treated any non-"github" tracker as Jira/Linear** (hardening; `trackerScope` already rejects such configs)
   - Files: `all/copy-overwrite/scripts/lisa-automation-provenance.mjs:84`, `:225`; `all/copy-overwrite/scripts/lib/automation-provenance-local.mjs` (`localDescriptor`, `canonicalContext`)
   - Now a positive `["jira", "linear"].includes(...)` test; anything else gets the strict GitHub path.

2. **A stale remembered Jira ticket could block allocation** if Jira refused the search's `reconcileIssues` for a deleted ticket
   - File: `all/copy-overwrite/scripts/lib/npm-update-tracker-jira.mjs` (`searchPrior`)
   - A refused reconcile now falls back to the plain search used before #4873; tested.

3. **Comments promised a stricter claim-id grammar than enforced; a JSDoc sat on the wrong method**
   - Files: `automation-provenance-local.mjs`, `npm-update-cancellation-proof.mjs`, `npm-update-tracker-jira.mjs`
   - Reworded and moved.

Declined: rewriting local paths inside `evidence/4873/*.txt` (they name no host project; rewriting would invalidate the digests recorded in the independent verification verdict).

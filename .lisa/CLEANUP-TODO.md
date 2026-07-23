# Pending cleanup — PRD #1965 (deploy-branch → tracker-status sync)

## Delete the verification sandbox after DSS-9 merges

**User instruction (2026-07-23):** Delete the throwaway verification sandbox repo
`CodySwannGT/lisa-dss-sandbox` (https://github.com/CodySwannGT/lisa-dss-sandbox)
when it is no longer needed.

- **Created:** 2026-07-22 by the verification-specialist during DSS-2 T4 (live empirical proof).
- **Purpose:** disposable "crash-test" repo — fake tickets + fake deploy pipeline where
  agents run the new feature for real (ticket transitions, deployment records, approval
  gates) without touching the real `CodySwannGT/lisa` tracker.
- **Currently PUBLIC** (user approved leaving as-is): required-reviewer env protection
  needs a public repo on the current plan; content is disposable test data (fake issues,
  echo-stubbed deploy steps, no secrets).
- **Still needed by:** DSS-3 (in progress), DSS-4 (#1970, real deploy→transition),
  DSS-5 (#1971, GitHub setup skill), DSS-9 (#1975, full E2E validation journey — LAST).

**Trigger:** once DSS-9 (#1975) is merged and terminal, run:
`gh repo delete CodySwannGT/lisa-dss-sandbox --yes`
Then remove this file.

**Do NOT delete earlier** — an in-flight verification would fail.

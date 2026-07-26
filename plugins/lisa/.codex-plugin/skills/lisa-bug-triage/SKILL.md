---
name: lisa-bug-triage
description: "8-step bug triage and…"
---

# Bug Triage

Follow this 8-step triage process before implementing any bug fix. Do not skip triage.

## Triage Steps

1. Verify you have all information needed to reproduce the bug (authentication requirements, environment information, etc.). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Reproduce the bug on the path the user actually hits. Prerequisites the real path needs — seeded data, auth state, flags — are part of the reproduction; scaffolding that substitutes real behaviour is not, and a failure that survives only with it in place is a lead rather than a reproduction. Say which you have. Without a real-path reproduction you may not claim a root cause at all. If you cannot reproduce it, stop and report what you tried and what you observed.
3. Once reproduced, name a candidate cause and the observation that would disprove it, and go get that observation. Surviving the disproof is not proof — it leaves the candidate standing, not confirmed — so before implementing, execute something whose output the candidate predicts and a different cause would not produce. If you cannot get that confirmation, record the verdict as inconclusive and say so rather than proceeding as if certain; add logging, trace the path, or bisect until you can.
4. Verify you have access to the tools, environments, and permissions needed to deploy and verify this fix (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before starting implementation.
5. Define the tests you will write to confirm the fix and prevent a regression.
6. Define the documentation you will create or update to explain this bug so another developer understands the "how" and "what" behind it.
7. If you can verify your fix before deploying to the target environment (e.g. start the app, invoke the API, open a browser, run the process, check logs), do so before deploying.
8. Define how you will verify the fix beyond a shadow of a doubt (e.g. deploy to the target environment, invoke the API, open a browser, run the process, check logs).

## Implementation

Use the output of the triage steps above as your guide. Do not skip triage.

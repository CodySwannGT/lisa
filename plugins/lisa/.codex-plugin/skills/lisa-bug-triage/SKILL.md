---
name: lisa-bug-triage
description: "8-step bug triage and…"
---

# Bug Triage

Follow this 8-step triage process before implementing any bug fix. Do not skip triage.

## Triage Steps

1. Verify you have all information needed to reproduce the bug (authentication requirements, environment information, etc.). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Reproduce the bug on the path the user actually hits. If it fails only inside a harness or fixture you built for the purpose, you have a lead rather than a reproduction — say so and keep going. If you cannot reproduce it at all, stop and report what you tried and what you observed.
3. Once reproduced, state the cause and the observation that would disprove it, then go and get that observation. If the cause survives, you know what to fix. If you cannot name anything that would disprove it, you are not certain — you are guessing; add logging, trace the path, or bisect until you can.
4. Verify you have access to the tools, environments, and permissions needed to deploy and verify this fix (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before starting implementation.
5. Define the tests you will write to confirm the fix and prevent a regression.
6. Define the documentation you will create or update to explain this bug so another developer understands the "how" and "what" behind it.
7. If you can verify your fix before deploying to the target environment (e.g. start the app, invoke the API, open a browser, run the process, check logs), do so before deploying.
8. Define how you will verify the fix beyond a shadow of a doubt (e.g. deploy to the target environment, invoke the API, open a browser, run the process, check logs).

## Implementation

Use the output of the triage steps above as your guide. Do not skip triage.

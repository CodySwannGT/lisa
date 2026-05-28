---
name: task-triage
description: "8-step task triage and implementation workflow. Ensures tasks have clear requirements, dependencies, and verification plans before implementation begins."
---

# Task Triage

Follow this 8-step triage process before implementing any task. Do not skip triage.

## Triage Steps

1. Verify you have all information needed to implement this task (acceptance criteria, design specs, environment information, dependencies, etc.). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Verify you have a clear understanding of the expected behavior or outcome when the task is complete. If not, stop and clarify before starting.
3. Identify all dependencies (other tasks, services, APIs, data) that must be in place before you can complete this task. If any are unresolved, stop and raise them before starting implementation.
4. Verify you have access to the tools, environments, and permissions needed to deploy and verify this task (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before starting implementation.
5. Define the tests you will write to confirm the task is implemented correctly and prevent regressions.
6. Define the documentation you will create or update to explain the "how" and "what" behind this task so another developer understands it.
7. If you can verify your implementation before deploying to the target environment (e.g. start the app, invoke the API, open a browser, run the process, check logs), do so before deploying.
8. Define how you will verify the task is complete beyond a shadow of a doubt (e.g. deploy to the target environment, invoke the API, open a browser, run the process, check logs).

## Implementation

Use the output of the triage steps above as your guide. Do not skip triage.

---
name: epic-triage
description: "9-step epic triage and 5-step implementation workflow. Ensures epics are fully scoped, broken down, and ordered before execution begins."
---

# Epic Triage

Follow this 9-step triage process before implementing any epic. Do not skip triage.

## Triage Steps

1. Verify you have all information needed to understand the full scope of this epic (goals, acceptance criteria, impacted systems, design specs, dependencies, etc.). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Verify the epic is broken down into concrete, well-scoped bugs, tasks, and/or stories that are each fully triaged. If ambiguities exist, stop and resolve them before breaking it down.
3. Identify all cross-cutting concerns (auth, performance, security, data migrations, third-party integrations) that need to be addressed across the epic.
4. Identify all dependencies between tasks within the epic, or on external epics, teams, or services. Determine the correct order of execution.
5. Verify you have access to the tools, environments, and permissions needed to deploy and verify all tasks within this epic (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before proceeding.
6. Define the overall test strategy for the epic (unit, integration, end-to-end, load testing).
7. Define the documentation that will need to be created or updated to cover the full scope of the epic so another developer understands the architecture, design decisions, and implementation.
8. Define measurable acceptance criteria that confirm the epic is fully complete.
9. Define how you will verify the epic is fully delivered beyond a shadow of a doubt (e.g. deploy to the target environment, walk through all acceptance criteria end-to-end, confirm all child tasks/stories are closed, confirm no regressions).

## Implementation

1. Use the output of the triage steps above as your guide. Do not skip triage.
2. Work through each task and/or story in the order defined during triage, respecting dependencies.
3. Apply the Bug Implementation and Task Implementation processes to each child bug or task, respectively, as you work through them.
4. Continuously update the epic and its child issues in JIRA as progress is made.
5. Do not consider the epic complete until all acceptance criteria are verified in the target environment and all child issues are resolved.

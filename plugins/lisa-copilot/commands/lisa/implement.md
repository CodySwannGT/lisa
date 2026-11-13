---
description: "Implement one work item end to end from a ticket URL/key or description, through PR and evidence. executionEnv=codex-cloud submits it to run remotely and returns. For a whole ready queue use /lisa:intake."
argument-hint: "[executionEnv=local|codex-cloud] [managedBy=<session-name>] <single-work-item-url | key | description>"
---

Use the /lisa-implement skill to take the work item from spec to shipped: read the source, determine work type, and run the full lifecycle through PR creation, code review, deploy, and empirical verification.

If `$ARGUMENTS` carries both `managedBy=` and a non-`local` `executionEnv=`, do not dispatch: stop with "managedBy requires a local Claude Code session; remote surfaces cannot reach the manager." Otherwise, if `$ARGUMENTS` carries `executionEnv=` with anything other than `local`, route the work to that surface via /lisa-remote-dispatch and report the recorded task identifier instead of running the lifecycle locally. `managedBy=<session-name>` sends every question and the final DONE/FAILED status to that Claude Code session instead of the terminal. $ARGUMENTS

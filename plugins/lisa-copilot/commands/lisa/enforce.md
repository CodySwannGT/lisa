---
description: "Make this repository's declared checks actually run: install what runs them at commit, at push and after a coding agent edits a file, file a ticket for each requirement the repository has nothing for, compare the merge settings with the control register, and report one outcome for every Level 1 requirement. Never changes merge settings without asking."
argument-hint: "[path] [build_ready=true]"
---

Use the /lisa-enforce skill to install the carriers that run the declared checks with `lisa controls install-carriers`, file one ticket for each missing capability through the missing-capability ticket flow (on hold unless build_ready=true was passed), compare the hosting platform's merge settings with the control register with `lisa controls protect` (changing them only after the operator agrees to that exact change), and report with `lisa controls enforce-report` whether each Level 1 requirement is wired, ticketed, waiting on somebody or needs nothing switched on, together with the required checks that fail on the main branch as it stands. Adds no check of its own, fixes nothing and commits nothing. $ARGUMENTS

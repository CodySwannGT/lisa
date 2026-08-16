---
description: "Run the scheduled health consumer: check health headless, and file one deduped ticket per drifting check."
argument-hint: "[project-path]"
---

Use the /lisa-health-drift-cron skill to run Lisa Health for the optional project path and turn any
drift into tracked work. File exactly one ticket per drifting check through `lisa-tracker-write`,
deduped by the per-check marker across OPEN tickets only, and file nothing for a project in band.
This flow files; it never closes, edits, or repairs. $ARGUMENTS

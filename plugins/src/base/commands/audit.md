---
disable-model-invocation: true
description: "Audit this repository against the Level 1 requirements, part by part, and write a plain-language report to .lisa/audit. Changes nothing else, and works in a repository Lisa has never been applied to."
argument-hint: "[path]"
---

Use the /lisa-audit skill to read what already checks each Level 1 requirement in each part of the repository, write the findings to .lisa/audit/report.json, have them checked by `lisa controls report-check`, and report in plain language what is in place, what is missing and what could not be answered, changing nothing but the report. $ARGUMENTS

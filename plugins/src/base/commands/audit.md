---
disable-model-invocation: true
description: "Audit this repository against the Level 1 requirements, part by part, and write a plain-language report to .lisa/audit, with the questions only a person can answer. Changes nothing else, except to list those questions in an existing wiki. Works where Lisa was never applied."
argument-hint: "[path]"
---

Use the /lisa-audit skill to take in any answers the operator typed since the last audit, read what already checks each Level 1 requirement in each part of the repository, write the findings and the questions only a person can answer to .lisa/audit/report.json, have them checked by `lisa controls report-check`, and report in plain language what is in place, what is missing, what could not be answered and what the operator is asked, changing nothing but the report and, where the repository already keeps a wiki, the open questions in wiki/gaps.md. $ARGUMENTS

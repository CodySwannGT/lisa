---
description: "Initiative-level PRD acceptance gate. Reads a shipped PRD and its generated child work, confirms all generated top-level work is terminal, then runs spec-conformance against the PRD plus empirical verification of the shipped surface. On a CONFORMS verdict with all checks passing it transitions the PRD shipped → verified with evidence; on a conformance miss (PARTIAL/DIVERGES) or any failing empirical check it re-opens the PRD shipped → ticketed (never blocked), creates build-ready fix tickets for the gaps, and posts a failure report — the fix tickets auto-build, the PRD re-ships, and it re-verifies (a self-healing loop). Idempotent across re-runs."
argument-hint: "<prd>"
---

Use the /lisa:verify-prd skill to read the PRD, confirm its generated top-level work is terminal, run spec-conformance against the PRD and empirical verification of the shipped surface, then transition the PRD shipped → verified with evidence on a pass, or — on a fail — re-open it shipped → ticketed (never blocked) and create build-ready fix tickets that auto-build and trigger a re-verify. $ARGUMENTS

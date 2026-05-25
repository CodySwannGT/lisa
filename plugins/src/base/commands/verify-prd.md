---
description: "Initiative-level PRD acceptance gate. Reads a shipped PRD and its generated child work, confirms all generated top-level work is terminal, then runs spec-conformance against the PRD plus empirical verification of the shipped surface. On a CONFORMS verdict with all checks passing it transitions the PRD shipped → verified with evidence; on a conformance miss (PARTIAL/DIVERGES) or any failing empirical check it transitions shipped → blocked, posts a product-readable failure report, and opens linked fix issues. Idempotent across re-runs."
argument-hint: "<prd>"
---

Use the /lisa:verify-prd skill to read the PRD, confirm its generated top-level work is terminal, run spec-conformance against the PRD and empirical verification of the shipped surface, then transition the PRD shipped → verified with evidence on a pass, or shipped → blocked with a product-readable failure report and linked fix issues on a fail. $ARGUMENTS

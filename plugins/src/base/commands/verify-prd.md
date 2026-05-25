---
description: "Initiative-level PRD acceptance gate. Reads a shipped PRD and its generated child work, confirms all generated top-level work is terminal, then runs spec-conformance against the PRD plus empirical verification of the shipped surface and, on a CONFORMS verdict with all checks passing, transitions the PRD shipped → verified with evidence (the shipped → blocked FAIL path is sibling work)."
argument-hint: "<prd>"
---

Use the /lisa:verify-prd skill to read the PRD, confirm its generated top-level work is terminal, run spec-conformance against the PRD and empirical verification of the shipped surface, and on a passing result transition the PRD shipped → verified with evidence. $ARGUMENTS

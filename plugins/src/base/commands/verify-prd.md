---
description: "Initiative-level PRD acceptance gate. Reads a shipped PRD and its generated child work, confirms all generated top-level work is terminal, then (sibling tickets) runs spec-conformance + empirical verification and transitions the PRD shipped → verified | blocked."
argument-hint: "<prd>"
---

Use the /lisa:verify-prd skill to read the PRD, confirm its generated top-level work is terminal, and run initiative-level acceptance verification. $ARGUMENTS

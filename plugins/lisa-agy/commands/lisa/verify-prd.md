---
description: "Accept or reject a whole PRD once its child work is done: verify the shipped product against it, then mark it verified or re-open it with build-ready fix tickets and a readable report."
argument-hint: "<prd>"
---

Use the /lisa-verify-prd skill to read the PRD, confirm its generated top-level work is terminal, run spec-conformance against the PRD and empirical verification of the shipped surface, then transition the PRD shipped → verified with evidence on a pass, or — on a fail — re-open it shipped → ticketed (never blocked) and create build-ready fix tickets that auto-build and trigger a re-verify. $ARGUMENTS

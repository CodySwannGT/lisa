---
description: "Investigate one failed or expensive factory trajectory end to end: record the job contract, observe the baseline, locate the earliest failed handoff, classify the gap (context | capability | domain-ownership | authority | proof | feedback-delivery | worker-limitation), make the smallest owning intervention at the authoritative owner, verify at both layers, and rerun in a fresh isolated session behind a relevance gate before deciding retain, revise, remove, or test-without. Files a proposed-intervention ticket and stops when the fix exceeds the smallest owning change."
argument-hint: "<ticket URL | PR URL | session or run ref | described failure>"
---

Use the /lisa-improve-harness skill to run one bounded baseline → intervention → fresh-rerun loop on the given trajectory and post the result record to the originating work item. $ARGUMENTS

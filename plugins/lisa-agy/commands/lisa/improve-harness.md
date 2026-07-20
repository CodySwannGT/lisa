---
description: "Use after ONE run went wrong, to find the real cause and prove the fix worked. Investigates a single failed or expensive factory trajectory end to end: records the job contract, observes the baseline, locates the earliest failed handoff, classifies the gap (context | capability | domain-ownership | authority | proof | feedback-delivery | worker-limitation), makes the smallest owning intervention at the authoritative owner, verifies at both layers, and reruns in a fresh isolated session behind a relevance gate before deciding retain, revise, remove, or test-without. Files a proposed-intervention ticket and stops when the fix exceeds the smallest owning change. Unlike /lisa:debrief (mines a whole shipped initiative for learnings) and /lisa:rework-triage (fires only on QA/staging bounces), this runs on one trajectory, bounce or not."
argument-hint: "<ticket URL | PR URL | session or run ref | described failure>"
---

Use the /lisa-improve-harness skill to run one bounded baseline → intervention → fresh-rerun loop on the given trajectory and post the result record to the originating work item. $ARGUMENTS

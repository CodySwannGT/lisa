# Lisa Implement Roster Decision

Work item: `CodySwannGT/lisa#1472`

Runtime delegation inventory:

`INCLUDE - general-purpose collaboration agent - Codex exposes no enumerated specialist agent types; this is the only available delegation type and will be constrained by role-specific prompts.`

Runtime gap: Codex's collaboration surface does not expose separate built-in `Explore`, reviewer, learner, verifier, or ops agent types. The general-purpose type is therefore assigned the following bounded specialist roles for this issue:

`INCLUDE - Explore-equivalent - Required read-only codebase, documentation, test, and git-history research before implementation.`

`INCLUDE - implementation specialist - Required to implement the approved task and its regression coverage after research and access gates pass.`

`INCLUDE - review specialist - Required independent correctness, scope, quality, and regression review.`

`INCLUDE - learner specialist - Required independent review of task learnings before team shutdown.`

`INCLUDE - verification specialist - Required independent local and remote empirical verification and machine-readable verdict.`

`INCLUDE - ops specialist - Required PR/deploy lifecycle monitoring and post-deploy health evidence.`

No available delegation type is excluded.

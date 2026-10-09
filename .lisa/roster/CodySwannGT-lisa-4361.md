# Roster Decision: CodySwannGT/lisa#4361

The runtime exposes a generic agent delegation tool, with no specialist-type registry. All roles use that tool with bounded assignments; no model overrides.

INCLUDE - input-resolver - Complete live resolve, claim and binding; completed before this roster.
INCLUDE - Explore/reproduction specialist - Add real workflow-Bash regressions first, then research evidence interfaces after observing RED.
INCLUDE - implementation specialist - Implement both-arm reporting from the proved reproduction and researched evidence contract.
INCLUDE - product reviewer - Check original operator-facing requirement and all acceptance cases.
INCLUDE - adversarial code reviewer - Inspect fresh evidence, interruption and failure boundaries independently.
INCLUDE - local code reviewer - Review shell/Python/runtime correctness independently.
INCLUDE - quality reviewer - Check native execution coverage and unchanged retry policies independently.
INCLUDE - verification specialist - Observe actual workflow Bash, ledger, gate and published artifact at their claimed boundaries.
INCLUDE - learner - Consume task-end MLD through the project ledger contract; no Codex memory changes.
EXCLUDE - browser/design specialist - No browser, application UI or design surface is changed.
EXCLUDE - device infrastructure specialist - Emulator repair is the separate #4368 lane; this issue corrects reporting at the documented runner boundary.

Comment obligations: spec-repair decision/constraint and verified-claim decision/constraint, both preserved in the full ignored work-item context.

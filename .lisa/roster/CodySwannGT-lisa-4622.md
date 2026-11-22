# Roster decision: CodySwannGT/lisa#4622

The current Codex delegation tool exposes general-purpose agents and no registry
of specialist types. Existing agents are reused for bounded roles. The operator
explicitly requested that the lead perform the review itself.

INCLUDE - general-purpose input resolver - resolve, read, claim and bind the live leaf before durable work; completed by /root/resolve_4635.
INCLUDE - general-purpose test specialist - independently reproduce registration and slow-reviewer timing cases and add deterministic regression coverage.
INCLUDE - lead /root - implement, review the current diff personally, execute normal checks, deliver and verify the configured production artifact.
EXCLUDE - separate review agent - the operator requested lead review; review and evidence obligations remain enabled.

All tasks record owner and metadata.owner in the per-item plan. No raw context
bundle or credential is copied into this artifact. Input context is local and
ignored at .lisa/work-item-context.md. Learnings are consumed through the bounded
contract only; the resolver reported an empty learning set.

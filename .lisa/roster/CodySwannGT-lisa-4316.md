# Roster Decision — CodySwannGT/lisa#4316

Recorded by Codex on 2026-10-09 after the bounded input resolver completed the live claim and detached-worktree binding. Implementation has not started.

The runtime exposes collaboration.spawn_agent with a task prompt and optional model selection. It exposes no named specialist/subagent-type enumeration. Model choices are models, not specialist types; no model override is requested. The roles below therefore use prompt-scoped general-purpose workers. The generic worker is the only exposed agent type.

INCLUDE - general-purpose - The runtime exposes no more specific specialist type; every delegated worker will receive a bounded role, ownership, and explicit completion criteria.
INCLUDE - input-resolver (general-purpose) - Completed live issue resolution, canonical claim, full context persistence and worktree binding; no project source changes.
INCLUDE - Explore equivalent (general-purpose, read-only) - Research the canonical BDD writers, their consumers, history, and actual Git merge behavior before implementation.
INCLUDE - lifecycle/planning specialist (general-purpose) - Derive the effective completion condition, environment/base provenance, required access, and acceptance-preserving task plan.
INCLUDE - implementation specialist (general-purpose) - Implement the complete committed projection and preserve runtime enforcement after required access is proven.
INCLUDE - product specialist (general-purpose, independent) - Review every original acceptance criterion and the developer/operator experience.
INCLUDE - local code review specialist (general-purpose, independent) - Review source, migration, consumers, and actual merge/reproduction correctness.
INCLUDE - quality specialist (general-purpose, independent) - Review meaningful regression execution, protected CI, and published-package replay evidence.
INCLUDE - security specialist (general-purpose, independent) - Review feature-owned artifact path safety, collisions, symlinks, and obsolete generated-leaf cleanup if this approach requires them.
INCLUDE - verification specialist (general-purpose, independent) - Exercise actual writers and both Git merge orders, then the exact released package, and judge evidence boundaries independently.
INCLUDE - ops specialist (general-purpose) - Observe the genuine release and report-only post-release health checks.
INCLUDE - learner specialist (general-purpose) - Capture task-end MLD using the canonical bounded learnings contract.
EXCLUDE - browser/UI/design specialist role - The issue changes CLI-generated BDD reports and has no browser, device, or Figma surface.
EXCLUDE - database specialist role - No database or persistent business entity is introduced; generated-file ownership remains subject to reset/cleanup safety review.
EXCLUDE - cloud/deployment-infrastructure specialist role - No cloud service or infrastructure mutation is requested; GitHub CI and npm release remain explicit required-access and verification obligations.

No worker beyond the input resolver has been spawned. These are planned roles, not proof of participation or completed review. The required tool-access gate precedes implementation task creation/start. A failed required-access probe stops the dependent flow; this roster grants no exception.

Full input: .lisa/work-item-context.md (gitignored; never stage it). Comment inventory: comment 1 (6089308485), codysai001, 2026-10-09T21:09:52Z — canonical Lisa claim marker announces implementation pickup; automation-authored claim, not human acceptance. Flags: decision.

This per-work-item roster stays trackable. Do not ignore, delete, or replace it with a shared roster file.

## Resumption 2026-10-10

Original roster preserved. Bounded resolver and read-only Explore completed. Existing general-purpose workers are reused with explicit roles; no additional specialist types are exposed. Root owns heavyweight execution/integration/lifecycle; regression author owns only new tests/support; projection author owns only new modules; independent reviewer owns no implementation. Tasks keep dual owners. Every prompt requires full current 2038-line context and three-comment inventory from current plan. Old inventories are historical. Required access and normal known-good wrapper are qualified.

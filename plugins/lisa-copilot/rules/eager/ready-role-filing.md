# Ready-Role Filing (load-bearing)

Filing a work item without the ready role is an **incomplete handoff** — build-intake scans the ready lane and nothing else, so the item is never picked up. A correct write plus a missing role still loses the work.

## Omitted means NOT ready — on every tracker

**An omitted `build_ready` is NOT build-ready on JIRA, GitHub, and Linear alike.** Ready is an explicit claim, never an accident of which tracker a project configured. This is a **breaking change** for GitHub and Linear callers, which previously treated omission as ready; `lisa-github-validate-issue` F4's compensating omitted → `true` normalization is removed with it.

## Every filing declares one of two things

- **`build_ready: true`** — complete enough to build; enters the ready lane for auto-pickup. Required for any complete defect found during other work, so it is claimable next cycle with no human flipping status.
- **`human_gate: "<why a human must judge this first>"`** — deliberately held outside the queue. The writer stamps a visible line plus `<!-- [lisa-human-gate] reason=<short-slug> -->` so the hold is auditable.

Filed, not ready, and no `human_gate` is the **incomplete handoff** case — writers reject it and name both ways to resolve it. `build_ready: false` with no reason is the same omission with a value attached. `build_ready` stays subordinate to `leaf-only-lifecycle`: a container is never build-ready and needs no gate.

## The named exception

`lisa-exploratory-qa` files findings not-ready **by design** — its findings are candidate defects whose product significance a human should judge. It is the named human-gate exception, not drift: it pairs `ready=false` with an explicit `human_gate` reason. The sibling `e2e-coverage-gaps` skills are the contrast (a missing test is not a product question, so they file build-ready).

`lisa-repair-intake` sweeps for open items that are neither in the ready role nor marked `[lisa-human-gate]`, and surfaces them rather than promoting them.

Full contract (the per-vendor before/after table, marker format, and recovery sweep): [reference/ready-role-filing.md](../reference/ready-role-filing.md).

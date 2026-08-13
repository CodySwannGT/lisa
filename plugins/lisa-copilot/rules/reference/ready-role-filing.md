# Ready-Role Filing

A work item that is filed but never given the ready role is an **incomplete handoff**. No other agent will ever pick it up: build-intake scans the ready lane and nothing else. The originating failure is small and entirely typical — an agent closed a ticket it could not reproduce, filed the real defect it found beside it, and left the new ticket sitting. The defect was correct, the write succeeded, and the work still died.

This rule makes the ready role an **explicit claim** at every filing site, and makes omission mean the same thing on every tracker.

## The one normalization

**An omitted `build_ready` means NOT build-ready — on JIRA, on GitHub, and on Linear alike.**

Before this rule the three writers disagreed, and the disagreement was invisible at the call site:

| Tracker | Omitted `build_ready` (before) | Omitted `build_ready` (now) |
|---|---|---|
| JIRA | project's default created status — **not ready** | unchanged — **not ready** |
| GitHub | `status:ready` applied — **ready** | **not ready** |
| Linear | created in the configured `ready` state — **ready** | **not ready** |

So the same vendor-neutral `lisa-tracker-write` call produced a different lifecycle outcome depending on which tracker a project had configured. That is a leak in the abstraction the shim exists to provide: switching trackers must not change behavior.

**This is a breaking change for GitHub and Linear callers.** Any caller that omitted `build_ready` and relied on implicit ready must now pass it explicitly. That is the point rather than a cost of it: the only paths affected are ones that were silently depending on a provider-specific default, which is exactly the class of bug this rule exists to eliminate. `lisa-github-validate-issue` F4's compensating normalization (omitted → `true`) is removed with it — a validator that re-introduces the old default would simply move the leak.

The safe direction is the implicit one. A ticket that reaches a build queue by accident is worse than one that waits, because the queue is what agents act on autonomously.

## Every filing declares one of two things

A writer accepts a filing only when it carries **one** of:

- **`build_ready: true`** — the item is complete enough to build and enters the ready lane for auto-pickup. This is the correct answer for a complete defect found during other work.
- **`human_gate: "<why a human must judge this first>"`** — the item is deliberately held outside the queue because a human product call is pending. The writer stamps a visible marker on the item so the hold is auditable rather than indistinguishable from an accident:

  ```text
  Held for a human product call: <reason>.
  <!-- [lisa-human-gate] reason=<short-slug> -->
  ```

Filed, not ready, and no `human_gate` is the **incomplete handoff** case: the writer rejects it and names the two ways to resolve it. `build_ready: false` without a `human_gate` reason is the same failure spelled differently — it is not a gate, it is an omission with a value attached.

`build_ready` remains strictly subordinate to `leaf-only-lifecycle`: a container is never build-ready regardless of what a caller passes, and a container needs no `human_gate` because its state rolls up from its children rather than being claimed.

## Complete defects found during other work are filed build-ready

Any defect discovered while doing something else, which is complete enough to build, is filed through `lisa-track` / `lisa-tracker-write` with **explicit `build_ready: true`**. It must be claimable by build-intake on the next cycle with no human flipping status. "Complete enough to build" is the `work-item-definition-of-ready` bar — reproduction, observed-versus-expected, and Gherkin acceptance criteria — not a placeholder to be fleshed out later.

The same explicitness applies in the other direction. A filing that is genuinely a human product call declares `human_gate`; it does not simply omit the flag and hope the tracker default is the merciful one.

## The named exception: `lisa-exploratory-qa`

`lisa-exploratory-qa` files its findings **not** build-ready by default, and that is **correct** — it is the named human-gate exception under this rule, not drift to be repaired.

Exploratory QA is a first-time-user experience pass. Its findings are *candidate* defects and usability observations whose product significance a human should judge; auto-readying them would push judgment work into the build queue, which is precisely the failure the gate model exists to prevent. Its `ready=false` is therefore paired with an explicit `human_gate` reason and stamped with `[lisa-human-gate]` — an explicit human-gate marker, never a bare omission.

The sibling `e2e-coverage-gaps` skills are the contrast: a missing automated test is not a product question, so they file `build_ready: true` by default.

Other legitimate human-gate filings follow the same shape — `lisa-learnings-audit` promotion/demotion tickets, `lisa-improve-harness` intervention proposals, automation-retirement proposals, and provisioning tickets for access a human must grant. Each declares its `human_gate` reason rather than relying on a default.

## This rule is enforced, not merely stated

The rule shipped as prose first, and prose did not hold. A conformance audit of the ~13 issues filed during the session that shipped it found **13 of 13 bypassed it**, with zero `lisa-track` / `lisa-tracker-write` invocations — eight of them filed *after* the rule merged, several by the agent that wrote it. Over the same window `Co-Authored-By` compliance was **50 of 50**, because a husky `commit-msg` hook enforces that one. The contrast is the whole argument: at the EAGER-RULE rung this rule did not bind even its own author, while the executable control was never once violated. `learnings-ladder` says machine-checkable knowledge belongs at EXECUTABLE-CONTROL, and this rule is machine-checkable.

The control is the PreToolUse Bash guard `block-direct-issue-create.sh`, shipped to every agent variant (Claude, Codex, Cursor, Copilot, agy, OpenCode) and to the host `scripts/lisa-hooks/` fallback. It refuses a direct tracker-creation command — `gh issue create`, `gh api` POST to an issues endpoint, `gh api graphql createIssue`, `linear issue create`, `jira issue create`, `acli … create`, and equivalent `curl` posts — when the command carries **no readiness declaration**.

What it checks is the artifact, not the caller. A Bash-level hook cannot observe call provenance: any provenance signal is settable by the very agent being governed, so a guard built on one would be theatre. So the guard asks whether the command about to run produces a correctly declared item — the configured build-ready role is applied, or a `[lisa-human-gate]` marker is present (inline, or in the `--body-file` the create is about to submit). That is precisely the machine-checkable content of this rule, and it lets the three writers through by construction, because they always stamp one.

Two ways out, both deliberate:

- **No tracker configured** — `.lisa.config.json` absent or carrying no `tracker`. There is no `lisa-tracker-write` to route through, so the guard stands down. This is the bootstrapping case, and it is *detected* rather than asserted: nobody has to remember an env var to bring up a new repo.
- **`LISA_ALLOW_DIRECT_ISSUE_CREATE`** in the ambient environment — the human operator's override, mirroring `LISA_ALLOW_INSTRUCTION_FILE_WRITE`. It is honored **only** from the environment the hook inherits and is refused outright when it appears as an inline assignment on the intercepted command. A tool-call shell is fresh each time and its exports never reach the hook, so the ambient variable can only have been set by a human before the session began. An escape the governed agent reaches by typing one more token in front of the command it was just refused is not an escape hatch; it is this rule's original failure with extra steps.

## Recovery

`lisa-repair-intake` sweeps for the failure this rule prevents: recently filed items that are open, not in the configured ready role, and carrying **no** `[lisa-human-gate]` marker. Each is an incomplete handoff — surfaced with its filing context so an operator can promote it or gate it deliberately. The sweep reports rather than guesses: it never silently promotes an item into the queue, because a filing whose readiness nobody declared is exactly the input the gate model says a human should see.

## Related

- **`leaf-only-lifecycle`** — the prohibition `build_ready` is always subordinate to. Containers are never build-ready.
- **`work-item-definition-of-ready`** — what "complete enough to build" means.
- **`tracked-work`** — the filing entry point (`lisa-track`) this rule governs the readiness of.
- **`factory-model`** — why the ready flip is a gate standing outside the factory rather than a field inside it.

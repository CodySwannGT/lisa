# Derived Branch Plan (load-bearing)

**Every applicable leaf work item shows the branch it will be built from and the branch its PR lands in, as a generated `Branch Plan` section — and that section is derived data, not a second authority.** The authority is `## Target Backend Environment` resolved forward through `.lisa.config.json` `deploy.branches`. A work item that displays branches nobody can trace back to that mapping, or a flow that reads the displayed branches instead of recomputing them, is a contract violation.

**One vendor-neutral contract, cited by** `lisa-jira-write-ticket`, `lisa-github-write-issue`, `lisa-linear-write-issue`, `lisa-jira-validate-ticket`, `lisa-github-validate-issue`, `lisa-linear-validate-issue`, and `lisa-implement` (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent per-vendor prose).

## Why derived, and not two branch fields

The operator need is real: reading a ticket should not require resolving a config file to learn where the work starts and where it lands. But Lisa already owns that fact. Adding independent literal branch fields would create **a second source of truth that can drift** — and the failure mode of that drift is not a cosmetic mismatch, it is code silently shipped to the wrong environment. So the branches are rendered for humans and recomputed for machines. The rendered branches are **never read as input** by any flow, at any phase — a surface that needs the base branch derives it again from the environment.

## The rendered section

Exactly three lines, identical across vendors (`h2. Branch Plan` in JIRA wiki markup, `## Branch Plan` in GitHub/Linear markdown):

```
Branch from: <branch>
PR into: <branch>
Derived from: Target Backend Environment <env> via .lisa.config.json deploy.branches
```

The third line is the **derivation provenance line**. It is what marks the section machine-authored: a `Branch Plan` without it is treated as hand-authored, and hand-authored branches are never obeyed.

`Branch from` and `PR into` name the **same branch by construction** — implementation checks the feature branch out of `origin/<base>` and targets the PR back into `<base>`. A plan naming two different branches is malformed and fails validation. (A fix that genuinely lands on one branch and must reach another travels as a linked follow-up work item with its own branch plan, never as a divergence inside one plan.)

## Derivation

1. Resolve the environment under the existing `Target Backend Environment` grammar (`config-resolution`, `pre-flight-autofill`) — human-confirmed wins, then validated `Inferred:`, then `Assumption:`.
2. Map that exact configured key forward through `deploy.branches`. The key must map uniquely and the mapped branch must exist on the remote.
3. Render both fields to that branch plus the provenance line.

A missing or **ambiguous** mapping, a key that is **not unique**, or a branch absent from the remote **stops** the flow — exactly as `lisa-implement` already stops. **Never default independently to `main`, to the remote default branch, or to any other branch** to keep a write from failing. The remote default is a legitimate input only through the `Assumption:` fallback the environment grammar already defines, and it must be recorded as such.

## Exemption

Work that declares no runtime behavior change — `runtime_behavior_change = false`, i.e. doc-only, config-only, and type-only items — carries **no `Target Backend Environment`**, therefore has nothing to derive from and **requires no branch plan**. Its **absence is correct**, not a missing section, and no gate may demand one. Containers (an Epic, or a Story/Spike still holding child work) are exempt for the same reason: they are not built directly.

The exemption is one-way. Exempt work that *carries* a branch plan fails validation — branches asserted for work that declared it has no runtime target are hand-authored by definition, which is the second-authority failure this rule exists to prevent.

## Conflict, legacy, and drift

- **Conflict** — a present plan that disagrees with the recomputed plan **fails**; the flow never silently picks a side. The remediation is always to correct the environment, never to edit the branches.
- **Legacy** — an item written before this rule has no plan. At claim time the implementing agent derives it, **writes the assumption onto the item as a comment**, and proceeds. Never a silent guess.
- **Drift** — config changed after the plan was rendered. Current config wins; the stale plan is re-rendered and never followed.

Full derivation table, gate S19 semantics, the claim-time arms, and the vendor rendering details: [reference/derived-branch-plan.md](../reference/derived-branch-plan.md).

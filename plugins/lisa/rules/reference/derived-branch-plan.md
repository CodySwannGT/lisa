# Derived Branch Plan — reference

The full body behind the `derived-branch-plan` eager head. It defines one vendor-neutral contract consumed by the three tracker writers (`lisa-jira-write-ticket`, `lisa-github-write-issue`, `lisa-linear-write-issue`), the three validators (`lisa-jira-validate-ticket`, `lisa-github-validate-issue`, `lisa-linear-validate-issue`) via gate **S19**, and `lisa-implement` at claim time. Each surface cites this slug rather than growing its own prose, exactly as the vendor arms cite `leaf-only-lifecycle` and `repo-scope-split`. One slug is what keeps a branch plan rejected on JIRA from being accepted on Linear.

## The problem this solves, and the one it must not create

An operator reading a work item cannot see which branch the work starts from or which branch the PR lands in. Both facts are knowable, but only by resolving `.lisa.config.json` — which is exactly the kind of engineering step the factory model says a non-technical operator standing at the gate should not have to take.

The obvious fix — add a "source branch" field and a "PR target" field to the ticket template — is wrong, and it is worth being explicit about why, because it will look like the simple answer every time someone revisits this. Those fields would be **a second source of truth** for a fact Lisa already derives authoritatively from `## Target Backend Environment` + `deploy.branches`. Two authorities do not stay equal. They drift the first time an environment is corrected on a ticket whose branch fields nobody updated, or the first time `deploy.branches` is remapped. And the consequence of that drift is not a stale label: it is an agent branching from, and merging into, the wrong environment's branch — shipping unreviewed code to production, or shipping a production fix into a staging branch where nobody sees it.

So the contract renders the branches **for humans** and recomputes them **for machines**. The rendered section is output. It is never input.

Precedence is therefore not a negotiation: whenever a rendered plan and the resolved environment disagree, **the environment wins** — the authority wins, in every phase, on every vendor, with no exception for a plan a human edited by hand. The only question a disagreement raises is whether to re-render silently (staleness) or stop for a human (a conflict with a confirmed environment or an open PR base). It is never "which branch did they mean?"

## The rendered section

| Vendor | Heading form |
|---|---|
| JIRA | `h2. Branch Plan` (ADF heading in live JIRA) |
| GitHub | `## Branch Plan` |
| Linear | `## Branch Plan` |

Body, identical on all three:

```
Branch from: <branch>
PR into: <branch>
Derived from: Target Backend Environment <env> via .lisa.config.json deploy.branches
```

### The derivation provenance line

The third line is load-bearing. It is the discriminator between a section this contract produced and one a human typed, and it is deliberately visible prose rather than an HTML comment — the same reason the `Target Backend Environment` grammar uses visible `Inferred:` / `Assumption:` annotations: JIRA's ADF has no comment node, so a marker that only exists in markdown cannot be a vendor-neutral discriminator.

A `Branch Plan` **without the provenance line is treated as hand-authored**, and hand-authored branches are never obeyed — they are compared against the recomputed plan and, on any disagreement, fail. A provenance line naming an `<env>` that is not an exact configured `deploy.branches` key is itself malformed and fails.

### One branch, two labels

`Branch from` and `PR into` always name the **same branch**. That is not a simplification, it is the invariant `lisa-implement` already implements: the feature branch is cut from `origin/<base>` and the PR targets `<base>`. Both labels exist because operators asked to see both questions answered, and because naming them separately gives the contract somewhere to say they are equal instead of leaving it implicit.

A plan whose two fields name **two different branches** is malformed and fails validation. The case that looks like a counter-example — a bug fixed on a non-integration environment branch that must also reach the integration branch — is handled the way `lisa-implement` already handles it: as a **linked forward cherry-pick follow-up item**, which is its own work item with its own single-branch plan. It is never a divergence inside one plan.

## Derivation algorithm

1. **Resolve the environment.** Use the existing grammar and precedence defined in `config-resolution` and `pre-flight-autofill`: a human-confirmed bare configured key or `Confirmed: <env>` wins; then a validated `Inferred: <env> — evidence: <title|body|reproduction|hostname>`; then `Assumption: <env> — remote default branch <branch>`, or the branch-only `Assumption: remote default branch <branch>` when the reverse-map is not unique. This rule adds no new resolution logic and no new aliases.
2. **Map forward.** Look the exact configured key up in `deploy.branches`. The key must resolve to exactly one branch.
3. **Prove the branch.** The mapped branch must exist on the remote.
4. **Render.** Both fields to that branch, plus the provenance line naming the `<env>` used.

### Stop conditions

| Condition | Behavior |
|---|---|
| No environment resolvable and the item is not exempt | Stop — the `Target Backend Environment` gate (S8) already owns this |
| Environment key absent from `deploy.branches` | Stop |
| Mapping ambiguous / not unique | Stop |
| Mapped branch missing on the remote | Stop |

**Never guess.** There is no fallback that quietly substitutes `main`, the remote default branch, or the branch of a sibling environment to keep a write from failing — a silent guess here is the exact failure this contract exists to prevent, and a stopped write is cheap next to a wrong-branch merge. The remote default branch enters only through the `Assumption:` form the environment grammar already defines, and only recorded as an assumption.

## The exemption is declared, never inferred from absence

`runtime_behavior_change` is what S8, S11, S14, and S19 all branch on, and it began life as a **caller-asserted validator input** — the three validators still list it under "Behavioral flags — caller asserts these". Nothing ever persisted it. But the live-item path says: fetch the item, *parse the body sections, derive the spec fields*, then run the gates — and this one field could not be derived from anything the writer had stored. So on re-validation the gate believed whatever the caller claimed about the item it was supposedly checking. `lisa-*-verify` could not produce a truthful verdict, and neither could a human auditor reading the item.

Absence could not stand in for the flag either, because absence is what the two opposite cases look like. An item with no `Target Backend Environment` is either correctly exempt or wrongly missing a required section, and nothing on the item told them apart.

So the flag is persisted, in the section it is already about. **`Target Backend Environment` is rendered on every leaf**, and its content carries the declaration:

| Content | `runtime_behavior_change` | Meaning |
|---|---|---|
| An exact configured `deploy.branches` key — bare, `Confirmed:`, `Inferred:`, or `Assumption:` per the environment grammar | `true` | applicable work, targeting that environment |
| `None — no runtime behavior change: doc-only` (or `config-only`, `type-only`) | `false` | exempt by declaration |
| `None — container: state rolls up from children` | `false` | an Epic/Project, or an item holding child work |
| The section is absent | **underivable** | a legacy item written before this contract |

The `None —` prefix is the machine discriminator; the words after it are for the human reading the item. It is deliberately **visible prose rather than an HTML comment**, for exactly the reason the provenance line is: JIRA's ADF has no comment node, so a marker that only exists in markdown cannot be a vendor-neutral discriminator.

**Persisted beats asserted.** On a live item the stored declaration is authoritative. A caller asserting a `runtime_behavior_change` that contradicts it does not override it — the disagreement fails S8, naming both values, because one of the two is wrong and silently preferring either is how an unauditable gate gets built. On a *proposed* spec nothing is persisted yet, so the caller's assertion is the input and the writer's job is to render it.

**Underivable is its own verdict, never `false`.** A legacy item with no section gets `N/A` plus a repair note from every flag-dependent gate, repaired at claim time beside the legacy branch-plan repair — the same asymmetry, for the same reason. What must never happen is reading absence as `false`, which is the silent assumption that made S8, S11, S14, and S19 undecidable on a live item in the first place.

### How strongly this binds

Stated plainly, because the session that produced this contract exists to make exactly this distinction and it would be dishonest to blur it here.

This is **not** an executable control. `ready-role-filing`'s sibling guard is a hook that exits 2 and physically refuses a tool call; nothing here refuses anything. What enforces this contract is a validator agent reading `SKILL.md` and choosing to apply it — the same rung of the ladder that failed to bind 13 filings out of 13.

What the regression suite adds is narrower than enforcement and worth naming precisely: it pins the **wording** across all six generated skill roots, so the contract cannot be silently deleted, softened, or lost in a regeneration. It cannot catch a validator that documents the rule and then ignores it at runtime.

That is the ceiling for now rather than a shortcut, because `SKILL.md` *is* the validators' execution substrate — there is no compiled artifact underneath to attach a hook to. The honest summary is: absence-as-`false` was undecidable and is now *decidable*, which is a real improvement and a strictly weaker claim than *enforced*. Treat a gate verdict resting on this contract as evidence, not proof, until a deterministic checker exists to read the declaration off a live item.

This costs nothing in derivation difficulty. A single-environment project — Lisa itself is one, `deploy.branches: { production: main }` — recomputes every applicable item to the same branch. The gate was never hard to satisfy; it was impossible to *audit*, and those are different problems with different fixes. Weakening S19 would have fixed neither.

## Gate S19 — Branch Plan derivation

Registered in all three validators as `| S19 Branch Plan derivation | technical | false |`. The gate **recomputes** the plan from current config and compares; it never reads the rendered branches as input.

| Case | Verdict |
|---|---|
| Exempt work (`runtime_behavior_change = false`, or a container) with no plan | `N/A` |
| Exempt work **carrying** a plan | **FAIL** — hand-authored branches on work that declared no runtime target |
| `runtime_behavior_change` **underivable** (live legacy item, no Target Backend Environment declaration) | `N/A` with a repair note — absence is never read as `false` |
| Applicable work, plan present, matches recomputed plan | PASS |
| Applicable work, plan present, disagrees with recomputed plan | **FAIL** |
| Applicable work, plan present, missing the provenance line and disagreeing | **FAIL** (hand-authored) |
| Applicable work, two fields naming different branches | **FAIL** — malformed |
| Applicable work, derivation hits a stop condition | **FAIL** — same stop as implement |
| Applicable work, **proposed spec** (pre-write) with no plan | **FAIL** — the writer must render it before the write |
| Applicable work, **live legacy item** with no plan | `N/A` with a repair note routed to claim time |

The last two rows are the asymmetry that matters. Failing a *proposed* spec is free — the writer just renders the section. Failing every *existing* item would turn a whole legacy queue red overnight for a section no human ever had a way to add, so those are repaired at claim time instead, where the derivation is written onto the item as evidence.

### Failure remediation

Every S19 failure names both plans (rendered and recomputed) and points the fix at **the environment, never the branches**:

> Branch Plan conflicts with the environment mapping. Rendered `Branch from: release/staging`; recomputed from `Target Backend Environment: production` via `deploy.branches` → `main`. Correct the environment, not the branch — the branches are derived. Then re-render.

The gate never silently chooses between the two. Picking one would be a guess wearing a verdict.

## Claim-time behavior (`lisa-implement`)

At claim time the plan is recomputed against **current config and the remote** — never trusted from the item — and one of four arms runs:

- **Match** — proceed. The already-existing base-branch validation, feature-branch sync, and `target_branch=<base>` handoff are unchanged.
- **Legacy (no plan)** — derive it, **write the assumption onto the item as a comment**, then proceed. The comment carries a visible prose line plus a dedupe marker so a re-claim produces no duplicate:

  ```
  Branch plan derived for this item: branch from `main`, PR into `main` (Target Backend
  Environment: production via .lisa.config.json deploy.branches).
  <!-- [lisa-branch-plan] key=<work-item-ref>::<branch> -->
  ```

  Marker-dedupe is on `<work-item-ref>::<branch>`, so the comment reappears only if the derived branch actually changes. Where a vendor cannot host an HTML comment, the visible line alone carries it. If the comment cannot be written, that is a stop, not a shrug — proceeding would make it exactly the silent guess this rule forbids.
- **Conflict with a human-confirmed environment, or with an existing open PR's base** — **stop under the existing confirmation rules**. `lisa-implement` already surfaces a PR-base mismatch and re-targets only with confirmation, on the stated grounds that the ticket's environment is the source of truth; a branch plan never overrides that, and never supplies the confirmation itself.
- **Stale (config changed since the plan was rendered)** — **current config wins**. Re-render the section onto the item, record the change, and never follow the stale plan. A stale plan is not a conflict to escalate; it is output that fell behind its input.

## Why the gate is `technical` / not product-relevant

S19 is categorized `technical`, `product_relevant: false`, matching S8 — the fact it checks is a deployment-topology fact, and a PRD-intake comment aimed at a product author cannot act on it. The operator-facing value of the section is that it is *visible on the item*, not that its failures are routed to product.

## What this rule deliberately does not do

- It defines **no new environment resolution**, no new aliases, and no new provenance grammar. All of that stays in `config-resolution` / `pre-flight-autofill`, and this rule reads the result.
- It does **not** let a branch plan influence which environment is chosen, in any direction, at any phase.
- It does **not** introduce branch fields on PRDs. PRDs are not built directly; their generated leaves carry the plan.

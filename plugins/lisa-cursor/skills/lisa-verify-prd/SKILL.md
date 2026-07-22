---
name: lisa-verify-prd
description: "Initiative-level PRD acceptance gate. Given a PRD ref/URL (GitHub, Linear, Notion, Confluence, or JIRA), resolves the source vendor, reads the PRD and its generated top-level child work via the prd-lifecycle-rollup contract, and confirms every required child is terminal before any verification runs — if any is non-terminal it reports the incomplete set and STOPS. When the guard passes it runs spec-conformance against the original PRD requirements plus empirical verification via verification-lifecycle. On CONFORMS with all checks passing: transitions the PRD shipped → verified and posts evidence. On PARTIAL/DIVERGES or any failing check: re-opens the PRD shipped → ticketed (NEVER blocked), creates build-ready fix tickets for each divergence, and posts a product-readable failure report — the fix tickets auto-build, rollup re-ships the PRD, and a later intake cycle re-verifies, so the loop closes itself. Idempotent re-runs: comments regenerate in place via sentinel markers; fix tickets dedupe by stable ref."
allowed-tools: ["Skill", "Bash", "Read", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-get-comments", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluencePageDescendants", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# PRD-level Verification: $ARGUMENTS

`/lisa:verify-prd <prd>` is the **initiative-level acceptance gate**. It runs *after* a PRD is `shipped` (all generated top-level work terminal, per `prd-lifecycle-rollup`'s rollup phase) and proves the shipped product actually matches the PRD — not merely that every ticket is closed. `shipped` is **necessary but not sufficient** for `verified`: a PRD can have every child ticket closed while still missing a requirement, diverging from its acceptance criteria, or failing a real user workflow.

This is distinct from `/lisa:verify`, which empirically verifies a **single work item** (a ticket / story / sub-task) in its target environment as part of that item's Build/Fix/Improve flow. `/lisa:verify` drives a build ticket to `done` at the leaf/build level; it does not read the PRD or judge initiative-level acceptance. `/lisa:verify-prd` operates one level up, over the whole initiative. See the `prd-lifecycle-rollup` rule's "PRD-level verification vs ticket verification" section for the full distinction.

`$ARGUMENTS` is a single PRD reference: a **GitHub issue URL** (or `<org>/<repo>#<n>`), a **Linear project/issue URL**, a **Notion page URL**, a **Confluence page URL**, or a **JIRA issue key/URL**.

## Confirmation policy

Do **not** re-prompt once invoked. Like the `*-prd-intake` skills, the caller has already authorized the run by invoking the skill; asking the user to confirm before reading or before applying the guard defeats the purpose of a batchable acceptance gate. Run the front-half (resolve → read child set → guard) to completion and report.

## Scope of this skill

This skill covers the **read/guard front-half**, **both verdict branches** (PASS and FAIL), and the **idempotency** of PRD-level verification:

1. Resolve the PRD ref and detect its source vendor.
2. Read the PRD body and its **generated top-level child work set** via the `prd-lifecycle-rollup` contract.
3. Apply the per-vendor terminal predicate to the generated top-level work and run the **terminal-child guard**: if any required top-level child is non-terminal, report the incomplete set and STOP — do not run verification, do not transition the PRD.
4. **Spec conformance** — when the guard passes, invoke the `spec-conformance` skill with the PRD as the spec source to build a section-by-section coverage matrix against the shipped product (never reimplementing the matrix).
5. **Empirical verification** — invoke `verification-lifecycle` to run empirical checks appropriate to the PRD's surface (browser/computer-use, API, CLI, DB, screenshots, logs), honoring the `verification` rule. Quality gates (test/typecheck/lint) are **not** verification.
6. **PASS transition + evidence** — when spec conformance is `CONFORMS` **and** every applicable empirical check passes, transition the PRD lifecycle from the resolved `shipped` role to the resolved `verified` role (vendor-neutral via `config-resolution`) and post verification evidence (the coverage matrix + empirical proof artifacts) back on the PRD.
7. **FAIL — re-open as `ticketed` + build-ready fix tickets (self-healing, never `blocked`)** — when spec conformance is `PARTIAL`/`DIVERGES`, or any applicable empirical check fails (or a required surface is unavailable), move the PRD from the resolved `shipped` role back to the resolved `ticketed` role, create **build-ready fix tickets** via `tracker-write` (`build_ready: true`) for each missing/incorrect/divergent behavior — **added to the PRD's generated top-level work** — and post a product-readable failure report (with the verification-round count). PRD verification **never** moves the PRD to `blocked`. The fix tickets auto-build, rollup (`*-prd-intake` Phase 3f) re-ships the PRD once they are terminal, and a later intake cycle (Phase 3g) re-verifies — the loop closes itself.
8. **Idempotency** — every write in Phases 6 and 7 is safe to re-run: evidence/failure-report comments carry a stable sentinel marker and are **regenerated in place** (never appended), fix tickets are deduped by a stable PRD-ref + requirement marker (**referenced/updated, never duplicated**), and the lifecycle transition is a **no-op when the PRD already carries the target role** (exactly one lifecycle label/status remains). See **Phase 8 — Idempotency** for the per-write guards.

When verification passes, this skill runs the **PASS** branch of Phase 6 (`shipped → verified`). When it does not pass — spec conformance not `CONFORMS`, or any empirical check failing — this skill runs the **FAIL** branch of Phase 7 (`shipped → ticketed` + build-ready fix tickets + failure report); it does **not** leave the PRD at `shipped` and **never** uses `blocked` (PRD verification is self-healing — the fix tickets auto-build and the PRD re-ships and re-verifies). Re-running the skill against the same PRD produces no duplicate evidence comments, no duplicate fix tickets, and no duplicate lifecycle labels/statuses — the **Phase 8** guards make each Phase 6/7 write idempotent, exactly as `prd-backlink` regenerates its `## Tickets` section in place and `github-prd-intake` no-ops a rollup on an already-shipped PRD.

## Phase 1 — Resolve the PRD ref and detect the source vendor

Detect the vendor from `$ARGUMENTS` the same way `prd-ticket-coverage` / `prd-backlink` do — from the host (or key shape for JIRA), never by guessing:

| Input shape | Vendor | Read surface |
|---|---|---|
| `github.com/<org>/<repo>/issues/<n>` or `<org>/<repo>#<n>` | **GitHub Issues** | `gh` CLI (Lisa uses the CLI exclusively for GitHub — no GitHub MCP) |
| `linear.app/...` | **Linear** | `lisa-linear-access operation: get-project` / `lisa-linear-access operation: get-issue` |
| `notion.so` / `notion.site` | **Notion** | `mcp__claude_ai_Notion__notion-fetch` (`include_discussions: true`) |
| `*.atlassian.net/wiki/...` | **Confluence** | `mcp__atlassian__getConfluencePage` (+ descendants) |
| JIRA issue key (e.g. `PROJ-123`) or `*.atlassian.net/browse/...` | **JIRA** | `mcp__atlassian__getJiraIssue` |

Read the PRD body via the vendor-appropriate surface. The vendor that owns the PRD source is what Phase 2 reads the child set from; it is independent of which tracker hosts the generated tickets (a Notion PRD can own JIRA tickets — the cross-vendor case is handled by the documented generated-work section in Phase 2).

Where the PRD lives in the same vendor as the configured `tracker` (`.lisa.config.json`), prefer reading the PRD ticket through `lisa-tracker-read` so this skill stays agnostic of which tracker hosts the work — `tracker-read` dispatches to `lisa-github-read-issue` / `lisa-jira-read-ticket` / `lisa-linear-read-issue` per config and returns the consolidated context bundle (PRD body, native children, links). For PRD sources with no tracker counterpart (Notion / Confluence / cross-vendor), read the PRD body directly via the vendor surface above.

## Phase 2 — Read the generated top-level child work set

**Do NOT reimplement child enumeration.** Consume the PRD→generated-top-level-work relationship recorded by the merged child-linking work (`prd-backlink` native linking + its always-written machine-readable generated-work section), exactly as `github-prd-intake`'s rollup phase consumes it. Read the **generated top-level work** only — the PRD's created Epics and any top-level Story created directly under it — and **exclude** leaf Sub-tasks and any Story nested under a generated Epic, per the `prd-lifecycle-rollup` rule's generated-top-level-work contract.

Use two sources, **native first**, deduped by child-ref identity:

1. **Native hierarchy (primary).** Read the PRD's direct native children — these are its top-level children:
   - **GitHub** — the PRD issue's direct `subIssues` nodes (the GraphQL `subIssues` query `lisa-github-read-issue` Phase 3 uses; capture `number title state url stateReason labels`).
   - **Linear** — for a PRD Project, its member Issues (`list_issues({project})`); for a PRD Issue, its sub-Issues (`get_issue` children). Capture each child's `state` (workflow state + category).
   - **JIRA** — the PRD's children via the epic-link/parent JQL `lisa-jira-read-ticket` Phase 5 uses (`"Epic Link" = <PRD-KEY>` or `parent = <PRD-KEY>`). Capture each child's `statusCategory`.
   - **Notion / Confluence** — no native issue hierarchy; use the documented section below.

2. **Documented generated-work section (fallback / cross-vendor).** When native hierarchy is unavailable (older host, cross-vendor PRD→tracker, or the relationship was only recorded in the PRD body), parse the machine-readable generated-work section `prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`). Enumerate the `<!-- lisa:gw ref=… url=… type=… parent=… -->` tokens; the **generated top-level child set is every token whose `parent` is empty** (top-level), exactly as `prd-backlink` documents. Tokens with a non-empty `parent` are descendants — skip them. For GitHub, this is the same `awk` extraction `github-prd-intake` Phase 3f.2 uses.

**Dedupe by child-ref identity** (`owner/repo#number` for GitHub, the issue/project identifier for Linear, the issue key for JIRA, the recorded ref for Notion/Confluence — the `prd-lifecycle-rollup` idempotency dedupe key) so a child appearing in both the native graph and the documented section is counted once. **Match by stable ref, never by title.**

If neither source yields any generated top-level child (the PRD generated nothing, or the relationship was never recorded), report `no generated top-level children — cannot verify an empty PRD` and STOP. Do not transition the PRD.

## Phase 3 — Terminal-child guard

Apply the **per-vendor terminal-state predicate from the `prd-lifecycle-rollup` rule** to every generated **top-level** work item (cite the rule by slug — do not restate its predicate table here). In summary, a top-level child is:

- **Terminal** — it has reached its source/tracker's done/shipped state (GitHub: closed + the resolved build `done` role label where used; Linear: a `done`-category completed state; JIRA: `statusCategory.key == "done"`; Notion/Confluence: the documented generated-work entry marked done). A generated Epic is terminal only when *it* has rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own resolved state; do not re-derive it from its leaves.
- **Terminal-but-dropped** — closed-as-not-planned (GitHub `stateReason == "not_planned"`) / canceled or duplicate (Linear — both are terminal `state.type`s; `duplicate` is distinct from `canceled`) / won't-do. It does **not** hold the PRD open and is excluded from the required set.
- **Incomplete / blocked** — anything else (still open, or closed without the `done` role). It holds the PRD open.

The **required** set is the top-level children minus the terminal-but-dropped ones. Branch:

**Any required top-level child is non-terminal** (the "Given a PRD has generated child work that is not terminal" scenario):

1. **STOP.** Do **not** run empirical verification or spec-conformance.
2. **Leave the PRD lifecycle untouched** — it stays at `shipped`. Do not transition it to `verified` or `blocked`; do not close or archive it.
3. **Report the incomplete child set** — list each non-terminal required top-level child as `- <ref> "<title>" — <state>`, so product can see exactly what is blocking PRD-level verification.

This guard exists because PRD-level acceptance is only meaningful once the work graph is actually complete. `shipped` is the precondition; verifying a PRD whose generated work is still in flight would produce a false PASS or FAIL against an incomplete product.

**All required top-level children are terminal** (at least one required child exists): the guard passes. Proceed to **Phase 4 — Spec conformance** and the rest of the PASS path below. The guard is the precondition for verification; only once the work graph is complete is it meaningful to check the shipped product against the PRD.

## Phase 4 — Spec conformance against the PRD

The guard proves the work graph is *complete*; spec conformance proves the shipped product matches *what the PRD asked for*, section by section. This is the "accountant lens" — did the initiative ship exactly the PRD's requirements, nothing silently dropped, nothing scope-crept?

**Do NOT reimplement the coverage matrix.** Invoke the existing `spec-conformance` skill with the PRD as the spec source:

```text
/spec-conformance <PRD ref/URL>
```

Pass the same `$ARGUMENTS` PRD reference resolved in Phase 1. `spec-conformance` Phase 1 already accepts a GitHub issue URL / Linear identifier / JIRA key / Notion / Confluence PRD as its spec source and loads the full PRD body (via `tracker-read` or the vendor surface), so the PRD is the spec here — not a plan file or a leaf ticket. It then:

- extracts every PRD requirement into a structured list (acceptance criteria, Out of Scope, technical commitments, Validation Journey assertions, deliverables);
- inspects the shipped product (the merged work across the generated top-level children) for evidence of each;
- builds a **section-by-section coverage matrix** mapping each requirement to evidence;
- flags scope creep (Out-of-Scope violations) and untraceable changes separately from misses;
- returns a verdict: **`CONFORMS`**, **`PARTIAL`**, or **`DIVERGES`**.

Capture the coverage matrix and verdict verbatim — both feed the evidence comment in Phase 6 and gate the PASS branch.

Spec conformance at the PRD level differs from the leaf-ticket conformance run during a single item's Build/Fix/Improve flow: the spec is the **PRD itself** (the whole initiative's requirements), and the shipped work is the **union** of all generated top-level children, not one branch's diff. The `spec-conformance` skill handles both because its spec source is parameterized; this skill simply hands it the PRD.

**Branch on the verdict:**

- **`CONFORMS`** — continue to Phase 5 (empirical verification).
- **`PARTIAL` or `DIVERGES`** — verification has **not** passed. Do **not** run Phase 5 (empirical verification adds nothing once the spec already diverges) and do **not** enter the PASS path. Record the verdict and the matrix, then go to **Phase 7 — FAIL** with a `CONFORMANCE_FAILED` cause: the failed/missing/scope-crept requirements the matrix flagged become the failure report's findings and the seeds for the linked fix issues.

## Phase 5 — Empirical verification of the shipped surface

Spec conformance reads the diff and the requirements; empirical verification **runs the actual shipped system and observes results**. Quality gates (tests, typecheck, lint) are prerequisites, **not** verification — a green test suite never substitutes for exercising the shipped product (see the `verification` rule).

**The verification surface is PRD-dependent.** A PRD that shipped a UI flow is verified through the browser; one that shipped an API through request/response captures; a CLI through command runs; a schema change through database queries; a background job through logs and queue inspection. Do not assume a fixed surface — classify it from what the PRD actually delivered.

**Do NOT reinvent the verification machinery.** Invoke the `verification-lifecycle` skill and follow its mandatory sequence (confirm quality gates → classify empirical types → check tooling → fail-fast → plan → execute → codify → loop) against the *shipped initiative*:

```text
/verification-lifecycle
```

1. **Classify** the empirical verification types that apply to the PRD's shipped surface, per the Verification Types table in the `verification` rule.
2. **Discover tooling** for each type (browser/computer-use MCP, HTTP client, DB client, CLI, log/metrics access) via the lifecycle's Tool Discovery Process. For a UI surface, reuse the `product-walkthrough` skill to drive the live product through a real browser and ground verification (and the eventual evidence comment) in what actually renders.
3. **Plan** each check: the exact tool/command, the expected pass outcome, and any prerequisites (running service, seeded data, auth). A plan that lists only `test`/`typecheck`/`lint` is not a verification plan.
4. **Execute** each check and collect **proof artifacts** (screenshots, request/response captures, query outputs, log excerpts with correlation IDs) per the lifecycle's Proof Artifacts Requirements.
5. **Codify** — for each passing empirical verification, the lifecycle invokes `codify-verification` to encode it as a regression test (Playwright for UI, integration test for API/DB, benchmark for performance) so the PRD's behavior cannot silently regress. Honor that step; it is mandatory for every empirical type except the inherently non-behavioral set the lifecycle exempts.

If a required surface or its tooling is unavailable, follow the lifecycle's Escalation Protocol — declare the verification level (PARTIALLY VERIFIED / UNVERIFIED) and surface the gap rather than declaring a false PASS.

**Branch on the result:**

- **Every applicable empirical check passes** (and is codified where the lifecycle requires) — continue to Phase 6 (PASS).
- **Any applicable empirical check fails, or a required surface is unavailable** — verification has **not** passed. Record what failed/was-blocked (the check, the tool/command, observed vs expected, and any proof artifacts captured), then go to **Phase 7 — FAIL** with an `EMPIRICAL_FAILED` cause: each failed check (or unavailable required surface) becomes a failure-report finding and a seed for a linked fix issue.

> **Single-environment note.** In a single-environment project (`main`/production only, no dev/staging), the shipped surface is whatever production exposes. A project with no deployed application, sign-in, or end-to-end environment variables (Lisa itself) verifies on its CLI/dry-run surface — running the documentation/skill build and drift check — which is the empirical surface the PRD's Validation Journey declares. The surface is always PRD-dependent: read the PRD's Empirical Verification Plan and verify what it says ships.

## Phase 6 — PASS: transition `shipped → verified` and post evidence

Reach this phase **only** when **both** are true:

- Phase 4 spec conformance returned **`CONFORMS`**, and
- Phase 5 every applicable empirical check **passed** (and was codified where required).

If either is false, do not enter this phase — record the verdict and route to **Phase 7 — FAIL**, which owns the `shipped → ticketed` (re-open + build-ready fix tickets) path.

### 6.1 — Resolve the `verified` and `shipped` roles

Resolve the PRD-lifecycle roles from `.lisa.config.json` (then `.lisa.config.local.json` override) per the `config-resolution` rule — the same role-resolution the `*-prd-intake` skills use. **Cite `config-resolution` for the role vocabulary; do not hardcode label strings except as the documented defaults.** Resolution per vendor:

| Vendor | `shipped` role | `verified` role | Default `verified` |
|---|---|---|---|
| **GitHub** | `github.labels.prd.shipped` | `github.labels.prd.verified` | `prd-verified` (label) |
| **Linear** | `linear.labels.prd.shipped` | `linear.labels.prd.verified` | `prd-verified` (project/issue label) |
| **Notion** | `notion.values.shipped` | `notion.values.verified` | `Verified` (status value) |
| **Confluence** | `confluence.parents.shipped` | `confluence.parents.verified` | the `Verified` parent page id |
| **JIRA** | the configured shipped status | the configured verified status | per `config-resolution` |

For GitHub, resolve with the same helper `github-prd-intake` uses:

```bash
read_role() {  # role default → resolved value (local override wins)
  local role="$1" default="$2" local_v global_v
  local_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
SHIPPED=$(read_role shipped  prd-shipped)
VERIFIED=$(read_role verified prd-verified)
```

### 6.2 — Transition the PRD `shipped → verified`

**Idempotency guard (no-op if already verified).** Before transitioning, read the PRD's current lifecycle role. If the PRD **already carries `$VERIFIED`**, the transition is a **no-op** — do not re-add the label/status, do not re-remove `$SHIPPED` (already gone). Record it as `already verified (no-op)` and proceed to 6.3 (the evidence comment is still refreshed in place, per Phase 8). This mirrors `github-prd-intake` Phase 3f.1's "no-op if already shipped" guard and the `prd-lifecycle-rollup` "rollup is keyed by the PRD's current state" rule (cite both by slug).

Otherwise apply the vendor-appropriate transition. This is the `shipped → verified` PASS hop the `prd-lifecycle-rollup` rule defines (cite it by slug; this skill is its PASS-path implementation, not a second source of truth):

- **GitHub / Linear** — remove the `shipped` label and add the `verified` label. For GitHub:
  ```bash
  gh issue edit <prd-num> --repo <org>/<repo> --remove-label "$SHIPPED" --add-label "$VERIFIED"
  ```
  Verify exactly **one** PRD-lifecycle label remains afterward (the single-label invariant `github-prd-intake` enforces) — a re-run must never leave both `$SHIPPED` and `$VERIFIED`, nor two copies of `$VERIFIED`. For GitHub, close the PRD issue immediately after the label transition with `gh issue close <prd-num> --repo <org>/<repo> --reason completed`; if it is already closed, record that native closure was already satisfied. For Linear, set the project/issue label equivalently, then archive/complete the project or issue using the vendor's native terminal mechanism where available.
- **Notion** — set the PRD page's `notion.statusProperty` (default `Status`) to the resolved `verified` value (default `Verified`). A status property holds exactly one value, so re-setting the same value is inherently a no-op. Then archive the page through `lisa-notion-access` where supported; if the page is already archived, record that native archival was already satisfied.
- **Confluence** — move the PRD page's `parentId` to `confluence.parents.verified` (the parent-page-based lifecycle; Atlassian scoped tokens cannot write labels — see `config-resolution`). A page has exactly one parent, so re-parenting to the same parent is a no-op. Then archive the page where the deployment supports archival; if archival is unavailable, report the capability-aware no-op or setup gap.
- **JIRA** — transition the PRD issue to the configured `verified` status. An issue holds exactly one status; if already `verified`, skip the transition. Then resolve/close the issue using the configured terminal workflow transition where supported.

`verified` is the terminal, product-owned PRD state; this skill is the **only** automated writer of it (intake/rollup never set it). After the verified transition, close, archive, or complete the PRD natively where the source vendor supports it. This close-out is mandatory and idempotent; do not introduce a configuration flag to skip it.

### 6.3 — Post verification evidence on the PRD

Post a verification-evidence comment back on the PRD, in the spirit of `tracker-evidence` (the vendor-neutral evidence poster). Because the evidence lands on the **PRD source** — which may be Notion or Confluence, not a tracker ticket — post via the vendor surface that owns the PRD: `gh issue comment` for GitHub, the Linear comment API, the Notion/Confluence page comment surface, or a JIRA comment. Where the PRD lives in the configured `tracker`, you may dispatch through `tracker-evidence`; for Notion/Confluence/cross-vendor PRDs, comment on the PRD page directly.

**Idempotent — regenerate the evidence comment in place, never append.** Lead the comment body with the stable sentinel marker `<!-- lisa:verify-prd-evidence -->`. Before posting, look up an existing evidence comment authored by this skill on the PRD whose body contains that sentinel (the same regenerate-don't-append discipline `prd-backlink` uses for its `## Tickets` section; **match by the marker, never by comment text or position**). If one exists, **edit it in place** with the freshly regenerated body; only create a new comment when none exists. Per vendor:

- **GitHub** — `gh issue view <prd-num> --repo <org>/<repo> --json comments` and select the comment whose `body` contains `<!-- lisa:verify-prd-evidence -->`; update it with `gh api -X PATCH /repos/<org>/<repo>/issues/comments/<comment-id> -f body=@evidence.md`. Only `gh issue comment <prd-num> --body-file evidence.md` when no marked comment exists.
- **Linear** — find the existing comment carrying the sentinel and update it via the Linear comment-update API; create only if absent.
- **Notion / Confluence** — update the existing marked page comment in place; create only if absent.
- **JIRA** — update the existing marked comment in place; create only if absent.

The marked comment is the single canonical evidence comment for the PRD — a re-run refreshes it, never stacking a second one. The evidence comment MUST include:

1. **Sentinel marker** — the literal `<!-- lisa:verify-prd-evidence -->` as the first line, so the next run finds and regenerates this exact comment.
2. **AI disclosure** — lead with "PRD-level verification by Claude (AI agent, not a human)."
3. **Verdict line** — `shipped → verified — PASS`.
4. **Spec-conformance coverage matrix** — the section-by-section matrix from Phase 4 verbatim, with the `CONFORMS` verdict.
5. **Empirical proof artifacts** — the Phase 5 artifacts per surface: screenshots (upload via `gh release upload pr-assets <files> --clobber` and reference as plain URLs, per the `tracker-evidence` UI Evidence Checklist), request/response captures, query outputs, log excerpts, and the codified regression test(s) added.
6. **What was verified** — which PRD acceptance criteria each artifact covers, and the verification surface used.

Then emit the PASS output block (below).

## Phase 7 — FAIL: re-open as `ticketed`, create build-ready fix tickets, post a failure report (never `blocked`)

Reach this phase when verification did **not** pass — i.e. **either** is true:

- Phase 4 spec conformance returned **`PARTIAL`** or **`DIVERGES`** (`CONFORMANCE_FAILED` cause), or
- Phase 5 had **any** applicable empirical check fail or a required surface unavailable (`EMPIRICAL_FAILED` cause).

PRD verification failure is **self-healing, not a dead end**. Instead of parking the PRD in `blocked` for a human, this phase: (1) moves the PRD back to `ticketed` (work in flight again), (2) creates **build-ready fix tickets** for the gaps so the build queue picks them up with no human promotion, and (3) posts a failure report. The fix tickets are added to the PRD's generated top-level work, so the existing machinery closes the loop on its own: the fix tickets build → reach terminal → the `*-prd-intake` rollup (Phase 3f) re-ships the PRD `ticketed → shipped` → the next intake cycle (Phase 3g) re-dispatches `/lisa:verify-prd` → PASS gives `verified`, FAIL runs this phase again with another round of fix tickets. This is the FAIL counterpart of the Phase 6 PASS hop and is the `shipped → ticketed` FAIL hop the `prd-lifecycle-rollup` rule's "Closing the loop" section defines (cite it by slug; this skill is its FAIL-path implementation, not a second source of truth).

**PRD verification never moves the PRD to `blocked`.** `blocked` is the *intake* (ready-stage validation) failure state, not the verification failure state — there is no `prd-verifying` / `prd-verification-failed` state either; the lifecycle stays small. The loop never auto-halts; the failure report carries a **verification-round count** so a human can spot a PRD stuck across repeated rounds, but the skill keeps creating fix tickets and re-verifying.

Carry forward the verdict cause and the concrete **findings** that produced it: from `CONFORMANCE_FAILED`, the matrix's missed/divergent/scope-crept requirements; from `EMPIRICAL_FAILED`, each failing check (the requirement/AC it exercised, the tool/command, observed vs expected, and any captured artifacts). These findings drive both the failure report (7.3) and the fix issues (7.4).

### 7.1 — Resolve the `shipped` and `ticketed` roles

Resolve the PRD-lifecycle roles from `.lisa.config.json` (then `.lisa.config.local.json` override) per the `config-resolution` rule — the same role-resolution Phase 6.1 and the `*-prd-intake` skills use. **Cite `config-resolution` for the role vocabulary; do not hardcode label strings except as the documented defaults.** Resolution per vendor:

| Vendor | `shipped` role | `ticketed` role | Default `ticketed` |
|---|---|---|---|
| **GitHub** | `github.labels.prd.shipped` | `github.labels.prd.ticketed` | `prd-ticketed` (label) |
| **Linear** | `linear.labels.prd.shipped` | `linear.labels.prd.ticketed` | `prd-ticketed` (project/issue label) |
| **Notion** | `notion.values.shipped` | `notion.values.ticketed` | `Ticketed` (status value) |
| **Confluence** | `confluence.parents.shipped` | `confluence.parents.ticketed` | the `Ticketed` parent page id |
| **JIRA** | the configured shipped status | the configured ticketed status | per `config-resolution` |

For GitHub, resolve with the same helper Phase 6.1 / `github-prd-intake` use:

```bash
read_role() {  # role default → resolved value (local override wins)
  local role="$1" default="$2" local_v global_v
  local_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
SHIPPED=$(read_role shipped prd-shipped)
TICKETED=$(read_role ticketed prd-ticketed)
```

### 7.2 — Re-open the PRD `shipped → ticketed`

**Idempotency guard (no-op if already ticketed).** Before transitioning, read the PRD's current lifecycle role. If the PRD **already carries `$TICKETED`** (the common re-run case — a prior failed round already re-opened it and its fix tickets are still in flight), the transition is a **no-op** — do not re-add the label/status, do not re-remove `$SHIPPED` (already gone). Record it as `already ticketed (no-op)` and proceed to 7.3, where the existing failure report is **updated in place** (not stacked, round count incremented) and 7.4, where existing fix tickets are **referenced** rather than re-created. This mirrors `github-prd-intake` Phase 3f.1's "no-op if already shipped" guard and the `prd-lifecycle-rollup` "rollup is keyed by the PRD's current state" rule (cite both by slug).

Otherwise apply the vendor-appropriate transition. This is the `shipped → ticketed` FAIL hop from the `prd-lifecycle-rollup` rule's "Closing the loop" section (cite it by slug) — a deliberate backward hop that puts the PRD back into "work in flight" so its new fix tickets are the in-flight work the rollup waits on:

- **GitHub / Linear** — remove the `shipped` label and add the `ticketed` label. For GitHub:
  ```bash
  gh issue edit <prd-num> --repo <org>/<repo> --remove-label "$SHIPPED" --add-label "$TICKETED"
  ```
  Verify exactly **one** PRD-lifecycle label remains afterward (the single-label invariant `github-prd-intake` enforces) — a re-run must never leave both `$SHIPPED` and `$TICKETED`, nor two copies of `$TICKETED`. For Linear, set the project/issue label equivalently.
- **Notion** — set the PRD page's `notion.statusProperty` (default `Status`) to the resolved `ticketed` value (default `Ticketed`). A status property holds exactly one value, so re-setting the same value is inherently a no-op.
- **Confluence** — move the PRD page's `parentId` to `confluence.parents.ticketed` (the parent-page-based lifecycle; Atlassian scoped tokens cannot write labels — see `config-resolution`). A page has exactly one parent, so re-parenting to the same parent is a no-op.
- **JIRA** — transition the PRD issue to the configured `ticketed` status. An issue holds exactly one status; if already `ticketed`, skip the transition.

Do **not** close or archive the PRD here, and **never** move it to `blocked` — `ticketed` signals "verification found gaps; fix work is in flight," and the PRD re-ships and re-verifies automatically once that work lands.

### 7.3 — Post a product-readable failure report on the PRD

Post a **failure report** comment back on the PRD, via the same vendor surface Phase 6.3 uses for evidence (`gh issue comment` for GitHub, the Linear comment API, the Notion/Confluence page comment surface, or a JIRA comment; dispatch through `tracker-evidence` where the PRD lives in the configured `tracker`). The report is written for a **non-engineer product owner** — plain language, no stack traces dumped raw. Capture its URL/anchor so the fix issues in 7.4 can back-link to it.

**Idempotent — regenerate the failure report in place, never append.** Lead the comment body with the stable sentinel marker `<!-- lisa:verify-prd-failure-report -->`. Before posting, look up an existing failure-report comment on the PRD whose body contains that sentinel (**match by the marker, never by comment text or position** — the same regenerate-don't-append discipline as Phase 6.3). If one exists, **edit it in place** with the freshly regenerated findings (so a re-run-after-a-previous-failure refreshes the same report rather than stacking a second one); only create a new comment when none exists. The GitHub mechanics are identical to Phase 6.3 (`gh issue view --json comments` to find the marked comment, `gh api -X PATCH .../issues/comments/<id>` to update, `gh issue comment` only when absent). It MUST include:

1. **Sentinel marker** — the literal `<!-- lisa:verify-prd-failure-report -->` as the first line, so the next run finds and regenerates this exact comment.
2. **AI disclosure** — lead with "PRD-level verification by Claude (AI agent, not a human)."
3. **Verdict line + round** — `shipped → ticketed — FAIL (re-opened for fixes)`, the cause (`CONFORMANCE_FAILED` or `EMPIRICAL_FAILED`), and `Round: N` — the count of failed verification rounds for this PRD. Read the prior in-place failure report's round and increment (start at 1). The loop **never auto-halts** on a high count, but surfacing it lets a human notice a PRD stuck across repeated fix-and-re-verify rounds.
4. **What failed, in plain language** — for each finding, name the **specific PRD requirement / acceptance criterion** that was not met, then **what was expected vs what was observed** (the empirical evidence: what was checked, what the shipped product did instead). One bullet per finding so product can follow each independently.
5. **Spec-conformance coverage matrix** — for a `CONFORMANCE_FAILED` cause, the section-by-section matrix from Phase 4 verbatim with the `PARTIAL`/`DIVERGES` verdict, so the missed/divergent/scope-crept rows are visible.
6. **Proof artifacts** — any captured empirical artifacts (screenshots uploaded via `gh release upload pr-assets <files> --clobber` and referenced as plain URLs per the `tracker-evidence` UI Evidence Checklist, request/response captures, query outputs, log excerpts).
7. **Fix issues** — a list of the fix issues created/referenced in 7.4 (filled in after 7.4 runs, or posted as a brief follow-up edit), so the report is the single product-facing index of "what's wrong and where it's being fixed."

### 7.4 — Create linked fix issues for the missing/incorrect behavior

For **each** failed/missing/incorrect/divergent finding, create a **build-ready fix ticket** via `tracker-write` with **`build_ready: true`** (the vendor-neutral writer) — never by hand-rolling `gh issue create`, so each ticket passes the same quality gates (`tracker-validate`) every Lisa ticket does: three-audience description, **Gherkin acceptance criteria**, labels, and explicit relationship discovery. `build_ready: true` makes the build queue (`lisa-intake` build side / `*-build-intake`) auto-claim it with **no human promotion** — that is what makes the loop self-healing. Group findings that share one root cause into one fix ticket; do not fan out one ticket per matrix cell when several rows are the same defect.

**Idempotent — dedupe fix issues by a stable marker; reference/update, never duplicate.** This is the "re-run after a previous failure with the same missing behavior" scenario: the prior run already opened a fix issue for that requirement, so the re-run must **find and reuse it**, not create a second one. Apply the `prd-lifecycle-rollup` idempotency dedupe key discipline (**match by a stable ref, never by title**):

1. **Compute a stable dedupe key per finding** — the PRD ref plus a stable requirement/AC identity (e.g. the AC's heading/number or a slug of the requirement), independent of any mutable wording. Encode it in the fix-issue body as the marker `<!-- lisa:verify-prd-fix prd=<prd-ref> req=<stable-req-id> -->`.
2. **Look up an existing OPEN fix issue carrying that exact marker** before creating anything. On GitHub, search the repo for open issues whose body contains the marker (`gh issue list --repo <org>/<repo> --state open --search '"<!-- lisa:verify-prd-fix prd=<prd-ref> req=<stable-req-id> -->"' --json number,url,body` — or fetch and grep the marker); on Linear/JIRA, query by the marker stored in the body/a custom field. **Match on the marker, never on the issue title** (a title may have been edited; the marker is the stable identity).
3. **If a matching open fix issue exists, reference/update it — do not create a duplicate.** Refresh its captured evidence (the latest observed-vs-expected) and re-affirm the back-links to the PRD and the regenerated failure report, then fold its existing ref into the failure report's **Fix issues** list. A closed prior fix issue does **not** suppress a new one — if the requirement is failing again after the fix was closed, that is a regression and a fresh fix issue is correct.
4. **Only when no matching open fix issue exists, create a new one** via `tracker-write`.

Each fix issue (whether freshly created or referenced/updated) MUST:

1. **Carry the dedupe marker** — `<!-- lisa:verify-prd-fix prd=<prd-ref> req=<stable-req-id> -->` in its body, so the next run finds and reuses it.
2. **Reference the specific failed requirement/AC** — quote or cite the exact PRD requirement / acceptance criterion the finding violated, so the fix is scoped to a real gap (not a vague "make it work").
3. **Carry the captured evidence** — the observed-vs-expected from the failure report (what was checked, what was expected, what the shipped product did), so an implementer can reproduce without re-deriving it.
4. **Back-link to the PRD and the failure report** — link to the PRD (so the fix rolls back up to the initiative) and to the failure-report comment from 7.3 (so the full context is one click away). On GitHub, reference the PRD issue number and the failure-report comment URL in the body and, where supported, as a sub-issue/`Relates to` link; on Linear, set the relation; on JIRA, add the issue link and remote link.
5. **Have acceptance criteria** — Gherkin ACs describing the corrected behavior (what "fixed" looks like), enforced by `tracker-write` → the vendor `*-validate-issue` gate.
6. **Be build-ready and counted as PRD work** — created via `tracker-write` with `build_ready: true`, and **registered in the PRD's generated top-level work**: refresh the PRD's `## Tickets` / generated-work section via `lisa-prd-backlink` and, where the host supports it, link it as a native sub-issue/child of the PRD. This is what closes the loop — the `*-prd-intake` rollup (Phase 3f) holds the PRD in `ticketed` until every fix ticket is terminal, and a re-verify's Phase 2/3 then counts them as required children.

Pass each new fix ticket's spec to `tracker-write` with `build_ready: true` (which dispatches to `github-write-issue` / `jira-write-ticket` / `linear-write-issue` per config — each honors `build_ready`). Collect the created **and referenced** refs/URLs, register them as PRD generated work (item 6), and fold them into the failure report's **Fix tickets** list (7.3 item 7).

> **Why not reopen children?** The generated top-level children are already terminal (that is the Phase 3 precondition for verification). A failed PRD-level acceptance is a **new** defect discovered against the shipped initiative, so it gets **new** fix issues linked to the PRD — not a reopen of closed build tickets, which would corrupt their build lifecycle (`leaf-only-lifecycle`).

Then emit the FAIL output block (below).

## Phase 8 — Idempotency: re-runs produce no duplicates

`/lisa:verify-prd` MUST be safe to re-run against the same PRD — after a fix attempt, in a batch sweep, or simply twice. A re-run produces **no duplicate evidence comments, no duplicate fix issues, and no duplicate lifecycle labels/statuses**. This is the same guarantee `prd-backlink` gives for its `## Tickets` section and `github-prd-intake` gives for its rollup; this skill consumes the `prd-lifecycle-rollup` rule's **idempotency dedupe key** (cite by slug — **match by stable ref, never by title**), it does not invent a second one.

The guards are woven into Phases 6 and 7 above; this phase collects them as one contract:

1. **Evidence / failure-report comments — regenerate in place, never append.** Each is led by a stable HTML-comment sentinel: `<!-- lisa:verify-prd-evidence -->` (PASS, Phase 6.3) and `<!-- lisa:verify-prd-failure-report -->` (FAIL, Phase 7.3). Before posting, find the existing comment whose body contains the sentinel and **edit it in place**; create a new comment only when none exists. The sentinel is matched literally — never the comment text, author display name, or position. A second run thus refreshes the one canonical comment rather than stacking a duplicate (the regenerate-don't-append discipline from `prd-backlink`).

2. **Fix issues — dedupe by a stable marker, reference don't duplicate.** Each fix issue carries `<!-- lisa:verify-prd-fix prd=<prd-ref> req=<stable-req-id> -->`, keyed by the PRD ref + a stable requirement/AC identity. Before creating a fix issue, search for an **open** issue carrying that exact marker; if found, reference/update it instead of creating a second one (Phase 7.4). The dedupe key is the marker (a stable ref), **never the issue title** — a renamed fix issue is still matched by its marker, and two distinct requirements get two distinct markers even if their titles collide (`prd-lifecycle-rollup`: "Match by stable ref, never by title"). A *closed* prior fix issue does not suppress a new one (a re-failure after a closed fix is a genuine regression).

3. **Lifecycle transition + verified native close-out — no-op when already satisfied.** The Phase 6.2 / 7.2 transition is keyed by the PRD's current state: if the PRD already carries `$VERIFIED` (PASS) or `$TICKETED` (FAIL), the transition is a no-op — no re-label, no second copy of the label/status — mirroring `github-prd-intake` Phase 3f.1's "no-op if already shipped." After any transition, exactly **one** PRD-lifecycle label/status remains (the single-label invariant); a re-run never leaves both `$SHIPPED` and the target role, nor two copies of the target role. For Notion/Confluence/JIRA the single-value status/parent makes re-setting the same value inherently idempotent. On the PASS path, provider-native closure/archive/completion is also idempotent: if it is already closed, archived, or completed, record the satisfied state and do not error.

Because every Phase 6/7 write is one of these three idempotent operations, the **whole skill is idempotent**: the end state after N runs equals the end state after 1 run — one evidence-or-failure comment, one fix issue per still-failing requirement, one lifecycle label/status. Computing the verdict itself is a pure function of the PRD's current state and its children's current states, so recomputing it on a re-run is safe (`prd-lifecycle-rollup` idempotency rule).

## Output

Emit a single fenced text block so callers can parse it.

```text
## verify-prd: <PRD title>

PRD: <ref/URL>  (vendor: <github|linear|notion|confluence|jira>)
PRD lifecycle state: <shipped | verified | ticketed>
Generated top-level children read: <n>  (source: native | documented | both)

### Terminal-child guard
- <ref> "<title>" — <terminal|terminal-but-dropped|incomplete>: <state>
- ...

Required top-level children: <n>   Terminal: <n>   Incomplete: <n>

### Spec conformance      (only when guard passed)
Verdict: <CONFORMS | PARTIAL | DIVERGES>
<coverage matrix summary: requirements covered / missed / scope-crept>

### Empirical verification  (only when conformance CONFORMS)
Surface: <browser | api | cli | db | logs | ...>  (PRD-dependent)
<each check — tool/command → PASS/FAIL → artifact ref; codified test(s)>

### Lifecycle transition   (PASS or FAIL)
shipped → verified   (role: <resolved verified role>)   evidence posted: <link>          # on VERIFIED_PASS  (re-run: evidence comment regenerated in place; transition no-op if already verified)
shipped → ticketed   (re-opened for fixes; round: N)    fix tickets (ready): <refs>   failure report: <link>   # on CONFORMANCE_FAILED | EMPIRICAL_FAILED  (re-run: failure report regenerated in place + round incremented; fix tickets deduped by marker; transition no-op if already ticketed; never blocked)

### Verdict: VERIFIED_PASS | CONFORMANCE_FAILED | EMPIRICAL_FAILED | GUARD_BLOCKED | NO_CHILDREN
```

- `GUARD_BLOCKED` — one or more required top-level children are non-terminal; verification did not run; the PRD was left at `shipped`.
- `NO_CHILDREN` — no generated top-level children found; cannot verify; the PRD was left untouched.
- `CONFORMANCE_FAILED` — guard passed but spec conformance returned `PARTIAL`/`DIVERGES`; empirical verification was skipped; the FAIL path ran — the PRD was re-opened `shipped → ticketed`, **build-ready** fix tickets were created and registered as PRD generated work, and a product-readable failure report (with the round count) was posted (Phase 7). The PRD re-ships and re-verifies once the fix tickets are terminal; it is **never** moved to `blocked`.
- `EMPIRICAL_FAILED` — guard passed and conformance `CONFORMS`, but an applicable empirical check failed or a required surface was unavailable; the FAIL path ran — the PRD was re-opened `shipped → ticketed`, **build-ready** fix tickets were created and registered as PRD generated work, and a product-readable failure report (with the round count) was posted (Phase 7). The PRD re-ships and re-verifies once the fix tickets are terminal; it is **never** moved to `blocked`.
- `VERIFIED_PASS` — guard passed, conformance `CONFORMS`, every applicable empirical check passed and was codified; the PRD was transitioned `shipped → verified` and verification evidence was posted (Phase 6).

## Rules

- **The lifecycle writes are the PASS hop `shipped → verified` and the FAIL hop `shipped → ticketed`.** The front-half (resolve → read child set → guard) is read-only and never transitions the PRD. After the guard passes and verification runs, this skill writes exactly one of two transitions: the Phase 6 PASS hop `shipped → verified` (when spec conformance is `CONFORMS` and every applicable empirical check passes), or the Phase 7 FAIL hop `shipped → ticketed` (when conformance is `PARTIAL`/`DIVERGES` or any applicable empirical check fails). The FAIL hop **never uses `blocked`** — it re-opens the PRD to `ticketed` with build-ready fix tickets (the self-healing loop), introducing no new failure state. The guard-blocked and no-children paths run no verification and leave the PRD at `shipped` untouched.
- **Every write is idempotent (Phase 8).** Re-running the skill against the same PRD produces no duplicate evidence/failure-report comments, no duplicate fix issues, and no duplicate lifecycle labels/statuses. Evidence and failure-report comments are regenerated in place via a stable sentinel marker (`<!-- lisa:verify-prd-evidence -->` / `<!-- lisa:verify-prd-failure-report -->`); fix issues are deduped by a stable PRD-ref + requirement marker (`<!-- lisa:verify-prd-fix prd=… req=… -->`) and referenced/updated rather than re-created; the lifecycle transition is a no-op when the PRD already carries the target role, leaving exactly one lifecycle label/status. The dedupe key is the `prd-lifecycle-rollup` idempotency dedupe key — **match by stable ref, never by title** — and the no-op-already-at-target-role guard mirrors `github-prd-intake` Phase 3f.1.
- **The FAIL path opens fix issues via `tracker-write`, never by hand.** Each fix issue is created through the vendor-neutral writer so it passes the same `tracker-validate` quality gate (three-audience description, Gherkin ACs, labels, relationships) every Lisa ticket does. Fix issues are **new** defects against the shipped initiative, back-linked to the PRD and the failure report — never reopens of the already-terminal generated children (`leaf-only-lifecycle`).
- **Never reimplement child enumeration.** Consume the recorded PRD→child relationship (`prd-lifecycle-rollup` native linking + machine-readable generated-work section). The two-source read here mirrors `github-prd-intake` Phase 3f.2 — same sources, same dedupe-by-child-ref, same top-level-only boundary.
- **Never reimplement spec conformance or verification.** Phase 4 invokes the `spec-conformance` skill (the single source of truth for the coverage matrix and the `CONFORMS`/`PARTIAL`/`DIVERGES` verdict); Phase 5 invokes `verification-lifecycle` (which in turn invokes `codify-verification` and, for UI, `product-walkthrough`). This skill orchestrates those skills against the PRD; it does not duplicate their logic.
- **Quality gates are not verification.** Tests, typecheck, and lint are prerequisites enforced by hooks/CI. Phase 5 requires running the actual shipped system and observing results on a surface chosen from what the PRD delivered — never substituting a green test suite for empirical proof (`verification` rule).
- **The verification surface is PRD-dependent.** Classify the empirical surface (browser/API/CLI/DB/logs/…) from what the PRD shipped; do not assume a fixed surface. A single-environment project with no deployed app verifies on its CLI/dry-run surface per the PRD's Empirical Verification Plan.
- **`verified` is product-owned and terminal.** This skill is the only automated writer of the `verified` role; intake/rollup never set it. The PASS hop also performs provider-native close/archive/completion where supported, and that close-out is mandatory and idempotent.
- **Verification failure never uses `blocked`; it re-opens to `ticketed`.** The FAIL hop sets the existing `ticketed` PRD role (`config-resolution`) and creates build-ready fix tickets registered as the PRD's generated work, so the lifecycle stays small (`prd-lifecycle-rollup` "No extra failure states") and self-heals — the fix tickets auto-build, rollup re-ships the PRD, and a later cycle re-verifies. `blocked` remains the *intake* (ready-stage validation) failure role, not the verification one; the FAIL hop never closes or archives the PRD.
- **Top-level only.** Exclude leaf Sub-tasks and Stories nested under a generated Epic. The PRD owns its top-level work; those top-level units own their descendants (`prd-lifecycle-rollup` generated-top-level-work contract).
- **Cite, don't restate.** The generated-top-level-work boundary, the per-vendor terminal predicate, the env-keyed `done` resolution, the dedupe-by-child-ref idempotency key, and the `shipped → verified | ticketed` PRD-level verification hops all come from the `prd-lifecycle-rollup` rule; the `verified`/`shipped`/`blocked`/`ticketed` role vocabulary comes from `config-resolution`. This skill is a consumer of those contracts, not a second source of truth.

## Related skills

- `spec-conformance` — Phase 4 invokes it with the PRD as the spec source; it owns the section-by-section coverage matrix and the `CONFORMS`/`PARTIAL`/`DIVERGES` verdict. This skill never reimplements that matrix.
- `verification-lifecycle` — Phase 5 invokes it to run empirical verification of the shipped surface (classify → check tooling → plan → execute → codify → loop). It in turn invokes `codify-verification` and, for UI surfaces, `product-walkthrough`.
- `codify-verification` — turns each passing empirical verification into a regression test so the PRD's verified behavior cannot silently regress; invoked transitively via `verification-lifecycle`.
- `product-walkthrough` — drives the live product through a real browser to ground UI-surface verification and the evidence comment in what actually renders.
- `tracker-evidence` — the vendor-neutral evidence poster whose UI Evidence Checklist and `pr-assets` upload mechanics Phase 6.3 (PASS evidence) and Phase 7.3 (FAIL failure report) follow when commenting on the PRD.
- `tracker-write` — the vendor-neutral ticket writer Phase 7.4 invokes to create each linked fix issue (dispatching to `github-write-issue` / `jira-write-ticket` / `linear-write-issue` per config), so every fix issue clears the `tracker-validate` quality gate (Gherkin ACs, three-audience description, labels, relationships). This skill never hand-rolls issue creation.
- `prd-backlink` — the regenerate-in-place-via-marker idempotency pattern Phase 6.3 / 7.3 / 8 follow: it regenerates its `## Tickets` section from the current child set on every run (never appending) and dedupes by child-ref. The evidence/failure-report sentinel comments here apply the same discipline to PRD comments.
- `github-prd-intake` — the no-op-if-already-at-target-role guard Phase 6.2 / 7.2 / 8 mirror: its Phase 3f.1 rollup is a no-op on a PRD already carrying `$SHIPPED`, and it enforces the single-label invariant after every transition. This skill applies the same guard to the `verified` / `ticketed` hops.

## Related rules

- `prd-lifecycle-rollup` — the vendor-neutral source of truth for PRD→generated-top-level-work ownership, the per-vendor terminal predicate, the `shipped` rollup, the `shipped → verified` (pass) / `shipped → ticketed` (fail) PRD-level verification hops, the "no extra failure states" rule (the FAIL hop re-opens to `ticketed` and never uses `blocked`), the "Closing the loop" self-healing dispatch, and the **idempotency dedupe key** ("match by stable ref, never by title"; no-op already-shipped rollup). This skill consumes that contract — implementing the `shipped → verified` PASS hop, the `shipped → ticketed` FAIL hop, and the Phase 8 idempotency guards (marker-based comment regeneration, marker-based fix-ticket dedupe, no-op-already-at-target-role transition) — citing the rule by slug rather than restating its taxonomy.
- `verification` — defines what counts as empirical verification (the Verification Types table) and that quality gates (test/typecheck/lint) are prerequisites, not verification. Phase 5 honors it when classifying and running the surface-appropriate checks.
- `leaf-only-lifecycle` — governs the build lifecycle of leaf work units and how a generated Epic rolls up from its own children; this skill trusts that bottom-up rollup when reading a top-level child's resolved state.
- `config-resolution` — the PRD-lifecycle role vocabulary (`shipped`, `verified`, `blocked`, `ticketed`), the per-vendor `verified` role maps (`prd-verified` label for GitHub/Linear, `Verified` status for Notion, `confluence.parents.verified` parent page) Phase 6.1 resolves, the per-vendor `ticketed` role maps Phase 7.1 resolves (the FAIL hop re-opens to `ticketed`, not `blocked`; `blocked` remains the intake-stage failure role, not used by verify-prd), and the env-keyed `done` map the terminal predicate resolves against.

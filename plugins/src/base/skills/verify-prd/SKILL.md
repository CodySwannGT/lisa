---
name: verify-prd
description: "Initiative-level PRD acceptance gate. Given a PRD ref/URL (GitHub Issue, Linear project/issue, Notion page, Confluence page, or JIRA issue), resolves the source vendor, reads the PRD body and its generated top-level child work set via the prd-lifecycle-rollup contract (native hierarchy first, machine-readable generated-work section fallback — never reimplementing child enumeration), and confirms every required generated top-level work item is terminal before any verification runs. If any required top-level child is non-terminal, it reports the incomplete child set and STOPS without verifying or transitioning the PRD. When the guard passes, it runs spec-conformance against the original PRD requirements (via the spec-conformance skill) plus empirical verification appropriate to the shipped surface (via verification-lifecycle). On a CONFORMS verdict with all empirical checks passing it runs the PASS path: transitions the PRD shipped → verified and posts verification evidence. On a PARTIAL/DIVERGES conformance verdict or any failing empirical check it runs the FAIL path: transitions the PRD shipped → blocked (reusing the existing blocked role — no new failure state), posts a product-readable failure report naming which requirements/ACs failed with observed-vs-expected evidence, and creates linked fix issues (via tracker-write) back-linked to the PRD and the failure report, each carrying the captured evidence and acceptance criteria. Re-run idempotency is handled by sibling work."
allowed-tools: ["Skill", "Bash", "Read", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-get-comments", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluencePageDescendants", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__linear-server__get_project", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__list_documents", "mcp__linear-server__get_document"]
---

# PRD-level Verification: $ARGUMENTS

`/lisa:verify-prd <prd>` is the **initiative-level acceptance gate**. It runs *after* a PRD is `shipped` (all generated top-level work terminal, per `prd-lifecycle-rollup`'s rollup phase) and proves the shipped product actually matches the PRD — not merely that every ticket is closed. `shipped` is **necessary but not sufficient** for `verified`: a PRD can have every child ticket closed while still missing a requirement, diverging from its acceptance criteria, or failing a real user workflow.

This is distinct from `/lisa:verify`, which empirically verifies a **single work item** (a ticket / story / sub-task) in its target environment as part of that item's Build/Fix/Improve flow. `/lisa:verify` drives a build ticket to `done` at the leaf/build level; it does not read the PRD or judge initiative-level acceptance. `/lisa:verify-prd` operates one level up, over the whole initiative. See the `prd-lifecycle-rollup` rule's "PRD-level verification vs ticket verification" section for the full distinction.

`$ARGUMENTS` is a single PRD reference: a **GitHub issue URL** (or `<org>/<repo>#<n>`), a **Linear project/issue URL**, a **Notion page URL**, a **Confluence page URL**, or a **JIRA issue key/URL**.

## Confirmation policy

Do **not** re-prompt once invoked. Like the `*-prd-intake` skills, the caller has already authorized the run by invoking the skill; asking the user to confirm before reading or before applying the guard defeats the purpose of a batchable acceptance gate. Run the front-half (resolve → read child set → guard) to completion and report.

## Scope of this skill

This skill covers the **read/guard front-half** plus **both verdict branches** (PASS and FAIL) of PRD-level verification:

1. Resolve the PRD ref and detect its source vendor.
2. Read the PRD body and its **generated top-level child work set** via the `prd-lifecycle-rollup` contract.
3. Apply the per-vendor terminal predicate to the generated top-level work and run the **terminal-child guard**: if any required top-level child is non-terminal, report the incomplete set and STOP — do not run verification, do not transition the PRD.
4. **Spec conformance** — when the guard passes, invoke the `spec-conformance` skill with the PRD as the spec source to build a section-by-section coverage matrix against the shipped product (never reimplementing the matrix).
5. **Empirical verification** — invoke `verification-lifecycle` to run empirical checks appropriate to the PRD's surface (browser/computer-use, API, CLI, DB, screenshots, logs), honoring the `verification` rule. Quality gates (test/typecheck/lint) are **not** verification.
6. **PASS transition + evidence** — when spec conformance is `CONFORMS` **and** every applicable empirical check passes, transition the PRD lifecycle from the resolved `shipped` role to the resolved `verified` role (vendor-neutral via `config-resolution`) and post verification evidence (the coverage matrix + empirical proof artifacts) back on the PRD.
7. **FAIL transition + failure report + fix issues** — when spec conformance is `PARTIAL`/`DIVERGES`, or any applicable empirical check fails (or a required surface is unavailable), transition the PRD from the resolved `shipped` role to the resolved `blocked` role (reusing the existing `blocked` role — **no new failure state**, vendor-neutral via `config-resolution`), post a product-readable failure report on the PRD, and create linked fix issues via `tracker-write` for each missing/incorrect/divergent behavior.

The only remaining phase of PRD-level verification is **out of scope** here and is delivered by sibling work:

- **Idempotency** (#600) — re-runs producing no duplicate evidence, fix issues, or lifecycle transitions.

When verification passes, this skill runs the **PASS** branch of Phase 6 (`shipped → verified`). When it does not pass — spec conformance not `CONFORMS`, or any empirical check failing — this skill runs the **FAIL** branch of Phase 7 (`shipped → blocked` + failure report + fix issues); it does **not** leave the PRD at `shipped`. Re-running before the idempotency sibling lands may re-post evidence/failure reports, re-create fix issues, or re-apply the (idempotent-by-label) transition; full no-duplicate guarantees are the idempotency sibling's job.

## Phase 1 — Resolve the PRD ref and detect the source vendor

Detect the vendor from `$ARGUMENTS` the same way `prd-ticket-coverage` / `prd-backlink` do — from the host (or key shape for JIRA), never by guessing:

| Input shape | Vendor | Read surface |
|---|---|---|
| `github.com/<org>/<repo>/issues/<n>` or `<org>/<repo>#<n>` | **GitHub Issues** | `gh` CLI (Lisa uses the CLI exclusively for GitHub — no GitHub MCP) |
| `linear.app/...` | **Linear** | `mcp__linear-server__get_project` / `get_issue` |
| `notion.so` / `notion.site` | **Notion** | `mcp__claude_ai_Notion__notion-fetch` (`include_discussions: true`) |
| `*.atlassian.net/wiki/...` | **Confluence** | `mcp__atlassian__getConfluencePage` (+ descendants) |
| JIRA issue key (e.g. `PROJ-123`) or `*.atlassian.net/browse/...` | **JIRA** | `mcp__atlassian__getJiraIssue` |

Read the PRD body via the vendor-appropriate surface. The vendor that owns the PRD source is what Phase 2 reads the child set from; it is independent of which tracker hosts the generated tickets (a Notion PRD can own JIRA tickets — the cross-vendor case is handled by the documented generated-work section in Phase 2).

Where the PRD lives in the same vendor as the configured `tracker` (`.lisa.config.json`), prefer reading the PRD ticket through `lisa:tracker-read` so this skill stays agnostic of which tracker hosts the work — `tracker-read` dispatches to `lisa:github-read-issue` / `lisa:jira-read-ticket` / `lisa:linear-read-issue` per config and returns the consolidated context bundle (PRD body, native children, links). For PRD sources with no tracker counterpart (Notion / Confluence / cross-vendor), read the PRD body directly via the vendor surface above.

## Phase 2 — Read the generated top-level child work set

**Do NOT reimplement child enumeration.** Consume the PRD→generated-top-level-work relationship recorded by the merged child-linking work (`prd-backlink` native linking + its always-written machine-readable generated-work section), exactly as `github-prd-intake`'s rollup phase consumes it. Read the **generated top-level work** only — the PRD's created Epics and any top-level Story created directly under it — and **exclude** leaf Sub-tasks and any Story nested under a generated Epic, per the `prd-lifecycle-rollup` rule's generated-top-level-work contract.

Use two sources, **native first**, deduped by child-ref identity:

1. **Native hierarchy (primary).** Read the PRD's direct native children — these are its top-level children:
   - **GitHub** — the PRD issue's direct `subIssues` nodes (the GraphQL `subIssues` query `lisa:github-read-issue` Phase 3 uses; capture `number title state url stateReason labels`).
   - **Linear** — for a PRD Project, its member Issues (`list_issues({project})`); for a PRD Issue, its sub-Issues (`get_issue` children). Capture each child's `state` (workflow state + category).
   - **JIRA** — the PRD's children via the epic-link/parent JQL `lisa:jira-read-ticket` Phase 5 uses (`"Epic Link" = <PRD-KEY>` or `parent = <PRD-KEY>`). Capture each child's `statusCategory`.
   - **Notion / Confluence** — no native issue hierarchy; use the documented section below.

2. **Documented generated-work section (fallback / cross-vendor).** When native hierarchy is unavailable (older host, cross-vendor PRD→tracker, or the relationship was only recorded in the PRD body), parse the machine-readable generated-work section `prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`). Enumerate the `<!-- lisa:gw ref=… url=… type=… parent=… -->` tokens; the **generated top-level child set is every token whose `parent` is empty** (top-level), exactly as `prd-backlink` documents. Tokens with a non-empty `parent` are descendants — skip them. For GitHub, this is the same `awk` extraction `github-prd-intake` Phase 3f.2 uses.

**Dedupe by child-ref identity** (`owner/repo#number` for GitHub, the issue/project identifier for Linear, the issue key for JIRA, the recorded ref for Notion/Confluence — the `prd-lifecycle-rollup` idempotency dedupe key) so a child appearing in both the native graph and the documented section is counted once. **Match by stable ref, never by title.**

If neither source yields any generated top-level child (the PRD generated nothing, or the relationship was never recorded), report `no generated top-level children — cannot verify an empty PRD` and STOP. Do not transition the PRD.

## Phase 3 — Terminal-child guard

Apply the **per-vendor terminal-state predicate from the `prd-lifecycle-rollup` rule** to every generated **top-level** work item (cite the rule by slug — do not restate its predicate table here). In summary, a top-level child is:

- **Terminal** — it has reached its source/tracker's done/shipped state (GitHub: closed + the resolved build `done` role label where used; Linear: a `done`-category completed state; JIRA: `statusCategory.key == "done"`; Notion/Confluence: the documented generated-work entry marked done). A generated Epic is terminal only when *it* has rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own resolved state; do not re-derive it from its leaves.
- **Terminal-but-dropped** — closed-as-not-planned (GitHub `stateReason == "not_planned"`) / canceled (Linear) / won't-do. It does **not** hold the PRD open and is excluded from the required set.
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

If either is false, do not enter this phase — stop at the verdict and leave the PRD at `shipped` (the FAIL sibling owns the `blocked` path).

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

Apply the vendor-appropriate transition. This is the `shipped → verified` PASS hop the `prd-lifecycle-rollup` rule defines (cite it by slug; this skill is its PASS-path implementation, not a second source of truth):

- **GitHub / Linear** — remove the `shipped` label and add the `verified` label. For GitHub:
  ```bash
  gh issue edit <prd-num> --repo <org>/<repo> --remove-label "$SHIPPED" --add-label "$VERIFIED"
  ```
  Verify exactly **one** PRD-lifecycle label remains afterward (the single-label invariant `github-prd-intake` enforces). For Linear, set the project/issue label equivalently.
- **Notion** — set the PRD page's `notion.statusProperty` (default `Status`) to the resolved `verified` value (default `Verified`).
- **Confluence** — move the PRD page's `parentId` to `confluence.parents.verified` (the parent-page-based lifecycle; Atlassian scoped tokens cannot write labels — see `config-resolution`).
- **JIRA** — transition the PRD issue to the configured `verified` status.

`verified` is the terminal, product-owned PRD state; this skill is the **only** automated writer of it (intake/rollup never set it). Do **not** close or archive the PRD here — closure is governed separately by `prd.rollup.closeOnShipped` at the `shipped` hop, not the verify hop.

### 6.3 — Post verification evidence on the PRD

Post a verification-evidence comment back on the PRD, in the spirit of `tracker-evidence` (the vendor-neutral evidence poster). Because the evidence lands on the **PRD source** — which may be Notion or Confluence, not a tracker ticket — post via the vendor surface that owns the PRD: `gh issue comment` for GitHub, the Linear comment API, the Notion/Confluence page comment surface, or a JIRA comment. Where the PRD lives in the configured `tracker`, you may dispatch through `tracker-evidence`; for Notion/Confluence/cross-vendor PRDs, comment on the PRD page directly. The evidence comment MUST include:

1. **AI disclosure** — lead with "PRD-level verification by Claude (AI agent, not a human)."
2. **Verdict line** — `shipped → verified — PASS`.
3. **Spec-conformance coverage matrix** — the section-by-section matrix from Phase 4 verbatim, with the `CONFORMS` verdict.
4. **Empirical proof artifacts** — the Phase 5 artifacts per surface: screenshots (upload via `gh release upload pr-assets <files> --clobber` and reference as plain URLs, per the `tracker-evidence` UI Evidence Checklist), request/response captures, query outputs, log excerpts, and the codified regression test(s) added.
5. **What was verified** — which PRD acceptance criteria each artifact covers, and the verification surface used.

Then emit the PASS output block (below).

## Phase 7 — FAIL: transition `shipped → blocked`, post a failure report, and create fix issues

Reach this phase when verification did **not** pass — i.e. **either** is true:

- Phase 4 spec conformance returned **`PARTIAL`** or **`DIVERGES`** (`CONFORMANCE_FAILED` cause), or
- Phase 5 had **any** applicable empirical check fail or a required surface unavailable (`EMPIRICAL_FAILED` cause).

This is the FAIL counterpart of the Phase 6 PASS hop. It is the `shipped → blocked` FAIL hop the `prd-lifecycle-rollup` rule defines (cite it by slug; this skill is its FAIL-path implementation, not a second source of truth). It **reuses the existing `blocked` role** — it does **not** introduce a `prd-verification-failed` / `prd-verifying` state, per the "No extra failure states" rule in `prd-lifecycle-rollup`.

Carry forward the verdict cause and the concrete **findings** that produced it: from `CONFORMANCE_FAILED`, the matrix's missed/divergent/scope-crept requirements; from `EMPIRICAL_FAILED`, each failing check (the requirement/AC it exercised, the tool/command, observed vs expected, and any captured artifacts). These findings drive both the failure report (7.3) and the fix issues (7.4).

### 7.1 — Resolve the `blocked` and `shipped` roles

Resolve the PRD-lifecycle roles from `.lisa.config.json` (then `.lisa.config.local.json` override) per the `config-resolution` rule — the same role-resolution Phase 6.1 and the `*-prd-intake` skills use. **Cite `config-resolution` for the role vocabulary; do not hardcode label strings except as the documented defaults.** Resolution per vendor:

| Vendor | `shipped` role | `blocked` role | Default `blocked` |
|---|---|---|---|
| **GitHub** | `github.labels.prd.shipped` | `github.labels.prd.blocked` | `prd-blocked` (label) |
| **Linear** | `linear.labels.prd.shipped` | `linear.labels.prd.blocked` | `prd-blocked` (project/issue label) |
| **Notion** | `notion.values.shipped` | `notion.values.blocked` | `Blocked` (status value) |
| **Confluence** | `confluence.parents.shipped` | `confluence.parents.blocked` | the `Blocked` parent page id |
| **JIRA** | the configured shipped status | the configured blocked status | per `config-resolution` |

For GitHub, resolve with the same helper Phase 6.1 / `github-prd-intake` use:

```bash
read_role() {  # role default → resolved value (local override wins)
  local role="$1" default="$2" local_v global_v
  local_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
SHIPPED=$(read_role shipped prd-shipped)
BLOCKED=$(read_role blocked prd-blocked)
```

### 7.2 — Transition the PRD `shipped → blocked`

Apply the vendor-appropriate transition. This is the `shipped → blocked` FAIL hop from `prd-lifecycle-rollup` (cite it by slug):

- **GitHub / Linear** — remove the `shipped` label and add the `blocked` label. For GitHub:
  ```bash
  gh issue edit <prd-num> --repo <org>/<repo> --remove-label "$SHIPPED" --add-label "$BLOCKED"
  ```
  Verify exactly **one** PRD-lifecycle label remains afterward (the single-label invariant `github-prd-intake` enforces). For Linear, set the project/issue label equivalently.
- **Notion** — set the PRD page's `notion.statusProperty` (default `Status`) to the resolved `blocked` value (default `Blocked`).
- **Confluence** — move the PRD page's `parentId` to `confluence.parents.blocked` (the parent-page-based lifecycle; Atlassian scoped tokens cannot write labels — see `config-resolution`).
- **JIRA** — transition the PRD issue to the configured `blocked` status.

Do **not** close or archive the PRD here — `blocked` signals "verification failed; human attention required," not "done." The PRD stays open so product can see it failed acceptance.

### 7.3 — Post a product-readable failure report on the PRD

Post a **failure report** comment back on the PRD, via the same vendor surface Phase 6.3 uses for evidence (`gh issue comment` for GitHub, the Linear comment API, the Notion/Confluence page comment surface, or a JIRA comment; dispatch through `tracker-evidence` where the PRD lives in the configured `tracker`). The report is written for a **non-engineer product owner** — plain language, no stack traces dumped raw. Capture its URL/anchor so the fix issues in 7.4 can back-link to it. It MUST include:

1. **AI disclosure** — lead with "PRD-level verification by Claude (AI agent, not a human)."
2. **Verdict line** — `shipped → blocked — FAIL` and the cause (`CONFORMANCE_FAILED` or `EMPIRICAL_FAILED`).
3. **What failed, in plain language** — for each finding, name the **specific PRD requirement / acceptance criterion** that was not met, then **what was expected vs what was observed** (the empirical evidence: what was checked, what the shipped product did instead). One bullet per finding so product can follow each independently.
4. **Spec-conformance coverage matrix** — for a `CONFORMANCE_FAILED` cause, the section-by-section matrix from Phase 4 verbatim with the `PARTIAL`/`DIVERGES` verdict, so the missed/divergent/scope-crept rows are visible.
5. **Proof artifacts** — any captured empirical artifacts (screenshots uploaded via `gh release upload pr-assets <files> --clobber` and referenced as plain URLs per the `tracker-evidence` UI Evidence Checklist, request/response captures, query outputs, log excerpts).
6. **Fix issues** — a list of the fix issues created in 7.4 (filled in after 7.4 runs, or posted as a brief follow-up edit), so the report is the single product-facing index of "what's wrong and where it's being fixed."

### 7.4 — Create linked fix issues for the missing/incorrect behavior

For **each** failed/missing/incorrect/divergent finding, create a **fix issue** via `tracker-write` (the vendor-neutral writer) — never by hand-rolling `gh issue create`, so each issue passes the same quality gates (`tracker-validate`) every Lisa ticket does: three-audience description, **Gherkin acceptance criteria**, labels, and explicit relationship discovery. Group findings that share one root cause into one fix issue; do not fan out one issue per matrix cell when several rows are the same defect. Each fix issue MUST:

1. **Reference the specific failed requirement/AC** — quote or cite the exact PRD requirement / acceptance criterion the finding violated, so the fix is scoped to a real gap (not a vague "make it work").
2. **Carry the captured evidence** — the observed-vs-expected from the failure report (what was checked, what was expected, what the shipped product did), so an implementer can reproduce without re-deriving it.
3. **Back-link to the PRD and the failure report** — link to the PRD (so the fix rolls back up to the initiative) and to the failure-report comment from 7.3 (so the full context is one click away). On GitHub, reference the PRD issue number and the failure-report comment URL in the body and, where supported, as a sub-issue/`Relates to` link; on Linear, set the relation; on JIRA, add the issue link and remote link.
4. **Have acceptance criteria** — Gherkin ACs describing the corrected behavior (what "fixed" looks like), enforced by `tracker-write` → the vendor `*-validate-issue` gate.

Pass each fix issue's spec to `tracker-write` (which dispatches to `github-write-issue` / `jira-write-ticket` / `linear-write-issue` per config). Collect the created refs/URLs and fold them into the failure report's **Fix issues** list (7.3 item 6).

> **Why not reopen children?** The generated top-level children are already terminal (that is the Phase 3 precondition for verification). A failed PRD-level acceptance is a **new** defect discovered against the shipped initiative, so it gets **new** fix issues linked to the PRD — not a reopen of closed build tickets, which would corrupt their build lifecycle (`leaf-only-lifecycle`).

Then emit the FAIL output block (below).

## Output

Emit a single fenced text block so callers can parse it.

```text
## verify-prd: <PRD title>

PRD: <ref/URL>  (vendor: <github|linear|notion|confluence|jira>)
PRD lifecycle state: <shipped | verified>
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
shipped → verified   (role: <resolved verified role>)   evidence posted: <link>          # on VERIFIED_PASS
shipped → blocked    (role: <resolved blocked role>)    failure report: <link>   fix issues: <refs>   # on CONFORMANCE_FAILED | EMPIRICAL_FAILED

### Verdict: VERIFIED_PASS | CONFORMANCE_FAILED | EMPIRICAL_FAILED | GUARD_BLOCKED | NO_CHILDREN
```

- `GUARD_BLOCKED` — one or more required top-level children are non-terminal; verification did not run; the PRD was left at `shipped`.
- `NO_CHILDREN` — no generated top-level children found; cannot verify; the PRD was left untouched.
- `CONFORMANCE_FAILED` — guard passed but spec conformance returned `PARTIAL`/`DIVERGES`; empirical verification was skipped; the FAIL path ran — the PRD was transitioned `shipped → blocked` (reusing the `blocked` role), a product-readable failure report was posted, and linked fix issues were created (Phase 7).
- `EMPIRICAL_FAILED` — guard passed and conformance `CONFORMS`, but an applicable empirical check failed or a required surface was unavailable; the FAIL path ran — the PRD was transitioned `shipped → blocked` (reusing the `blocked` role), a product-readable failure report was posted, and linked fix issues were created (Phase 7).
- `VERIFIED_PASS` — guard passed, conformance `CONFORMS`, every applicable empirical check passed and was codified; the PRD was transitioned `shipped → verified` and verification evidence was posted (Phase 6).

## Rules

- **The lifecycle writes are the PASS hop `shipped → verified` and the FAIL hop `shipped → blocked`.** The front-half (resolve → read child set → guard) is read-only and never transitions the PRD. After the guard passes and verification runs, this skill writes exactly one of two transitions: the Phase 6 PASS hop `shipped → verified` (when spec conformance is `CONFORMS` and every applicable empirical check passes), or the Phase 7 FAIL hop `shipped → blocked` (when conformance is `PARTIAL`/`DIVERGES` or any applicable empirical check fails). The FAIL hop **reuses the existing `blocked` role — it introduces no new failure state.** The guard-blocked and no-children paths run no verification and leave the PRD at `shipped` untouched. Re-run idempotency (no duplicate evidence/failure-reports/fix-issues/transitions) is sibling work (out of scope, #600).
- **The FAIL path opens fix issues via `tracker-write`, never by hand.** Each fix issue is created through the vendor-neutral writer so it passes the same `tracker-validate` quality gate (three-audience description, Gherkin ACs, labels, relationships) every Lisa ticket does. Fix issues are **new** defects against the shipped initiative, back-linked to the PRD and the failure report — never reopens of the already-terminal generated children (`leaf-only-lifecycle`).
- **Never reimplement child enumeration.** Consume the recorded PRD→child relationship (`prd-lifecycle-rollup` native linking + machine-readable generated-work section). The two-source read here mirrors `github-prd-intake` Phase 3f.2 — same sources, same dedupe-by-child-ref, same top-level-only boundary.
- **Never reimplement spec conformance or verification.** Phase 4 invokes the `spec-conformance` skill (the single source of truth for the coverage matrix and the `CONFORMS`/`PARTIAL`/`DIVERGES` verdict); Phase 5 invokes `verification-lifecycle` (which in turn invokes `codify-verification` and, for UI, `product-walkthrough`). This skill orchestrates those skills against the PRD; it does not duplicate their logic.
- **Quality gates are not verification.** Tests, typecheck, and lint are prerequisites enforced by hooks/CI. Phase 5 requires running the actual shipped system and observing results on a surface chosen from what the PRD delivered — never substituting a green test suite for empirical proof (`verification` rule).
- **The verification surface is PRD-dependent.** Classify the empirical surface (browser/API/CLI/DB/logs/…) from what the PRD shipped; do not assume a fixed surface. A single-environment project with no deployed app verifies on its CLI/dry-run surface per the PRD's Empirical Verification Plan.
- **`verified` is product-owned and terminal.** This skill is the only automated writer of the `verified` role; intake/rollup never set it. The PASS hop does not close or archive the PRD (closure is governed by `prd.rollup.closeOnShipped` at the `shipped` hop).
- **`blocked` is reused, not invented, and is non-terminal.** The FAIL hop sets the existing `blocked` PRD role (`config-resolution`) — the same role intake uses for failed validation — so the lifecycle stays small (`prd-lifecycle-rollup` "No extra failure states"). `blocked` means "verification failed; human attention required"; the FAIL hop never closes or archives the PRD.
- **Top-level only.** Exclude leaf Sub-tasks and Stories nested under a generated Epic. The PRD owns its top-level work; those top-level units own their descendants (`prd-lifecycle-rollup` generated-top-level-work contract).
- **Cite, don't restate.** The generated-top-level-work boundary, the per-vendor terminal predicate, the env-keyed `done` resolution, the dedupe-by-child-ref idempotency key, and the `shipped → verified | blocked` PRD-level verification hops all come from the `prd-lifecycle-rollup` rule; the `verified`/`shipped`/`blocked` role vocabulary comes from `config-resolution`. This skill is a consumer of those contracts, not a second source of truth.

## Related skills

- `spec-conformance` — Phase 4 invokes it with the PRD as the spec source; it owns the section-by-section coverage matrix and the `CONFORMS`/`PARTIAL`/`DIVERGES` verdict. This skill never reimplements that matrix.
- `verification-lifecycle` — Phase 5 invokes it to run empirical verification of the shipped surface (classify → check tooling → plan → execute → codify → loop). It in turn invokes `codify-verification` and, for UI surfaces, `product-walkthrough`.
- `codify-verification` — turns each passing empirical verification into a regression test so the PRD's verified behavior cannot silently regress; invoked transitively via `verification-lifecycle`.
- `product-walkthrough` — drives the live product through a real browser to ground UI-surface verification and the evidence comment in what actually renders.
- `tracker-evidence` — the vendor-neutral evidence poster whose UI Evidence Checklist and `pr-assets` upload mechanics Phase 6.3 (PASS evidence) and Phase 7.3 (FAIL failure report) follow when commenting on the PRD.
- `tracker-write` — the vendor-neutral ticket writer Phase 7.4 invokes to create each linked fix issue (dispatching to `github-write-issue` / `jira-write-ticket` / `linear-write-issue` per config), so every fix issue clears the `tracker-validate` quality gate (Gherkin ACs, three-audience description, labels, relationships). This skill never hand-rolls issue creation.

## Related rules

- `prd-lifecycle-rollup` — the vendor-neutral source of truth for PRD→generated-top-level-work ownership, the per-vendor terminal predicate, the `shipped` rollup, the `shipped → verified | blocked` PRD-level verification hops, the "no extra failure states" rule (the FAIL hop reuses `blocked`), and the child-ref idempotency dedupe key. This skill consumes that contract — implementing both the `shipped → verified` PASS hop and the `shipped → blocked` FAIL hop — citing the rule by slug rather than restating its taxonomy.
- `verification` — defines what counts as empirical verification (the Verification Types table) and that quality gates (test/typecheck/lint) are prerequisites, not verification. Phase 5 honors it when classifying and running the surface-appropriate checks.
- `leaf-only-lifecycle` — governs the build lifecycle of leaf work units and how a generated Epic rolls up from its own children; this skill trusts that bottom-up rollup when reading a top-level child's resolved state.
- `config-resolution` — the PRD-lifecycle role vocabulary (`shipped`, `verified`, `blocked`), the per-vendor `verified` role maps (`prd-verified` label for GitHub/Linear, `Verified` status for Notion, `confluence.parents.verified` parent page) Phase 6.1 resolves, the per-vendor `blocked` role maps (`prd-blocked` label for GitHub/Linear, `Blocked` status for Notion, `confluence.parents.blocked` parent page) Phase 7.1 resolves, and the env-keyed `done` map the terminal predicate resolves against.

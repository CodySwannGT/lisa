---
name: lisa-implement
description: This skill should be used for any non-trivial request — features, bugs, stories, epics, spikes, or multi-step tasks. It accepts a ticket URL (Jira, Linear, GitHub), a file path containing a spec, or a plain-text prompt. It assembles an agent team, breaks the work into structured tasks, and manages the full lifecycle from research through implementation, code review, deploy, and empirical verification.
---

# Implement: $ARGUMENTS

## Orchestration: agent team

Implement is a **team-first** flow. Bug, Build, Improve, and Investigate-Only all compose multiple specialists (Reproduce → debug → fix → review → verify). Single-agent mode is not permitted based on task complexity — the only exception is when no team creation or subagent delegation tool is available in the current runtime (see no-team fallback in the paragraph below).

You are "inside an agent team" only if you are yourself a spawned teammate or subagent — you were spawned into a team context, or your context names a team lead you report to. A lead/root session that has previously spawned subagents is still the lead: prior `Agent` calls in the session (e.g., an Intake cycle's bounded scan helpers) do NOT make this a nested flow, and the lead retains full authority to create this flow's team.

If you are NOT inside an agent team by that definition, the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude (Claude Code >= 2.1.178, implicit-team model): there is no `TeamCreate` tool — the team forms automatically the moment you spawn your first teammate with the `Agent` tool. That first `Agent` spawn MUST be the bounded **input-resolver** described under "Resolve the input" below — never a builder/implementer that does the whole task inline. Spawning one fat worker satisfies the team-first gate but collapses the flow into the 1-agent ad-hoc fix this skill forbids, and it skips the Roster Decision, which MUST be recorded before any lifecycle, research, implementation, review, or verification specialist is spawned. (On older Claude Code that still exposes `TeamCreate`, that explicit path also works: load it via `ToolSearch` with `query: "select:TeamCreate"`, create the team, then spawn the input-resolver.)
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Your only permitted first move is establishing orchestration by spawning the bounded **input-resolver** teammate (Claude: `Agent`; Codex: `multi_agent_v1.spawn_agent`), or declaring the no-team fallback. The initial Claude `Agent` spawn is the only pre-team exception, and for Implement it must be the bounded input-resolver rather than a builder. Apart from that single spawn, do NOT call any of: a second `Agent`/`spawn_agent` for any worker, `TaskCreate`, `Skill` (including `lisa-tracker-read`, `lisa-jira-read-ticket`, `lisa-github-read-issue`), MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob` — until the input-resolver has returned and the Roster Decision has been recorded. Reading the ticket, exploring the code, fetching context — every one of those is a task for the team, not for the lead session before orchestration exists. Doing them inline, or spawning a single worker that does the whole build, is the exact bypass path that produces a 1-agent ad-hoc fix instead of a real team flow.

Note that `lisa-intake` dispatching this skill is NOT the nested case: Intake is a thin dispatcher that creates no team of its own and invokes this skill via the Skill tool in the lead session precisely so this preamble fires — treat an Intake dispatch exactly like a direct invocation and run the full team-first flow above.

If you ARE already inside an agent team by the definition above (you are a teammate that was handed this skill via the Skill tool from within another flow's team), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Resolve the input (first task assigned to the team)

$ARGUMENTS is either a URL/key for an existing work item, a pointer to a file containing the request, or the request in text format. Every form must resolve to exactly one live, claimed tracker leaf and a verified worktree binding before the lead may begin durable work.

The team lead does NOT read the input directly. The first task on the team's plan is "resolve the input" — assigned to a bounded input-resolver teammate, which then:

The input-resolver invokes `lisa-track $ARGUMENTS` and owns its complete resolve -> claim -> bind transaction:

- **Explicit ticket:** call `lisa-tracker-read` against the configured tracker and require a live open/unresolved current-project leaf. **Mismatch guard:** if the ticket format/project does not match the configured tracker (for example, a GitHub URL when `tracker` is `jira`), stop — never auto-translate vendors or trust pasted/stale ticket text. The read captures comments, graph, and metadata, not just the description.
- **Specification file:** read the entire file without offset or limit, preserve it as the resolved input, and follow the plain-text resolution path below.
- **Plain text or file contents:** search the configured project conservatively for open leaves describing the same outcome. Live-validate every candidate through `lisa-tracker-read`; reuse only exactly one high-confidence match. When there is no unique match (zero or ambiguous candidates), synthesize one complete single-repository leaf and invoke `lisa-tracker-write` exactly once with `build_ready: true`, then live-read its canonical returned ref. Never create a thin placeholder, hierarchy, or container.
- **Claim:** invoke `lisa-tracker-claim <canonical-ref>` and require the provider skill's post-read verified `claimed|reused` result. A failed or inaccessible claim blocks the flow.
- **Bind before durable work:** only after the verified claim, run:

  ```bash
  node scripts/lisa-work-item.mjs bind <canonical-ref>
  ```

  Require a successful readback of that worktree-local binding. On detached HEAD, `branch: null` is the expected pending binding; after branch creation the mandatory `attach-branch` step below must replace it before any commit. Tracker or binding failure stops the flow; never continue untracked.
- Return the full resolved work-item context plus `tracker_provider`, canonical `work_item_ref`, resolution outcome, claim outcome, and verified binding to the team lead, who then proceeds to roster selection.

The input resolver may perform these tracker and local-binding operations before the Roster Decision because they are the mandatory gate that establishes what work the team is allowed to do. No project source, documentation, plan artifact, branch, or task may be created or changed before this transaction succeeds. Read-only discussion/orientation outside an Implement flow remains exempt per the `tracked-work` rule.

The input resolver is the only teammate that may be spawned before the Roster Decision exists. After it returns the resolved input, do not spawn any lifecycle, research, implementation, review, verification, or learning teammate until the Roster Decision has been recorded.

**Rejection evidence in the claim handoff.** When this flow was dispatched from a build-intake claim that classified the item as a `rejection-reclaim` (per the `rejection-detection` rule), the context bundle carries a **rejection evidence summary** (what was rejected, the defect the QA comment named, the approach named as wrong). The plan MUST explicitly address that rejection evidence and MUST NOT re-propose the specific approach the rejection named as wrong — a bounced item must come back fixed, not re-bounced. `lisa-implement` cannot fetch this itself (it never sees the claim); it consumes what the handoff carries. Absence of rejection evidence never blocks — plan and implement normally.

## Select the agent roster

Before spawning any teammate beyond the bounded input resolver, record a **Roster Decision** artifact. It must enumerate every agent or specialist type exposed by the current runtime's delegation tool and record one line per type:

```text
INCLUDE|EXCLUDE - <agent type> - <one-sentence reason>
```

Review all available agent types listed in the current runtime's delegation options. In Claude, this includes the Task tool's `subagent_type` options: built-in agents such as `Explore` and `general-purpose`, custom agents from `.claude/agents/`, and plugin agents from enabled plugins. In Codex, Cursor, Copilot, agy, OpenCode, or another runtime, use that runtime's tool-discovery and delegation surfaces to enumerate the equivalent available specialists. If the runtime exposes no specialist list, record that explicitly in the Roster Decision and justify the fallback agent type you will use.

Persist the Roster Decision where the flow can be audited later. Prefer task-list metadata `metadata.roster` when a task list exists; otherwise write `${LISA_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-.}}/.lisa/roster.md` or post the Roster Decision in the plan/tracker artifact the flow is already updating. The later verification/evidence step must reference the recorded artifact; absence of the artifact is a workflow failure.

Inclusion is the default. You MUST justify excluding an agent. Every team must include the Explore agent, or the runtime's nearest read-only search/research equivalent; if no equivalent exists, record that gap in the Roster Decision.

Do not spawn a teammate whose agent type is not included in the recorded Roster Decision. `general-purpose` is a fallback, not a default: using it requires an explicit INCLUDE line explaining why no more specific specialist fits or why the runtime exposes no specialist type. If the task changes enough that a different specialist is needed, update the Roster Decision before spawning that teammate.

When deciding the agents to use, consider:
* Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.
* Each task must be reviewed by the team to make sure their verification passes.
* Each task must have their learnings captured to the ledger by the learner subagent.

Using the general-purpose agent in Team Lead session, Determine the name of this plan

Using the general-purpose agent in Team Lead session, **determine the base branch from the ticket's target environment, then sync the working branch onto the latest of it before any work** — so implementation always builds on current target-environment code:

1. **Resolve the target environment with durable provenance.** The `## Target Backend Environment` value has this exact grammar: a human-confirmed value is either a bare configured key or `Confirmed: <env>`; automated evidence writes `Inferred: <env> — evidence: <title|body|reproduction|hostname>`; an automated fallback writes `Assumption: <env> — remote default branch <branch>` when the branch maps uniquely, or `Assumption: remote default branch <branch>` when it does not. Human confirmation replaces an automated annotation with the bare configured key or `Confirmed: <env>`. For a legacy bare value created before this grammar, use managed draft markers and current ticket content only — provider edit history is not required or assumed. A managed marker proves automation and requires rewriting to `Inferred:` or `Assumption:`; without a marker provenance is unknown, so the value may be used only when no conflicting evidence exists, and a conflict **stops for confirmation**.
   - A human-confirmed value wins. Otherwise a validated `Inferred:` value is next.
   - Otherwise inspect the human-authored title, body, and reproduction steps for exactly one unambiguous signal: an exact `deploy.branches` key as a complete token, or that key as a complete label in a URL hostname (`staging.<domain>`, `gql.staging.*`). Exclude the entire `Target Backend Environment` section and all other machine-authored metadata/draft blocks from this evidence scan so an `Inferred:` or `Assumption:` annotation can never validate or conflict with itself. Clear evidence may supersede only an `Assumption:` value, never a human-confirmed value.
   - The only normalization is built-in `prod` ↔ `production`, and only when exactly one of those keys exists in `deploy.branches`; normalize to that configured key. No other aliases exist.
   - Never infer from arbitrary branch text, URL paths or query strings, or substrings inside other words or hostname labels. Multiple conflicting signals after normalization **stop** the flow. If there are no signals, resolve the remote default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, or `git remote set-head origin -a` then `origin/HEAD`). When it reverse-maps uniquely, write the env-bearing `Assumption:` form; when the reverse-map is not unique, write the branch-only form and continue on the remote default without inventing an environment or blocking solely for that ambiguity. Record the fallback assumption in the plan/tracker artifact.
2. **Map the resolved environment to a base branch** through `.lisa.config.json` `deploy.branches` — the forward direction of the env-keyed `done` resolution. The selected exact configured key must map uniquely, and the mapped branch must exist on the remote. A missing/ambiguous mapping or remote branch **stops** the flow; never guess or silently fall back.
3. **Establish the feature branch off the latest base, conflict-free:**
   - `git fetch origin`.
   - Already on a feature branch with an **open PR** → reuse it. If the PR's base ≠ the resolved base branch, surface the mismatch and re-target only with confirmation — the ticket's environment is the source of truth.
   - Already on a feature branch with **no open PR** → reuse it; its PR base will be the resolved base branch (do not ask the human — the environment determines it).
   - On an **environment / default branch** → check out a feature branch named for this plan (with the work-item ref prefix, per the linkage rules below) **from `origin/<base>`**.
   - **Rebase the feature branch onto `origin/<base>` and resolve any merge conflicts BEFORE starting work.** If the conflicts cannot be resolved cleanly and safely, create a fix task for the agent team (with the conflicting file list and current merge state) and resolve it before implementation begins — never start work on stale or conflicted code.
4. **The PR targets the resolved base branch** — carry it as `target_branch=<base>` into `lisa-git-submit-pr` (Verify flow). `git-submit-pr` already chooses a closing keyword when the base is the production/default branch and a non-closing reference for a non-terminal environment branch. For a bug fixed on a non-integration environment branch, the current flow is not done until the fix is merged and verified there, then forward cherry-picked down to the integration branch via a linked follow-up.

Every Implement run now has a tracker work item. Preserve its canonical identifier for development linkage unconditionally:

- Capture `tracker_provider` and `work_item_ref` from the tracked input before creating or reusing a branch. Examples: `github` + `CodySwannGT/lisa#614`, `linear` + `ENG-123`, `jira` + `ENG-123`. Missing linkage is a workflow failure, never an optional/no-ticket mode.
- If a new branch is needed and the provider can link branches by identifier, include the identifier in the branch name before the human-readable slug. Linear and JIRA integrations commonly link from branch names; GitHub issue linkage is PR-body driven, but including the issue number in the branch name is still useful. Keep branch names URL-safe, for example `codex/ENG-123-add-checkout-copy` or `codex/614-add-checkout-copy`.
- After the feature branch exists, run `node scripts/lisa-work-item.mjs attach-branch` so the worktree-local binding records the actual branch without treating the branch name as authority.
- Pass the work-item ref and target branch to `lisa-git-submit-pr` when opening or updating the PR, for example `work_item_ref=CodySwannGT/lisa#614 target_branch=<base resolved from the ticket's environment above>` (not hardcoded `main`). The PR workflow owns provider-specific body text and must decide whether to use a closing keyword or a non-closing reference.
- After `lisa-git-submit-pr` returns a PR URL, ensure the reverse backlink is present on the source work item by running `lisa-tracker-sync <work_item_ref> pr-ready pr_url=<url> tracker_provider=<provider>`. The sync path must prefer native provider linkage and fall back to one managed `[lisa-pr-link]` comment when native linkage is unavailable or cannot be verified.
- If the provider has no native branch or PR development-linkage surface, the managed `[lisa-pr-link]` fallback is required; never continue without proven ticket-side linkage.

Using the general-purpose agent in Team Lead session, Determine which flow applies:
1. Research -- needs a PRD (no specification exists)
2. Plan -- needs decomposition (specification exists but no work items)
3. Implement -- has a well-defined work item
4. Verify -- has code ready to ship

If Implement, determine the work type:
1. Build (feature, story, task)
2. Fix (bug -- mandatory Reproduce sub-flow before investigation)
3. Improve (refactoring, optimization, coverage improvement)
4. Investigate Only (spike -- no code changes, just findings)

Run the readiness gate check for the selected flow as defined in the `intent-routing` rule (loaded via the lisa plugin). If the gate fails, stop and report what is missing.

IF it is a Fix (bug), execute the Reproduce sub-flow FIRST:
1. Write a failing test that demonstrates the bug (preferred)
2. If a failing test is not possible, write a minimal reproduction script
3. Verify the reproduction is reliable (consistent failure)
4. The reproduction MUST succeed before any investigation or fix attempt begins
5. Examples of reproduction methods:
   1. Write a simple API client and call the offending API
   2. Start the server on localhost and use the Playwright CLI or Chrome DevTools

For any Fix flow, and for any Build flow that changes user-visible behavior, regression coverage is a required deliverable at the highest practical observation level for the reported surface. If the project has a browser, device, or end-to-end harness for that platform (for example Playwright, Maestro, Detox, Cypress, or an equivalent runtime), the task plan and definition of done MUST include a deterministic regression spec against the reported surface, using mocked or seeded data where needed. This is alongside unit or integration coverage, not a substitute for it. For frontend work this deliverable is **dual-runner** whenever the project supports more than one UI runner: a Playwright spec in the Playwright test runner AND a Maestro flow in the Maestro test runner when the project supports Maestro (`.maestro/` directory, `maestro:test` script, or Maestro CI workflow) — both encoding the same verified journey; neither substitutes for the other (see "Frontend dual-runner codification" in `codify-verification`).

The team lead may not waive, defer, demote, or phrase this regression spec as "optional", "if cheap", "nice to have", or equivalent. The only permitted exits are:

1. The project genuinely has no end-to-end harness for the affected platform; record the checked locations and that absence in the task metadata, PR, and work-item evidence.
2. A genuine technical blocker prevents adding or executing the spec in this PR; before merge, create a linked build-ready follow-up ticket, reference it from the PR and source work item, and keep the current item blocked or explicitly non-terminal until that follow-up is accepted.

Completion evidence for the regression spec must prove execution, not mere existence. A green CI run is insufficient unless the PR evidence includes a CI log line, reporter output, or equivalent record naming the new spec and showing that it ran and passed. Guard explicitly against `test.skip`, suite-level environment gates, shard filters, and "0 tests" passes.

If the required regression spec is still in flight on an auto-merge-enabled PR, pause auto-merge or use an equivalent merge gate until the spec commit is pushed and its execution proof is available. The flow must not allow the PR to merge before this non-demotable deliverable is satisfied or formally blocked through the linked follow-up path above.

Using the general-purpose agent in Team Lead session, determine how you will know that the task is fully complete. Write this as an **effective completion condition** — one an independent verifier could confirm from observed output alone, not from your assertion that it works. A strong condition has:

- **One measurable end state** — a status code, an exit code, a row count, an observable UI state, an empty queue. Not "it looks right" or "the code is correct".
- **A stated proof command that surfaces the evidence** — exactly how the running system is exercised so the result is observable (e.g. `curl … returns 200 with {…}`, "the Playwright run reaches the dashboard", "`SELECT … ` returns the new row"). Quality gates (test/typecheck/lint) do NOT count — they are prerequisites.
- **Constraints that must hold** — anything that must not change on the way there (e.g. "no other endpoint's response changes", "no migration is dropped").

This condition is the contract the Verify flow proves and records in the verification verdict (below); it is what the completion gate checks before the flow may stop.

1. Examples
   1. Direct deploy the changes to dev and then Write a simple API client and call the offending API
   2. Start the server on localhost and then Use the Playwright CLI or Chrome DevTools

Using the general-purpose agent in Team Lead session, run the **tool access preflight** per the `tool-access-gate` rule (loaded via the lisa plugin) before any implementation task is created or started:

1. Enumerate every external tool or system this flow will need — for the implementation itself, for the proof command, and for remote verification (AWS CLI/CloudWatch, Figma, Jam, Sentry, SonarCloud, PostHog, device/browser harnesses, databases, deploy targets, trackers, …). Derive the list from the resolved work item (a linked Figma file, Jam capture, or Sentry issue implies that tool), the acceptance criteria, the testing requirements, and the completion condition above.
2. Prove access to each with its cheapest read-only probe, routing through the matching `*-access` skill where one exists (`integration-access-layer` rule). Tool presence on PATH is not access; a probe failure counts only after exhausting the documented credential sources (project e2e config/fixtures, `.lisa.config.local.json` / env vars, documented work-item credentials).
3. Record the enumeration and probe results in the plan artifact and in each task's `metadata.required_access`.
4. If any required tool fails its probe, do NOT start implementation — follow the break-out protocol in the `tool-access-gate` rule: post an "Access Needed" comment on the work item (plain-English summary, the exact credential/role/env var to grant, the probe that must pass), transition the item to the configured blocked state with the `human_needed` marker, write the verification verdict with `status: "blocked"`, and stop. Working around missing access — substituting weaker verification, mocking the inaccessible system, guessing at tool contents, or narrowing scope — is never permitted, for any tool.

The same gate applies **continuously**: if a tool requirement surfaces mid-flow (e.g. verification turns out to need CloudWatch log capture the runtime cannot authenticate to), probe it the moment it is discovered, record the new tool and probe result in the plan artifact and the affected tasks' `metadata.required_access` before continuing, and break out identically on failure.

Using the general-purpose agent in Team Lead session, create tasks needed to complete the request.

Every task MUST include this JSON metadata block. Do NOT omit `skills` (use `[]` if none), `learnings` (use `[]` if none), `required_access` (use `[]` if the task needs no external tool) or `verification`.

```json
{
  "plan": "<plan-name>",
  "type": "spike|bug|task|epic|story",
  "acceptance_criteria": ["..."],
  "relevant_documentation": "",
  "testing_requirements": ["..."],
  "skills": ["..."],
  "learnings": [{ "kind": "mistake", "note": "one line", "evidence": "optional ref" }],
  "required_access": [
    { "tool": "<external tool/system this task or its verification needs>", "probe": "<the read-only command or *-access check that proves access>", "status": "pass|fail" }
  ],
  "verification": {
    "type": "ui-recording|api-test|cli-test|database-check|manual-check|documentation",
    "command": "the proof command — must run the actual system and surface its result in the transcript (NOT test/typecheck/lint, those are quality gates). Phrase it so an independent verifier sees the evidence, e.g. `curl -s localhost:3000/health` not `check that health works`",
    "expected": "the single measurable end state that proves success — observable system behavior (status code, response body, row count, UI state), not a subjective judgement"
  }
}
```

The `learnings` array is task-end MLD telemetry (Mistakes / Learnings / Desires) — a low-trust self-report for the harness builder, never instructions for a later agent. Each entry is either a plain string (treated as kind `learning` for backward compatibility with older flows) or an object, exactly like the example entry in the block above: a `kind` of `mistake`, `learning`, or `desire`; a one-line `note`; and an optional `evidence` pointer. A `mistake` is an error in the agent's own trajectory, a `learning` is an environment fact discovered the hard way, a `desire` is context or tooling the agent wished it had. Keep each to one line — no essays. `mistake`/`learning` entries are ledger candidates; `desire` entries are tooling-gap candidates that the learner (#1731) records for the gardener's human-gated tooling-gap lane.

Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.

For Fix tasks and user-visible Build tasks, `testing_requirements` must include the highest-practical-observation regression requirement above, including the selected harness or the recorded absence/blocker path. The completion condition must include the proof command and the required CI execution evidence for the new spec.

Each task must be reviewed by the team to make sure their verification passes.

Before marking a task complete, the implementing agent records concise MLD into `metadata.learnings` — mistakes (errors in its own trajectory), learnings (environment facts it discovered the hard way), and desires (context or tools it wished it had). Empty (`learnings: []`) is a valid result: never re-prompt for content, and never grade or score self-reports — a scored MLD would reward plausible self-commentary over good outcomes.

Each task must have their learnings captured to the ledger by the learner subagent.

## Implement valid suggestions

When review, CodeRabbit, local-review, product, quality, security, or specialist
feedback arrives, apply the `convergent-review` rule before changing code:

1. Normalize each finding into severity, blocking yes/no, concrete failure
   scenario, evidence, and proposed smallest fix.
2. Treat a blocker with no concrete correctness, security, data-loss, or
   contract-violation scenario as malformed. Reply with the missing-evidence
   reason and handle it as non-blocking.
3. Resolve each finding with one disposition:
   - `fixed`: make the smallest code, test, docs, or generated-artifact change
     that removes the failure scenario.
   - `deferred`: record why the issue is real but non-blocking, and file or link
     follow-up work when useful.
   - `pushed-back`: cite the evidence, scope boundary, or repository rule that
     refutes the finding.
4. If a reviewer cannot refute a pushback with fresh evidence, the author's
   disposition stands.
5. After the suggestion-implementation task completes and required gates pass,
   do not reopen review unless new evidence appears: a relevant new commit, a
   failed gate, a newly cited failure scenario, or a scope change.
6. If a blocking disagreement remains irreconcilable, stop the review loop:
   move the work item to the configured blocked state, add `human-needed` when
   the decision is human-only, and summarize both positions in plain language.

Before shutting down the team, execute the Verify flow:

1. Run quality gates: lint, typecheck, tests — all must pass. These are prerequisites, NOT verification.
2. `verification-specialist`: verify locally by running the actual system and observing results (empirical proof that the change works). This is the real verification step. For UI-surface bugs, the proof must observe the UI surface with browser/device automation against the target environment whenever such a harness exists; unit-level or API-only proof cannot satisfy the empirical verification contract for a UI-surface defect.
2a. **Record the verification verdict** — the independent, machine-readable proof that gates completion. The `verification-specialist` writes `${CLAUDE_PROJECT_DIR:-.}/.lisa/verification-status.json` in **schema v2**, which binds every claim to the *boundary* it asserts and to the evidence *kinds* that reach that boundary, per the `claim-evidence-mapping` rule:

    ```json
    {
      "schema_version": 2,
      "plan": "<plan-name>",
      "artifact": {
        "repository": "<owner/repo>", "base_sha": "<sha>", "head_sha": "<sha of what will ship>",
        "build_id": "<build/run id>", "environment": "<where it was observed>", "observed_at": "<ISO8601 UTC>"
      },
      "claims": [
        {
          "claim_id": "AC-1",
          "statement": "<the claim, in the operator's language>",
          "boundary": "code-unit | browser | http-api | cli | data | deploy-health | performance | standards-compat",
          "required_for_gate": true,
          "required_evidence_kinds": ["<kinds that reach this boundary, e.g. screenshot, recording>"],
          "status": "established | not-established",
          "evidence_refs": ["EV-1"],
          "not_established": ["<what this claim does NOT cover>"]
        }
      ],
      "evidence": [
        {
          "evidence_id": "EV-1",
          "kind": "screenshot | recording | http-transcript | cli-output | log-snippet | db-query-output | perf-trace | test-run-log | deploy-log | state-dump",
          "locator": "evidence/<ticket>/<file>", "sha256": "<hash>",
          "captured_at": "<ISO8601 UTC>", "artifact_head_sha": "<sha the artifact was captured at>"
        }
      ],
      "not_established_reviewed": true,
      "criteria": [
        { "task": "<task id or title>", "criterion": "<the completion condition>", "status": "pass | fail | blocked", "evidence": "<the proof command run and the observed result; for a blocked criterion, the blocker diagnosis (e.g. the missing access and the probe that must pass)>" }
      ],
      "status": "pass | fail | blocked | in_progress",
      "updated_at": "<ISO8601 UTC>"
    }
    ```

    Rules for v2: a claim is established **only** by evidence whose `kind` reaches its `boundary` — a unit `test-run-log` reaches only `code-unit` and can never establish a `browser`, `http-api`, or `deploy-health` claim. `not_established_reviewed` must always be present (the `not_established` list may be empty, but the flag may never be omitted). `artifact.head_sha` names what will ship, and each evidence entry's `artifact_head_sha` must match it. The legacy `criteria[]` array is retained and still read, but under v2 it is **display-only** — it can never establish a v2 claim.

    **v1 is still accepted during the compatibility window.** A verdict that omits `schema_version` (or sets it to `1`) carries only `plan` / `status` / `criteria[]` / `updated_at` and is judged exactly as before: terminal `status` plus no failing criterion plus freshness. Write v2 for new work; nothing in flight breaks.

    Set `status: "pass"` only when every criterion is `pass` with real evidence (output from running the system, not a claim). The verdict must be judged by an agent that did NOT implement the change (the `verification-specialist`), never self-certified by the implementer. This is runtime scratch — it is gitignored and MUST NOT be committed (treat it like the secrets exclusion in the commit step).

    On Claude, the `enforce-verification-gate.sh` Stop hook reads this file — both v1 and v2 — and **will not let the flow stop** until it shows a terminal, all-`pass` verdict. The v2 claim/evidence checks are **advisory-first**: a boundary or identity violation is reported to stderr but does not block until `verification.gate.enforceBoundaries` is set to `true` in `.lisa.config.json` (default `false`, promoted via the threshold ratchet). Treat an advisory warning as a defect to fix now, not a warning to ignore — it becomes blocking on the ratchet. The gate — carrying over the non-bypassable completion gate of the `/goal` primitive, but checked deterministically against real evidence rather than by a transcript-only evaluator model. If you must stop before completion, write the verdict with `status: "blocked"` and the reason — marking each criterion whose proof is blocked as `status: "blocked"` with the blocker diagnosis as its `evidence`, while unaffected criteria keep their real `pass`/`fail` result — that records the outcome and releases the gate instead of leaving it to spin. But a `blocked` verdict is a last resort, not a shortcut around fillable work: **first resolve every gap you can resolve yourself.** If the work item is thin — missing its Validation Journey, acceptance criteria, or other derivable detail — enrich it: derive the missing detail from the ticket context and the codebase, write it back, and proceed. Do **not** block on a gap you could have filled. Only a blocker that survives that attempt is real, and it is one of two kinds:

    - **Actionable blocker** — an unresolved dependency or fixable technical gap that some team or repository could build (a missing or changed schema field, an unbuilt sibling work item, a required upstream fix), **including cross-repo dependencies**. Before writing the blocked verdict you MUST (1) file a build-ready fix/dependency ticket capturing the diagnosis — in the dependency's own repository/tracker when it is cross-repo (e.g. a `[<repo>] …` ticket in the shared project, or the sibling tracker) — and (2) link the current work item to it as `is blocked by`. Only then write the verdict. This is the same discipline as the regression-spec blocker and the remote-verification-fail exits above, and it is what makes the block machine-recoverable: `repair-intake` re-dispatches a blocked item once its linked `is blocked by` dependency closes, but it cannot act on a prose-only comment. Recommending the ticket "as a human follow-up" without filing and linking it is **not** a permitted exit.
    - **Human-only blocker** — an input the agent genuinely cannot obtain or produce no matter what it does: credentials, secrets, or **tool access** it does not have (AWS/CloudWatch, Figma, Jam, Sentry, SonarCloud, a database, a protected deploy target, …), or a product/design decision only a human can make. For missing tool access, follow the `tool-access-gate` rule's break-out protocol: post the "Access Needed" comment naming the exact credential/role/env var to grant and the probe that must pass — never work around the gap by substituting weaker verification, mocking the inaccessible system, or narrowing scope. Record the blocked verdict, mark it `human_needed` (the marker `repair-intake` recognizes, so it won't churn re-dispatching it), and surface or reassign to a human; do **not** fabricate a build-ready ticket, because there is no build-ready work.

    **Harnesses that do not fire a Stop hook enforce the same discipline by convention.** The
    `enforce-verification-gate.sh` Stop hook is a **Claude-only** surface — Codex, Cursor, Antigravity,
    Copilot, and OpenCode carry the skills, agents, and (where the runtime has a rules surface) the
    `claim-evidence-mapping` rule, but nothing on those runtimes can refuse to stop. That is a known
    **representation gap**, documented here rather than dropped: on those harnesses this prose gate
    *is* the gate, and the flow may not declare completion until it has written the same v2 verdict
    and self-checked it against the same expectations the hook would have applied:

    - `schema_version: 2` is written, with `plan`, `status`, and `updated_at` terminal and fresh.
    - Every claim carries a `claim_id`, a `boundary` from the closed set, and the
      `required_evidence_kinds` that reach that boundary — and its `evidence_refs` resolve to evidence
      whose `kind` is one of them. A unit `test-run-log` cited for a `browser`, `http-api`, or
      `deploy-health` claim is the failure this check exists to catch.
    - `artifact.head_sha` names what will ship, and every evidence entry's `artifact_head_sha` matches
      it, with a `sha256` digest and `captured_at` recorded as values, never placeholders.
    - The `not_established` list is present on every claim and `not_established_reviewed` is `true` —
      an empty list is fine, an omitted flag is not.

    Record the self-check in the completion summary the way the hook would have reported it: name the
    boundary each claim reached, or name the violation. Where the runtime lacks the rules surface (the
    agy artifacts carry no rules tree), the obligation still travels in this skill — cite the
    `claim-evidence-mapping` contract by slug and continue; never block on the absent surface.
3. Write the highest-practical-observation regression test encoding the verification. For user-visible bugs or user-visible Build changes with an available browser/device/e2e harness, this means a deterministic spec on the reported surface — and for frontend work, once the validation journey is verified, codification into **every supported UI runner**: a Playwright spec in the Playwright runner AND a Maestro flow when the project supports Maestro, per `codify-verification`. Prove the new spec actually executed and passed in PR CI by recording a named spec log/reporter line or equivalent execution record; green CI without that named evidence does not satisfy this step.
4. Record Implement usage on the originating work artifact via `lisa-usage-accounting` so the work item (or other implementation-owned artifact) gains a direct `lisa-implement` usage entry in the canonical `## Lisa Usage` section. If the parent / child graph is already known, prefer `record_and_rollup` so ancestor totals refresh in the same write; otherwise still write the direct entry, and if runtime usage is unavailable, use `source: unavailable` with nullable token/cost fields instead of skipping the row.
5. Commit ALL outstanding changes in logical batches on the branch (minus sensitive data/information) — not just changes made by the agent team. This includes pre-existing uncommitted changes that were on the branch before the plan started. Do NOT filter commits to only "task-related" files. If it shows up in git status, it gets committed (unless it contains secrets).
6. Push the changes - if any pre-push hook blocks you, create a task for the agent team to fix the error/problem whether it was pre-existing or not
7. Open a pull request with auto-merge on via `lisa-git-submit-pr`, targeting the **base branch resolved from the ticket's environment** (`target_branch=<base>`, per the branch step above), and including the mandatory work-item ref so the PR can be linked natively to the source issue.
7a. Confirm two-way linkage before treating PR submission as complete: the PR body/title/branch must reference the work item, and the work item must have either a verified native PR link or a single managed `[lisa-pr-link]` fallback comment from `lisa-tracker-sync`.
8. PR Watch Loop: Drive the PR to merge via the `drive-pr-to-merge` skill — the single source of truth for clearing every blocker (auto-merge with direct-merge fallback, `BEHIND` re-sync, conflict resolution, failing-check fixes, human + bot review-comment handling with thread resolution, stale `CHANGES_REQUESTED` dismissal, and post-merge ancestry verification). `git-submit-pr` already invokes it; if you reach this step with a PR already open, invoke `drive-pr-to-merge` directly with the PR number. For a large review backlog you may fan the code-fix work out to the agent team, but `drive-pr-to-merge` owns the loop and the terminal conditions — do not re-implement them.
9. Merge the PR, then refresh the ticket-side backlink with `lisa-tracker-sync <work_item_ref> pr-merged pr_url=<url> merge_sha=<sha> tracker_provider=<provider>`.
10. Monitor the deploy action that triggers automatically from the successful merge
11. If deploy fails, create a task for the agent team to fix the failure, open a new PR and then go back to step 7
12. Remote verification: `verification-specialist` verifies in target environment (same checks as local verification, but on remote), and refreshes the verdict (step 2a) to reflect the remote result.
13. `ops-specialist`: post-deploy health check, monitor for errors in first minutes
14. If remote verification fails, create a task for the agent team to find out why it failed, fix it and return to step 5. **Bound this loop**: after a small number of full fix→deploy→reverify cycles without reaching a passing remote verdict (treat ~3 as the ceiling unless the work item states otherwise), stop retrying — file a build-ready fix ticket, write the verdict with `status: "blocked"` and the diagnosis, and move the work item to blocked rather than looping indefinitely. The completion gate releases on a `blocked` verdict, so the flow ends with a recorded outcome instead of a silent spin or a self-declared success.
15. After true terminal completion — required merge/deploy/verification passed, usage/evidence and two-way PR linkage are recorded, and the work item is terminal — run `node scripts/lisa-work-item.mjs clear` and verify the worktree has no current binding. Do not clear on an interruption or blocked outcome; preserving the binding is what keeps resumed work attributable.

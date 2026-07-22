# Empirical Verification

This repository supports AI agents as first-class contributors.

This file is the operational contract that defines how agents plan work, execute changes, verify outcomes, and escalate when blocked.

If anything here conflicts with other repo docs, treat this file as authoritative for agent behavior.

---

## Core Principle

Agents must close the loop between code changes and observable system behavior.

No agent may claim success without evidence from runtime verification.

Never assume something works because the code "looks correct." Run a command, observe the output, compare to expected result.

**Verification is not linting, typechecking, or testing.** Those are **quality checks** — prerequisites that must pass before verification begins, but they are NOT verification themselves. Running `bun run test`, `bun run typecheck`, `bun run lint`, or `bun run format` is a quality check. Verification is using the resulting software the way a user would — interacting with the UI, calling the API, running the CLI command, observing the behavior. Tests pass in isolation; verification proves the system works as a whole.

**If all you did was run tests, typecheck, and lint — you have NOT verified.** You have only confirmed quality checks pass. Verification requires running the actual system and observing the results: making HTTP requests, clicking through the UI, executing CLI commands, querying the database, or otherwise interacting with the running software as an end user would.

### Browser-controller neutrality

For UI work, the agent must control a live browser and use the product the way a human would: navigate, click, type, submit, and observe the rendered result. **The browser controller is an implementation detail.** An in-app Browser/Chrome tool, interactive Playwright control (MCP, API, or an ad hoc script), CDP, computer use, the optional Lisa-owned Kane CLI adapter, or an equivalent controller is valid when it drives a real browser session and captures the declared runtime artifacts. Do not block solely because a preferred browser backend is unavailable while another capable interactive controller is available.

Kane is a guarded provider, not a global browser override. It is eligible only when the project explicitly enables it, acknowledges TestMu cloud upload, pins Lisa's contract-tested version, selects an allow-listed non-production environment, and resolves mutation policy `full`; `lisa kane probe` must prove installation, authentication, Test Manager targeting, and usable credits before a factory starts. Invoke it only through `lisa-kane-browser`. Treat auth, Chrome, upload, schema, and control-plane failures as tooling failures. Persist the local evidence pack through Lisa's evidence pipeline because a Test Manager share link is secondary and expiring.

Running an automated Playwright or Maestro test is still a quality gate, **not the initial empirical verification evidence**. The distinction is how the browser is used, not the library name: interactive Playwright control or a guarded Kane objective that performs and observes the Validation Journey is valid empirical verification; invoking a prewritten test and reporting its green result alone is not. After the live journey passes, codify that observed behavior in the project's Playwright and/or Maestro runner as required below so CI can prevent regressions. Kane `_test.md`, code export, and auto-healed recordings are not authoritative substitutes during the initial rollout.

Verification is mandatory. Never skip it, defer it, or claim it was unnecessary. Every task must be verified before claiming completion.

Before starting implementation, state your verification plan — how you will use the resulting software to prove it works. A verification plan that only lists test/typecheck/lint commands is not a verification plan. Do not begin implementation until the plan is confirmed.

After verifying a change empirically, encode that verification as an automated regression test via the `codify-verification` skill. The manual proof that something works must become a repeatable test that catches future regressions — Playwright for UI/browser flows, integration test for API/DB/auth, benchmark for performance, etc. Codification is mandatory for every empirical verification type except the inherently non-behavioral ones (PR, Documentation, Deploy) and Investigate-Only spikes. If codification is genuinely impossible, escalate via the Escalation Protocol — never silently skip.

Every pull request must include step-by-step instructions for reviewers to independently replicate the verification. These are not test commands — they are the exact steps a human would follow to use the software and confirm the change works. If a reviewer cannot reproduce your verification from the PR description alone, the PR is incomplete.

---

## Roles

### Builder Agent

Implements the change in code and infrastructure.

### Verifier Agent

Acts as the end user (human user, API client, operator, attacker, or system) and produces proof artifacts.

Verifier Agent must be independent from Builder Agent when possible.

### Human Overseer

Approves risky operations, security boundary crossings, and any work the agents cannot fully verify.

---

## Verification Levels

Agents must label every task outcome with exactly one of these:

- **FULLY VERIFIED**: Verified in the target environment with end-user simulation and captured artifacts.
- **PARTIALLY VERIFIED**: Verified in a lower-fidelity environment or with incomplete surfaces, with explicit gaps documented.
- **UNVERIFIED**: Verification blocked, human action required, no claim of correctness permitted.

---

## Quality Gates (Prerequisites)

These are NOT verification. They are prerequisites that must pass before verification begins. Running these does not constitute verification — it only confirms code quality.

| Gate | What to prove | Acceptable proof |
|------|---------------|------------------|
| **Test** | Unit and integration tests pass for all changed code paths | Test runner output showing all relevant tests green with no skips |
| **Type Safety** | No type errors introduced by the change | Type checker exits clean on the full project |
| **Lint/Format** | Code meets project style and quality rules | Linter and formatter exit clean on changed files |

Quality gates are enforced automatically by the self-correction loop (hooks, pre-commit, pre-push). Passing all quality gates is necessary but NOT sufficient — you must still verify empirically.

---

## Verification Types

Every change requires one or more verification types. Classify the change first, then verify each applicable type by **running the actual system and observing results**.

| Type | When it applies | What to prove | Acceptable proof |
|------|----------------|---------------|------------------|
| **UI** | Change affects user-visible interface | Feature renders correctly and interactions work as expected | Automated session recording or screenshots showing correct states; for cross-platform changes, evidence from each platform or explicit gap documentation |
| **API** | Change affects HTTP/GraphQL/RPC endpoints | Endpoint returns correct status, headers, and body for success and error cases | Request/response capture showing schema and data match expectations |
| **Database** | Change involves schema, migrations, or queries | Schema is correct after migration; data integrity is maintained | Query output showing expected schema and data state |
| **Auth** | Change affects authentication or authorization | Correct access for allowed roles; rejection for disallowed roles | Request traces showing enforcement across at least two roles |
| **Security** | Change involves input handling, secrets, or attack surfaces | Exploit is prevented; safe handling is enforced | Reproduction of attack pre-fix failing post-fix, or evidence of sanitization/rejection |
| **Performance** | Change claims performance improvement or affects hot paths | Measurable improvement in latency, throughput, or resource usage | Before/after benchmarks with methodology documented |
| **Infrastructure** | Change affects deployment, scaling, or cloud resources | Resources are created/updated correctly; system is stable | Infrastructure state output showing expected configuration; stability metrics during transition |
| **Observability** | Change affects logging, metrics, or tracing | Events are emitted with correct structure and correlation | Log or metric output showing expected entries with correlation IDs |
| **Background Jobs** | Change affects queues, workers, or scheduled tasks | Job enqueues, processes, and reaches terminal state correctly | Evidence of enqueue, processing, and final state; idempotency check when relevant |
| **Configuration** | Change affects config files, feature flags, or environment variables | Configuration is loaded and applied correctly at runtime | Application output showing the configuration taking effect |
| **Documentation** | Change affects documentation content or structure | Documentation is accurate and matches implementation | Content inspection confirming accuracy against actual behavior |
| **Cache** | Change affects caching behavior or invalidation | Cache hits, misses, and invalidation work as expected | Evidence of cache behavior (hit/miss logs, TTL verification, key inspection) |
| **Email/Notification** | Change affects outbound messages | Message is sent with correct content to correct recipient | Captured message content or delivery log showing expected output |
| **PR** | Shipping code (always applies when opening a PR) | PR includes goal summary, verification level, proof artifacts, and reproduction steps | PR description containing all required sections |
| **Deploy** | Shipping code to an environment | Deployment completes and application is healthy in the target environment | Deployment output and health check evidence from the target environment |

---

## Per-Work-Unit Evidence Contract

Every **leaf work unit** — an individually implementable ticket with no child tickets (issue types Bug, Task, Sub-task, Improvement) — that changes runtime behavior must declare, at creation time, the exact evidence that proves it is done. Epics, Stories, and Spikes are coordination containers, not work units: their evidence is the rollup of their children, so this contract does not apply to them.

The declaration is not a separate field — it is the set of `[EVIDENCE: <artifact-type>: <name>]` markers in the work unit's **Validation Journey**. Those markers are the work unit's **evidence manifest**: an enumerated, typed list of the artifacts a verifier must capture. The manifest binds both ends of the ticket lifecycle:

- **At creation** — the work unit cannot be written without a Validation Journey that declares at least one typed `[EVIDENCE: <artifact-type>: <name>]` artifact (enforced by gate S14 in `tracker-validate` and the vendor `*-validate-*` skills). A behavior-changing unit should declare both a success artifact and an error/edge artifact.
- **At completion** — the work unit cannot be marked complete, nor transitioned to its review/Done state, until every marker in its manifest has a captured, non-empty artifact **of the declared type** attached to the ticket (enforced by the Task Completion Rules and Definition of Done in `verification-lifecycle`, and by the evidence-manifest gate in `tracker-evidence`). A manifest with a missing, empty, or wrong-type artifact blocks completion exactly like a failed verification.

### Marker grammar: the type is the evidence

**A marker names an artifact, not an assertion.** `[EVIDENCE: load-failure-handled-gracefully]` is a claim — there is nothing to capture, so it degenerates into a checkbox someone ticks. Evidence is empirical: a screenshot, a curl transcript, a log snippet, a frame-timing trace. The marker therefore carries two parts:

```text
[EVIDENCE: <artifact-type>: <kebab-case-name>]
```

- `<artifact-type>` — HOW the proof is captured, from the fixed taxonomy below.
- `<kebab-case-name>` — WHAT it proves, unique within the ticket.

Example transformation (the failure mode this grammar exists to prevent):

| Assertion label (invalid) | Typed artifact (valid) |
|---|---|
| `[EVIDENCE: pipeline-load-under-3s]` | `[EVIDENCE: perf-trace: pipeline-load-tti]` |
| `[EVIDENCE: long-column-virtualized]` | `[EVIDENCE: perf-trace: long-column-frame-timing]` |
| `[EVIDENCE: load-failure-handled-gracefully]` | `[EVIDENCE: screenshot: load-failure-error-state]` |

### Artifact-type taxonomy (fixed set)

| Type | The captured artifact is |
|---|---|
| `screenshot` | an image of the observed UI/state (Playwright, simulator, device) |
| `recording` | a video of the playthrough |
| `http-transcript` | the exact request (curl command or client call) plus the full response — status, headers of interest, body |
| `cli-output` | the command plus its stdout/stderr and exit code |
| `log-snippet` | correlated log lines captured from the running system |
| `db-query-output` | the query plus the returned rows |
| `perf-trace` | benchmark / frame-timing / profiler output, with the methodology (device profile, dataset size) noted |
| `test-run-log` | reporter output naming the spec and showing it ran and passed |
| `deploy-log` | deployment output or a health-check response from the target environment |
| `state-dump` | machine-readable observed state (e.g. the `state.json` asserted against) |

Do not invent types inline; if none fits, propose extending this table. The legacy `[SCREENSHOT: name]` marker is equivalent to `[EVIDENCE: screenshot: name]`.

The manifest is the single source of truth for "what evidence is required": authored once in the Validation Journey, enforced at write time, replayed during `tracker-journey` (which captures each artifact **in its declared type**), and checked again before the ticket closes. There is no second list to keep in sync.

### Every evidence surface names what it did NOT establish

An evidence comment that lists only what passed is unreadable at a gate: a journey that skipped an edge state looks exactly like one that covered it. So every evidence comment — and the committed `evidence/<ticket>/verdict.json` — carries two extra sections, defined in full by the `claim-evidence-mapping` rule:

- **Artifact identity** — what the evidence was collected against, as values rather than placeholders: the `repository`, the `head_sha` the run observed, the `environment`, and per artifact its `sha256` digest and `captured_at`. Defined in full by the `claim-evidence-mapping` rule.
- **Not established** — a **required, never-omitted** heading listing what the verification did *not* prove: boundaries not exercised, environments not tested, behavior consciously out of scope. When nothing is outstanding it still renders, reading `None outstanding — reviewed`. It is never blank.

The committed verdict carries the machine-readable half:

```
evidence/<ticket>/verdict.json
  not_established: []            # what was NOT proved; may be empty
  not_established_reviewed: true # attests the list was reviewed; may NEVER be omitted
  artifact: { repository, base_sha, head_sha, build_id, environment, observed_at }
  evidence: [ { evidence_id, kind, locator,
                artifact_head_sha,   # the head_sha in force when THIS artifact was captured
                sha256,              # content digest of the committed evidence file
                captured_at } ]
```

`artifact.head_sha` pins the build the verification observed; each entry's `sha256` pins the bytes. An entry whose `artifact_head_sha` differs from `artifact.head_sha` is an `artifact_mismatch` and a recomputed digest that disagrees is an `evidence_digest_mismatch` — each fails loudly, naming both SHAs or the evidence id, and blocks completion. At completion the pinned `head_sha` is reconciled against **the merged head** using the ancestry + deploy-run definition of "what shipped" that `lisa-drive-pr-to-merge` already owns (cite it; there is no second definition): pre-merge evidence counts only when its head is a parent of the merge, and on a merge-race mismatch verification re-runs against the merged head before completion is declared.

The list may be empty; the flag may not be missing. An absent `not_established_reviewed` is indistinguishable from nobody having asked the question, so the evidence-posting gate in `tracker-evidence` refuses the post, and the Stop-hook gate reports it as a v2 contract violation (advisory until `verification.gate.enforceBoundaries` is ratcheted on). This generalizes the required, never-empty `Known limits` field of `lisa-improve-harness` to every evidence surface.

The boundary each artifact type reaches — and therefore which claim a captured artifact can discharge — is the `claim-evidence-mapping` rule's taxonomy; the type table above is its evidence-kind source.

The verdict is read twice. The Claude-only `enforce-verification-gate.sh` Stop hook reads it to decide whether the flow may stop; `lisa-spec-conformance` (run by `spec-conformance-specialist` in the verification phase) reads it to decide whether each shipped requirement's proof actually reaches its boundary — a cited-evidence-boundary mismatch is a `BOUNDARY_MISMATCH` conformance finding there, caught alongside empirical verification rather than after it. On harnesses without a Stop hook, `lisa-implement`'s prose gate carries the same v2 expectations by convention. The whole system, operator-readable end to end, is written up as the Lisa wiki's **Bounded-Claims Evidence System** concept page (`wiki/concepts/bounded-claims-evidence-system.md` upstream).

### Cross-work-item evidence references are non-claiming

When prose needs to point at evidence declared by another work item, use the dedicated reference form:

```text
[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]
```

For example, `[EVIDENCE-REF: CodySwannGT/lisa#1548 | test-run-log: plugin-parity]` or `[EVIDENCE-REF: ENG-123 | screenshot: empty-state]`. The work-item reference must be a native, unambiguous tracker reference; the artifact type and name use the same taxonomy and kebab-case grammar as a manifest marker.

For compatibility with Lisa 2.223.0, validators and consumers also accept the legacy form `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` as a non-claiming pointer. Parse that legacy payload from the right: the final two colon-delimited fields are the fixed artifact type and kebab-case name, and everything before them is the non-empty tracker reference (which may itself contain `:` as part of a URL). Writers must never emit the legacy form; normalize it to the pipe form whenever editing the journey.

`EVIDENCE-REF` is a pointer only. It never adds an artifact to the current work item's manifest, never satisfies S14, never participates in marker-name uniqueness or duplicate checks, and is never captured or checked by journey, evidence-posting, or completion flows. Only the exact claiming prefix `[EVIDENCE: ...]` declares an obligation on the current work item (with the legacy `[SCREENSHOT: name]` form still treated as a local screenshot obligation). A runtime-changing leaf whose journey contains references but no local claiming marker still fails S14. Writers must use `EVIDENCE-REF` rather than quoting a sibling's `[EVIDENCE: ...]` marker, because quoted or code-formatted claiming markers still belong to the current work item.

---

## Local vs Remote Verification

Verification happens at two stages in the workflow:

- **Quality gates** (enforced automatically): Tests, typecheck, lint, and format run via hooks at write-time, commit-time, and push-time. These are prerequisites, not verification.
- **Local verification** (part of the Implement flow): After quality gates pass, empirically verify the change by running the actual system in a local or preview environment — make HTTP requests, interact with the UI, execute CLI commands, query the database. This proves the change works before shipping. After local verification succeeds, invoke `codify-verification` to encode it as a regression test (Playwright for UI, integration test for API/DB/auth, benchmark for performance, etc.) and commit the test in the same PR.
- **Remote verification** (part of the Verify flow): After the PR is merged and deployed, repeat the same empirical verification against the target environment. This proves the change works in production, not just locally. If remote verification fails, fix and re-deploy.

Both levels use the same verification types table above. The difference is the environment, not the rigor.

---

## Credential-Gated Verification

Some runtime verification requires signing in to a deployed or local app. Agents must exhaust credential sources before declaring verification blocked:

1. Project e2e / Playwright config and fixtures, including files such as `e2e/constants.ts`, `e2e/fixtures/api-login.ts`, seeded test users, and OTP-bypass patterns such as `555555`.
2. `.lisa.config.local.json` and environment variables.
3. Documented ticket credentials, including a `Sign-in Required` or equivalent section in the issue, ticket, PRD, or linked implementation notes.

If credentials are genuinely unavailable after all three source classes are checked, the item is blocked, not done. The agent must post a tracker comment explaining what could not be verified and which sources were checked, transition the item to the configured blocked state, and apply the configured `needs-human` / `human-review` label, creating the label if the tracker supports label creation and it is missing.

Evidence and summaries must explicitly distinguish `verified empirically` from `artifact-only / verification deferred`. Artifact-only evidence can explain what was checked before escalation, but it cannot complete a work item that requires runtime verification.

---

## Making verification concrete (UAT)

Verification **is** UAT — one gate, not two. This section makes the single
verification process concrete so "an agent actually exercised the running
software against the acceptance criteria" is durable and re-checkable, not a
one-off claim. It builds on the **Per-Work-Unit Evidence Contract** above (the
typed `[EVIDENCE: <artifact-type>: <name>]` manifest), adding three concrete requirements:

**1. The codified proof re-runs in CI.** After local verification passes,
`codify-verification` encodes it where the project's e2e/Playwright tests live
(`tests/e2e/**`). That suite runs in CI (the existing e2e/Playwright job); for a
project type with verification **enforced**, it is a required check — so the proof
re-runs on every PR instead of being proven once by hand.

For **frontend work**, codification is dual-runner: a Playwright spec in the project's Playwright test runner AND a Maestro flow in the Maestro test runner whenever the project supports Maestro (`.maestro/` directory, `maestro:test` script, or Maestro CI workflow) — both encoding the same verified journey, neither a substitute for the other. The dual-runner requirement is non-demotable: a missing runner is either a recorded absence (the project genuinely has no such harness) or a linked build-ready follow-up ticket — never a silent skip (see "Frontend dual-runner codification" in `codify-verification`).

**2. Evidence is committed to the repo.** The named artifacts from the work
unit's evidence manifest are committed under `evidence/<ticket>/` (in addition to
any tracker attachment), so the proof lives with the code and is reviewable in the
PR:

```
evidence/<ticket>/
  verdict.json       # acceptance criteria + per-criterion pass/fail + note,
                     # overall verdict, ticket, commit, lisaVersion, agent, stampedAt
  state.json         # observed runtime state asserted against
  screenshots/*.png  # downscaled, capped; key frames of the playthrough
```

`evidence/**` is ignored by lint/format/knip/coverage — it is proof, not source.

**3. Per-change verification is enforced.** Every `feat`/`fix` adds or extends a
verification (e2e) spec mapped to its acceptance criteria. CI's
`verification-coverage` check requires that delta. The sole exception is a
genuinely non-behavioral change carrying the **logged** `verification-exempt`
label — the check prints why it was exempted; it is never a silent skip.

**Playthrough driver.** `/lisa:product-walkthrough` is the shared driver (it walks
the live product through a real browser). Each project type supplies its own drive
mechanism: a Phaser game is driven through Playwright + an in-game verification
test bridge (seed RNG, read state, inject semantic input, step frames); API types
drive HTTP against a running service; etc.

**Rollout.** Enforcement is per-type and flag-gated (the `verify_enforced`
workflow input, default off) so a type without a drive mechanism is never wedged.
Phaser is the first enforced type.

---

For the full verification lifecycle (classify, check tooling, plan, execute, loop), surfaces, escalation protocol, and proof artifact requirements, see the `verification-lifecycle` skill loaded by the `verification-specialist` agent.

---
name: lisa-verification-lifecycle
description: "Verification lifecycle: confirm quality gates, classify types, discover tools, fail fast, plan, execute, codify (turn each passing verification into a regression test), spec conformance (verify shipped work matches the spec), loop. Quality gates (tests/typecheck/lint) are prerequisites, NOT verification. Verification means running the actual system and observing results."
---

# Verification Lifecycle

This skill defines the complete verification lifecycle that agents must follow for every change: confirm quality gates, classify, check tooling, fail fast, plan, execute, codify (turn each passing verification into a regression test), spec conformance (verify shipped work matches the spec), and loop.

## Verification Lifecycle

Agents must follow this mandatory sequence for every change:

1. Confirm Quality Gates
2. Classify
3. Check Tooling
4. Fail Fast (if blocked)
5. Plan
6. Execute
7. Codify (turn each passing verification into a regression test)
8. Spec Conformance
9. Loop

### 1. Confirm Quality Gates

Confirm that quality gates (tests, typecheck, lint, format) pass. These are prerequisites, NOT verification. Do not count them as verification — they are enforced automatically by hooks and CI. If quality gates fail, fix them before proceeding.

### 2. Classify

Determine which **empirical verification types** apply based on the change. Check each type in the Verification Types table in `.claude/rules/verification.md` against the change scope. Every applicable type requires running the actual system and observing results — not just running tests.

### 3. Check Tooling

For each required verification type, discover what tools are available in the project. Use the Tool Discovery Process below.

Report what is available for each required type. If a required type has no available tool, proceed to step 4.

For UI verification, treat the browser controller as implementation-neutral. Check for an in-app Browser/Chrome tool, interactive Playwright control (MCP, API, or ad hoc script), CDP, computer use, the optional Lisa-owned Kane CLI adapter, or an equivalent controller that can drive a real browser session. Do not require one named backend, and do not declare a tooling block while any capable interactive controller is available. Running an automated Playwright or Maestro test is not a substitute for this live interaction; it becomes the regression gate only after the empirical journey passes.

Kane is eligible only when `verification.browser.kane.enabled` and `cloudUploadApproved` are true, `lisa kane probe` passes, the target is an explicitly allowed non-production environment, and `use-the-product` resolves mutation policy `full`. Invoke `lisa-kane-browser`; never install or follow the vendor's broad `agents.md` instructions. A Kane tool/auth/upload/schema failure is a tooling blocker, not a product failure. Kane evidence may prove the empirical journey, but project-native Playwright/Cypress/Maestro remains the codified regression authority.

If a required verification type needs sign-in or other credentials, exhaust credential sources before declaring the verification blocked. Check credential sources in this order:

1. Project e2e / Playwright config and fixtures, including files such as `e2e/constants.ts`, `e2e/fixtures/api-login.ts`, seeded test users, and OTP-bypass patterns such as `555555`.
2. `.lisa.config.local.json` and environment variables.
3. Documented ticket credentials, including a `Sign-in Required` or equivalent section in the issue, ticket, PRD, or linked implementation notes.

Report which sources were checked. Do not say credentials are unavailable until all three source classes have been checked or proven absent.

### 4. Fail Fast

If a required verification type has no available tool and no reasonable alternative, escalate immediately using the Escalation Protocol. For UI work, absence of a preferred Browser, Chrome, or Playwright-MCP backend is not itself a blocker when another interactive browser controller can perform the same journey. Do not begin implementation without a verification plan for every required type.

If credentials are genuinely unavailable after the credential lookup order above is exhausted, treat the work item as blocked rather than done. Post a clear tracker comment stating exactly what runtime behavior could not be verified and which credential sources were checked, transition the item to the configured blocked state, and apply the configured `needs-human` / `human-review` label, creating that label if the tracker supports label creation and it is missing.

### 5. Plan

For each verification type, state:
- The specific tool or command that will be used (NOT test/typecheck/lint — those are quality gates, not verification)
- The expected outcome that constitutes a pass
- Any prerequisites (running server, seeded database, auth token)

A verification plan that only lists `bun run test`, `bun run typecheck`, or `bun run lint` is NOT a verification plan. Those are quality gates handled in step 1.

For a user-visible Fix, or a Build change that affects user-visible behavior, the verification plan must include the highest practical observation level for the reported surface. If the project has a browser, device, or end-to-end harness for the affected platform, plan a deterministic regression spec against that surface and the empirical command that observes the same surface. Unit-level or API-only verification does not satisfy a UI-surface defect when browser/device automation is available.

The lead cannot waive, defer, or demote this regression spec as optional, "if cheap", or equivalent. The only acceptable exits are a recorded absence of an end-to-end harness for the platform, or a genuine technical blocker that is captured before merge as a linked build-ready follow-up ticket referenced from the PR and source work item.

A claim that the change is "behavior-preserving", a "no-visual-regression" refactor, or "mechanical" does NOT narrow the verification plan — it widens it to the states that can change. Static, resting-state evidence (a default-mount render, even captured at multiple breakpoints) cannot prove that a scroll-bounded, overflowing, expandable, or otherwise stateful surface is unbroken. Plan to drive the surface *into* the state that would reveal the regression — expand the tallest section, overflow the container past its bounded height, open the sheet at a short viewport, scroll to the pinned edge — and observe it there. If the state that could break cannot be reached with available tooling, record that gap explicitly; never certify parity from the resting state alone.

### 6. Execute

After implementation, run the verification plan. Execute each verification type in order.

Evidence output must explicitly label each verification result as either `verified empirically` or `artifact-only / verification deferred`. Artifact-only evidence can support a blocked escalation packet, but it cannot mark a required runtime verification complete.

For a required user-visible regression spec, evidence must prove execution, not only existence. Record a CI log line, reporter output, or equivalent artifact that names the new spec and shows it ran and passed in the PR. A green CI run without named execution proof is not enough; explicitly check for `test.skip`, suite-level environment gates, shard filters, and "0 tests" passes.

Prefer observing the new spec green **locally, before it ships**; CI execution proof is the fallback, not the first resort. A spec never seen passing anywhere is an untested artifact rather than coverage, and it can fail later on a branch whose gates differ from this one.

Before trusting or blaming any local run of a browser/device spec, establish two things:

- **Which artifact is under test.** Harnesses often target a deployed environment unless a CI-only flag is set (e.g. a Playwright config defining `webServer` only when `process.env.CI` is set). A pass obtained that way describes deployed code, not the working tree.
- **Whether the surface is exercisable at all**, by running a **known-good sibling spec unmodified as a control** in the same mode. Control fails too → the environment cannot exercise that surface and the run carries no information about the new spec. Control passes and the new spec fails → the defect is in the new spec.

Record the control result alongside the verdict. A browser-boundary claim marked `not-established` for environmental reasons is only credible with that control; without it the claim is an assumption. When a verdict is later found to rest on one of these traps, state the retraction explicitly in the verdict rather than silently revising it.

If auto-merge is enabled while the regression spec is still in flight, disable auto-merge or apply an equivalent merge gate until the spec commit is pushed and its CI execution proof is available. Do not let the PR merge before the required regression deliverable is satisfied or formally blocked through the linked follow-up path.

### 7. Codify

After each empirical verification produces PASS evidence, invoke the `codify-verification` skill to encode the verification as an automated regression test. The manual proof becomes a repeatable check that catches future regressions.

The `codify-verification` skill maps the verification type to the appropriate framework (Playwright for browser/UI, integration test for API/DB/auth, benchmark for performance, etc.), generates a deterministic test that asserts the same observable outcome the verification just confirmed, runs it in isolation to confirm PASS, and commits it in the same PR as the change. For **frontend work**, codification is dual-runner: a Playwright spec in the project's Playwright test runner AND a Maestro flow in the Maestro test runner whenever the project supports Maestro (`.maestro/` directory, `maestro:test` script, or Maestro CI workflow) — both encoding the same verified journey, neither a substitute for the other.

Codification is mandatory for every empirical verification type with one exception set: PR, Documentation, Deploy, and Investigate-Only spikes — those have inherently non-behavioral proof. For every other type, skipping codification is not allowed; if codification is genuinely impossible (e.g., the test framework does not exist and cannot be installed in scope), escalate via the Escalation Protocol rather than silently skipping.

For UI-surface defects with an available browser/device/e2e harness, codification must happen in that harness or the nearest surface-equivalent automated harness. Lower-level tests may be added for diagnosis or edge cases, but they do not replace the reported-surface regression spec.

A change is not "verified" in the lifecycle sense until each empirical verification has both passed AND been codified.

### 8. Spec Conformance

After empirical verification produces evidence, run spec conformance as a separate, mandatory step. Invoke the `spec-conformance` skill (or delegate to the `spec-conformance-specialist` agent) with the spec source — plan file, JIRA/Linear/GitHub key, or PRD.

Spec conformance answers a question empirical verification does NOT: does the shipped work match what was asked, section-by-section? It consumes the empirical evidence from step 6 and builds a coverage matrix over every requirement (acceptance criteria, Out of Scope, technical commitments, Validation Journey assertions, deliverables).

Required outputs:
- Coverage matrix with one row per requirement
- Scope creep findings (Out-of-Scope violations, surfaced separately from misses)
- Untraceable change findings (diff not traceable to any requirement)
- Verdict: `CONFORMS`, `PARTIAL`, or `DIVERGES`

`PARTIAL` or `DIVERGES` blocks completion. Fix the gaps (implement the miss, remove the creep, capture the missing evidence) and re-run both empirical verification AND spec conformance. Never skip this step — it catches failures that empirical verification by itself does not, such as a feature that works but wasn't asked for, or a spec item that was quietly dropped.

### 9. Loop

If any verification, codification, or spec-conformance check fails, fix the issue and re-verify. Do not declare done until all required types pass, all empirical verifications are codified, AND the spec-conformance verdict is `CONFORMS`. If a verification, codification, or conformance check is stuck after 3 attempts, escalate.

---

## Tool Discovery Process

Agents must discover available tools at runtime rather than assuming what exists. Check these locations in order:

1. **Project manifest** — Read the project manifest file for available scripts (build, test, lint, deploy, start, etc.) and their variants
2. **Script directories** — Search for shell scripts, automation files, and task runners in common locations (`scripts/`, `bin/`, project root)
3. **Configuration files** — Look for test framework configs, linter configs, formatter configs, deployment configs, and infrastructure-as-code definitions
4. **MCP tools** — Check available MCP server tools for browser automation, observability, issue tracking, and other capabilities
5. **CLI tools** — Check for available command-line tools relevant to the verification type (database clients, HTTP clients, cloud CLIs, container runtimes)
6. **Environment files** — Read environment configuration for service URLs, connection strings, and feature flags that indicate available services
7. **Documentation** — Check project README, CLAUDE.md, and rules files for documented verification procedures

If a tool is expected but not found, report the gap rather than assuming it doesn't exist — it may need to be installed or configured.

---

## Verification Surfaces

Agents may only self-verify when the required verification surfaces are available.

Verification surfaces include:

### Action Surfaces

- Build and test execution
- Deployment and rollback
- Infrastructure apply and drift detection
- Feature flag toggling
- Data seeding and state reset
- Load generation and fault injection

### Observation Surfaces

- Application logs (local and remote)
- Metrics (latency, errors, saturation, scaling)
- Traces and correlation IDs
- Database queries and schema inspection
- Browser and device automation
- Queue depth and consumer execution visibility
- CDN headers and edge behavior
- Artifact capture (video, screenshots, traces, diffs)

If a required surface is unavailable, agents must follow the Escalation Protocol.

---

## Tooling Surfaces

Many verification steps require tools that may not be available by default.

Tooling surfaces include:

- Required CLIs (cloud, DB, deployment, observability)
- Required MCP servers and their capabilities
- Required internal APIs (feature flags, auth, metrics, logs, CI)
- Required credentials and scopes for those tools

If required tooling is missing, misconfigured, blocked, undocumented, or inaccessible, agents must treat this as a verification blocker and escalate before proceeding.

---

## Proof Artifacts Requirements

Every completed task must include proof artifacts stored in the PR description or linked output location.

Proof artifacts must be specific and re-checkable. A proof artifact should contain enough detail that another agent or human can reproduce the verification independently.

Acceptable proof includes:
- Automated session recordings and screenshots for UI work
- Request/response captures for API work
- Before/after query outputs for data work
- Metrics snapshots for performance and scaling work
- Log excerpts with correlation IDs for behavior validation
- Benchmark results with methodology for performance work

Statements like "works" or "should work" are not acceptable.

---

## Self-Correction Loop

Verification is not a one-shot activity. Agents operate within a three-layer self-correction architecture that catches errors at increasing scope. Each layer is enforced automatically — agents do not need to invoke them manually.

### Layer 1 — Inline Correction

**Trigger:** Every file write or edit.

Hooks run formatting, structural analysis, and linting on the single file just written. Errors are reported immediately so the agent can fix them before writing more files. This prevents error accumulation across multiple files.

**Agent responsibility:** When a hook blocks, fix the reported errors in the same file before proceeding to other files. Do not accumulate errors.

### Layer 2 — Commit-Time Enforcement

**Trigger:** Every commit.

Checks run on staged files: linting, formatting, secret detection, commit message validation, and branch protection. This layer catches errors that span multiple files or involve staged-but-not-yet-checked changes.

Commit-time checks cannot be bypassed. Agents must discover what specific checks are enforced by reading the project's hook configuration.

### Layer 3 — Push-Time Enforcement

**Trigger:** Every push.

The full project quality gate runs: test suites with coverage thresholds, type checking, security audits, unused export detection, and integration tests. This is the last automated checkpoint before code reaches the remote.

**Handling failures:** When a push fails, read the error output to determine which check failed. Fix the root cause rather than working around it. Agents must discover what specific checks are enforced by reading the project's hook configuration.

### Regeneration Over Patching

When the root cause of errors is architectural (wrong abstraction, incorrect data flow, fundamentally broken approach), delete and regenerate rather than incrementally patching. Incremental patches on a broken foundation accumulate tech debt faster than the self-correction loop can catch it.

Signs that regeneration is needed:
- The same file has been edited 3+ times in the same loop without converging
- Fixing one error introduces another in the same file
- The fix requires disabling a lint rule or adding a type assertion

---

## Standard Workflow

Agents must follow this sequence unless explicitly instructed otherwise:

1. Restate goal in one sentence.
2. Identify the end user of the change.
3. Confirm quality gates pass (tests, typecheck, lint, format) — these are prerequisites, NOT verification.
4. Classify empirical verification types that apply to the change (UI, API, Database, etc.).
5. Discover available tools for each verification type.
6. Confirm required surfaces are available, escalate if not.
7. Plan verification: state tool, command, and expected outcome for each type. Do NOT list test/typecheck/lint here — those are quality gates from step 3.
8. Implement the change.
9. Execute verification plan — run the actual system and observe results.
10. Collect proof artifacts.
11. Codify — for each passing empirical verification, invoke `codify-verification` to encode it as a regression test (Playwright for UI, integration test for API/DB/auth, benchmark for performance, etc.) and commit the test in the same PR. Frontend work codifies into every supported UI runner: Playwright spec + Maestro flow when the project supports Maestro (see the dual-runner section of `codify-verification`).
12. Run spec conformance — build coverage matrix against the spec source (plan/ticket/issue), flag scope creep and untraceable changes, produce verdict.
13. Summarize what changed, what was verified, what was codified, conformance verdict, and remaining risk.
14. Label the result with a verification level.

---

## Task Completion Rules

1. **Run the proof command** before marking any task complete
2. **Compare output** to expected result
3. **If verification fails**: Fix and re-run, don't mark complete
4. **If verification blocked** (missing tools, services, etc.): Mark as blocked, not complete
5. **Must not be dependent on CI/CD** if necessary, you may use local deploy methods found in the project manifest, but the verification methods must be listed in the pull request and therefore cannot be dependent on CI/CD completing
6. **Evidence manifest satisfied (leaf work units)**: For a leaf work unit (Bug / Task / Sub-task / Improvement) whose ticket carries a Validation Journey, do not mark the ticket complete or transition it out of in-progress until every typed `[EVIDENCE: <artifact-type>: <name>]` marker declared on the ticket has a corresponding captured, non-empty artifact **of the declared type** attached to the ticket (an image for `screenshot`, request + response for `http-transcript`, measured output for `perf-trace`, …). A missing, empty, or wrong-type artifact for any declared marker blocks completion exactly like a failed verification — fix and re-capture, or escalate; never close with an unsatisfied manifest. Epics / Stories / Spikes are exempt (coordination containers, not work units).
   - Extract local obligations using the exact `[EVIDENCE:` prefix (plus legacy local `[SCREENSHOT:`). Both the canonical `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` and the Lisa 2.223.0 legacy alias `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` are non-claiming pointers to another work item: never capture either, match it to a local artifact, include it in duplicates, or count it toward S14. A reference-only runtime-changing leaf remains incomplete.
7. **No artifact-only completion for required runtime verification**: If empirical verification is required and cannot run because credentials are missing, do not mark the item done on artifact-only evidence. Exhaust the credential lookup order first; if still blocked, post the blocker comment, move the item to the configured blocked state, and apply the configured `needs-human` / `human-review` label.

---

## Escalation Protocol

Agents must escalate when verification is blocked, ambiguous, or requires tools that are missing or inaccessible.

Common blockers:

- VPN required
- MFA, OTP, SMS codes
- Hardware token requirement
- Missing CLI, MCP server, or internal API required for verification
- Missing documentation on how to access required tooling
- Production-only access gates
- Compliance restrictions
- Missing runtime credentials after checking project e2e / Playwright config and fixtures, `.lisa.config.local.json` / environment, and documented ticket credentials

When blocked, agents must do the following:

1. Identify the exact boundary preventing verification.
2. Identify which verification surfaces and tooling surfaces are missing.
3. Attempt safe fallback verification (local, staging, mocks) and label it clearly.
4. Declare verification level as PARTIALLY VERIFIED or UNVERIFIED.
5. Produce a Human Action Packet.
6. Pause until explicit human confirmation or tooling is provided.

For tracker-backed work items, also post the packet to the tracker, transition to the configured blocked state, and apply the configured `needs-human` / `human-review` label. If the label is missing and the tracker supports label creation, create it before applying it.

Agents must never proceed past an unverified boundary without surfacing it to the human overseer.

### Human Action Packet Format

Agents must provide:

- What is blocked and why
- What tool or access is missing
- Exactly what the human must do
- How to confirm completion
- What the agent will do immediately after
- What artifacts the agent will produce after access is restored

Example:

- Blocked: Cannot reach DB, VPN required.
- Missing: Database client access to `db.host` and internal logs viewer.
- Human steps: Connect VPN "CorpVPN", confirm access by running connectivity check to `db.host`, provide credentials or endpoint.
- Confirmation: Reply "VPN ACTIVE" and "ACCESS READY".
- Next: Agent runs migration verification script and captures schema diff and query outputs.

Agents must pause until explicit human confirmation.

Agents must never bypass security controls to proceed.

---

## Environments and Safety Rules

### Allowed Environments

- Local development
- Preview environments
- Staging
- Production read-only, only if explicitly approved and configured for safe access

### Prohibited Actions Without Human Approval

- Writing to production data stores
- Disabling MFA or security policies
- Modifying IAM roles or firewall rules beyond scoped change requests
- Running destructive migrations
- Triggering external billing or payment flows

If an operation is irreversible or risky, escalate first.

---

## Artifact Storage and PR Requirements

Every PR must include:

- Goal summary
- Verification level
- Proof artifacts links or embedded outputs
- How to reproduce verification locally
- Known limitations and follow-up items

Preferred artifact locations:

- PR description
- Repo-local scripts under `scripts/verification/`
- CI artifacts linked from the build

---

## Definition of Done

A task is done only when:

- End user is identified
- All applicable verification types are classified and executed
- Verification lifecycle is completed (classify, check tooling, plan, execute, codify, spec conformance, loop)
- Required verification surfaces and tooling surfaces are used or explicitly unavailable
- Proof artifacts are captured
- Every passing empirical verification is codified as a regression test (or has an explicit, documented skip reason from the allowed set)
- For a leaf work unit, every typed `[EVIDENCE: <artifact-type>: <name>]` marker declared in its Validation Journey has a captured, non-empty artifact of the declared type attached to the ticket (the evidence manifest is fully satisfied)
- Cross-work-item `EVIDENCE-REF` pointers were excluded from the local manifest and did not satisfy S14 or completion; a runtime-changing leaf has at least one local claiming marker
- Spec conformance verdict is `CONFORMS` (not `PARTIAL`, not `DIVERGES`)
- Verification level is declared
- Risks and gaps are documented

If any of these are missing, the work is not complete.

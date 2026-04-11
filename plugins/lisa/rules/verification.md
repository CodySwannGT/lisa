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

Verification is mandatory. Never skip it, defer it, or claim it was unnecessary. Every task must be verified before claiming completion.

Before starting implementation, state your verification plan — how you will use the resulting software to prove it works. A verification plan that only lists test/typecheck/lint commands is not a verification plan. Do not begin implementation until the plan is confirmed.

After verifying a change empirically, encode that verification as automated tests. The manual proof that something works should become a repeatable regression test that catches future regressions. Every verification should answer: "How do I turn this into a test?"

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

## Local vs Remote Verification

Verification happens at two stages in the workflow:

- **Quality gates** (enforced automatically): Tests, typecheck, lint, and format run via hooks at write-time, commit-time, and push-time. These are prerequisites, not verification.
- **Local verification** (part of the Implement flow): After quality gates pass, empirically verify the change by running the actual system in a local or preview environment — make HTTP requests, interact with the UI, execute CLI commands, query the database. This proves the change works before shipping. After local verification succeeds, encode it as an e2e test.
- **Remote verification** (part of the Verify flow): After the PR is merged and deployed, repeat the same empirical verification against the target environment. This proves the change works in production, not just locally. If remote verification fails, fix and re-deploy.

Both levels use the same verification types table above. The difference is the environment, not the rigor.

---

For the full verification lifecycle (classify, check tooling, plan, execute, loop), surfaces, escalation protocol, and proof artifact requirements, see the `verification-lifecycle` skill loaded by the `verification-specialist` agent.

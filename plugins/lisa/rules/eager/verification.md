# Empirical Verification (load-bearing)

**Verification is not linting, typechecking, or testing.** Those are *quality checks* — necessary prerequisites, but NOT verification.

**Verification is using the resulting software the way a user would** — interacting with the UI, calling the API, running the CLI, observing behavior. Tests pass in isolation; verification proves the system works as a whole.

## Mandatory

- **Never claim success without runtime evidence.** "The code looks correct" is not evidence.
- **If all you did was run tests, typecheck, and lint — you have NOT verified.**
- **Before starting implementation, state your verification plan** — how you will USE the resulting software to prove it works. A plan that only lists `test`/`typecheck`/`lint` commands is not a plan. Do not begin until confirmed.
- **After verifying empirically, codify it as a regression test** via the `codify-verification` skill — Playwright for UI, integration test for API/DB/auth, benchmark for performance. Codification is mandatory for every verification type except PR/Documentation/Deploy and Investigate-Only spikes.
- **Every PR must include reviewer replay steps** — the exact human steps to use the software and confirm the change works. Not test commands. If a reviewer can't reproduce from the PR description alone, the PR is incomplete.

## Roles

- **Builder agent** — implements the change.
- **Verifier agent** — acts as the end user / API client / operator. Independent from Builder when possible.
- **Human overseer** — approves risky operations and anything agents cannot fully verify.

Full operational contract (verification types, evidence formats, escalation protocol): [reference/verification.md](../reference/verification.md).

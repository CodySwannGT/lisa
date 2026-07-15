# Empirical Verification (load-bearing)

**Verification is not linting, typechecking, or testing.** Those are *quality checks* — necessary prerequisites, but NOT verification.

**Verification is using the resulting software the way a user would** — interacting with the UI, calling the API, running the CLI, observing behavior. Tests pass in isolation; verification proves the system works as a whole.

**Verification IS UAT** (User Acceptance Testing) — the same single gate, not two concepts. "Use the software as a user, against the acceptance criteria" *is* UAT. Everything below makes that one process concrete: a committed evidence artifact, a codified check that re-runs in CI, and a per-change requirement.

## Mandatory

- **Never claim success without runtime evidence.** "The code looks correct" is not evidence.
- **If all you did was run tests, typecheck, and lint — you have NOT verified.**
- **Before starting implementation, state your verification plan** — how you will USE the resulting software to prove it works. A plan that only lists `test`/`typecheck`/`lint` commands is not a plan. Do not begin until confirmed.
- **After verifying empirically, codify it as a regression test** via the `codify-verification` skill — Playwright for UI, integration test for API/DB/auth, benchmark for performance. Codification is mandatory for every verification type except PR/Documentation/Deploy and Investigate-Only spikes.
- **The codified proof re-runs in CI.** Codified runtime verification lives where the project's e2e/Playwright tests live (`tests/e2e/**`) and runs as a required CI check for types with verification enforced — so the proof re-runs on every PR, not once by hand.
- **Commit the evidence.** Write a durable artifact to `evidence/<ticket>/` — the acceptance criteria with per-criterion pass/fail + note, the observed state, screenshots/recording, and a `verdict.json`. The transient `.lisa/verification-status.json` is the session gate; `evidence/<ticket>/` is the committed proof.
- **Evidence markers are typed artifacts, not assertion labels.** A Validation Journey marker is `[EVIDENCE: <artifact-type>: <name>]` where the type (screenshot, recording, http-transcript, cli-output, log-snippet, db-query-output, perf-trace, test-run-log, deploy-log, state-dump) says HOW the proof is captured and the name says WHAT it proves. `[EVIDENCE: works-gracefully]` is a claim, not evidence — write `[EVIDENCE: screenshot: load-failure-error-state]`. Completion requires a captured artifact **of the declared type** per marker.
- **Per-change verification is mandatory.** Every `feat`/`fix` adds or extends a verification (e2e) spec mapped to its acceptance criteria. The only exception is a genuinely non-behavioral change explicitly marked with the **logged** `verification-exempt` label — never a silent skip.
- **Drive the playthrough with `/lisa:product-walkthrough`** (it walks the live product through a real browser); each project type plugs in its own drive mechanism (e.g. a Phaser game is driven through Playwright + an in-game verification test bridge that seeds RNG, reads state, injects input, and steps frames).
- **Every PR must include reviewer replay steps** — the exact human steps to use the software and confirm the change works. Not test commands. If a reviewer can't reproduce from the PR description alone, the PR is incomplete.
- **Exhaust credential sources before deferring runtime verification** — check project e2e / Playwright config and fixtures first, then `.lisa.config.local.json` / environment variables, then documented ticket credentials such as `Sign-in Required`.
- **Never mark required runtime verification done on artifact-only evidence** — if credentials are genuinely unavailable after all sources are checked, post the blocker, transition the item to the configured blocked state, apply the configured `needs-human` / `human-review` label, and label the evidence as `artifact-only / verification deferred`.

## Roles

- **Builder agent** — implements the change.
- **Verifier agent** — acts as the end user / API client / operator. Independent from Builder when possible.
- **Human overseer** — approves risky operations and anything agents cannot fully verify.

Full operational contract (verification types, evidence formats, escalation protocol): [reference/verification.md](../reference/verification.md).

# Empirical Verification (load-bearing)

Lint, typecheck, and tests are quality checks. Verification means using the software as its user would: drive the UI, call the API, run the CLI, and check the result against the acceptance criteria.

- **Browser-controller neutrality.** Drive a live browser through the Validation Journey with any controller that works, such as interactive Playwright control, CDP, an in-app browser, or computer use. An automated Playwright or Maestro test run is a quality gate, not the initial empirical evidence.
- After the live check passes, codify it as a regression test (`codify-verification`) in the project's own e2e runners. Frontend work also follows `bdd-e2e-coverage`.
- Commit evidence under `evidence/<ticket>/`, one artifact of the declared type per `[EVIDENCE: <type>: <name>]` marker. Put human replay steps in the PR.
- If sign-in credentials are missing from every source, label the evidence `artifact-only / verification deferred` and stop through the blocked exit.

Full contract: [reference/verification.md](../reference/verification.md).

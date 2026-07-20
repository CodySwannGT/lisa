# Kane CLI empirical-browser provider

Lisa supports TestMu Kane CLI as an optional empirical browser controller. Kane can drive a real
Chrome session from a natural-language Validation Journey and return a normalized result plus a
local evidence pack. It does not replace project-native Playwright, Cypress, Selenium, Maestro, or
Detox regression tests.

Lisa's adapter launches local Chrome; it does not request execution on TestMu's paid remote grid.
Local execution is free, but Kane's AI features still depend on the account's available AI credits.
Test Manager upload is the default for local and remote sessions, including free accounts.

## Safety and data boundary

Kane-authored sessions upload objectives, screenshots, action logs, variables in scope, metadata,
and packaged run artifacts to TestMu Test Manager. Lisa therefore refuses to invoke Kane unless the
project has all of the following:

- explicit `enabled: true` and `cloudUploadApproved: true` configuration;
- exact contract-tested Kane version `0.6.3`;
- a non-production environment allow-list;
- a Test Manager project identifier;
- an `exploration` environment whose mutation policy resolves to `full`;
- a passing `lisa kane probe` using pre-provisioned authentication.

`prod` and `production` are rejected even if listed. During the initial rollout, read-only journeys
use a directly controlled browser backend because a broad nested-agent objective cannot provide the
same action-by-action mutation boundary.

Credentials are never stored in Lisa config. Use Kane's protected OAuth profile on developer
machines and the CI platform's secret store for a dedicated TestMu service identity.
`cloudUploadApproved` records privacy and data-egress approval; it is not purchase authorization.

## Setup

Invoke `/lisa:setup-kane`. The skill performs the exterior cloud-upload approval gate, pins the
CLI, verifies authentication, selects the Test Manager target, writes non-secret policy config, and
runs a disposable synthetic check.

Do not install the vendor's global agent skill and do not append its `agents.md` to project
instructions. Lisa owns the narrower provider contract and distributes it to every supported agent.

## Commands

```bash
# Read-only readiness probe
lisa kane probe . --json

# One policy-approved empirical journey
lisa kane run . \
  --environment dev \
  --mutation full \
  --url https://dev.example.test \
  --objective "Sign in with the configured disposable user, complete the checkout journey, verify the order confirmation, then remove the test order" \
  --json

# Longitudinal pilot sweep and report
lisa kane pilot ./kane-pilot.json
lisa kane pilot ./kane-pilot.json --report-only
```

Normalized outcomes are `passed`, `product_failed`, `tool_failed`, and `timed_out`. Provider,
authentication, upload, Chrome, and schema failures never become product regressions.

## Evidence and regression coverage

The local Kane evidence pack is the source artifact. Lisa extracts required screenshots,
HAR/network records, console output, and result metadata, redacts sensitive data, and persists them
through the normal ticket/PR evidence flow. The Test Manager URL is secondary because external
share links can expire.

After a passing empirical journey, `lisa-codify-verification` still writes and executes the same
behavior in every native runner supported by the project. Kane `_test.md`, generated code,
recordings, and auto-healed selectors are not authoritative regression gates during the rollout.

## Adoption pilot

Copy [the example manifest](kane-cli-pilot.example.json), configure at least two disposable
downstream applications, and run the sweep repeatedly. Results append to the manifest-relative
JSONL file. The gate remains `collecting` until it has at least 30 days, 50 executions, and two
observations per case. At the end of the full window, an exterior security/privacy reviewer must
add `policyReview: { "reviewedAt": "<ISO timestamp>", "incidents": <count> }` to the manifest. A
review dated before day 30 or in the future does not satisfy the gate; do not pre-attest zero
incidents when starting the pilot.

An `adopt` verdict additionally requires at least 90% evidence capture, no more than 5% provider
failures, no more than 5% inconsistent case verdicts, at least 30% workflow-time reduction when
baselines are supplied, at least 95% complete evidence, no policy incidents, and average credit usage
within the configured budget. A mature pilot that misses any gate returns `reject`.

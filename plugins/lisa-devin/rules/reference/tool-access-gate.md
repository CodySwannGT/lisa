# Tool Access Gate

- If you can't reach something you need, such as a repository, a secret, an API, or a connector, say exactly what's missing in your first message and stop. Don't substitute, mock, or guess.

If the missing access is discovered after work begins, say exactly what's
missing in your next message and stop.

A flow may only take on work it can actually finish. If completing a work item —
including its empirical verification — requires an external tool or system the
agent cannot access, the flow must **tell the user exactly what access is missing and stop**, never
work around it. This is the flow-side arm of the factory
contract: intake validates that the factory has "the tooling *and provable
access to that tooling*"; this gate re-proves that promise at execution time and
enforces it for tools discovered mid-flow.

"Tool" means any external surface the work depends on, for example:

- Cloud/provider CLIs and APIs: AWS (CloudWatch logs, S3, …), GCP, Azure
- Design sources: Figma
- Bug/session capture: Jam
- Observability: Sentry, PostHog, CloudWatch
- Quality gates: SonarCloud
- Trackers and docs: JIRA/Confluence, Linear, Notion, GitHub
- Device/browser harnesses: Playwright, Maestro, Detox, simulators/emulators
- Databases, deploy targets, and protected environments

## When the gate runs

1. **Preflight** — after the completion condition is defined and before any
   implementation task starts, enumerate every tool required by (a) the
   implementation itself, (b) the proof command / verification plan, and
   (c) remote verification and post-deploy checks. Sources for the enumeration:
   the work item (description, comments, attachments — a Figma link or Jam
   capture implies that tool), acceptance criteria, `testing_requirements`,
   the `verification` metadata, and the deploy pipeline for the target
   environment.
2. **Continuously** — the moment a previously unknown tool requirement surfaces
   mid-flow (e.g. verification turns out to need CloudWatch log capture), probe
   it right then. If access is unavailable, report it and stop. Otherwise, record
   the new tool + probe result in the same places the
   preflight wrote to (the plan/tracker artifact and the affected tasks'
   `metadata.required_access`) before continuing. Discovery timing changes
   nothing about the protocol.

## Proving access

Access is proven by a **cheap, read-only probe that actually exercises the
authenticated surface** — tool presence on PATH is not access.

- Vendors with an access layer MUST be probed through their `*-access` skill
  (see the `integration-access-layer` rule): `lisa-atlassian-access`,
  `lisa-notion-access`, `lisa-linear-access`, `lisa-jam-access`,
  `lisa-sonarcloud-access`, `lisa-sentry-access`, `lisa-posthog-access`,
  `lisa-expo:play-store-access`. A loud access-skill failure naming a missing
  env var IS a failed probe.
- Vendors without an access layer are probed with the cheapest authenticated
  read the runtime offers (an MCP tool call, a CLI read, a REST GET).

Example probes:

| Tool | Probe |
|---|---|
| AWS CLI | `aws sts get-caller-identity`, plus the service-level read the task needs (e.g. `aws logs describe-log-groups --max-items 1`) |
| GitHub | a repository-scoped read against the target repo (e.g. `gh api repos/<owner>/<repo> --jq .full_name`, or the exact read the work item needs) — `gh auth status` alone only proves host auth, not access to the repository |
| Figma | a read call against the linked file via the available Figma MCP/API surface |
| Sentry / Jam / SonarCloud / PostHog / Atlassian / Linear / Notion | the matching `*-access` skill's resolve/auth check |
| Database | the project's documented read-only connection check |
| Deploy target | reach the target environment with the credentials the verify step will use |
| Device/browser harness | the harness's own doctor/smoke entry (e.g. `playwright --version` plus a trivial headless launch) |

Resolve credentials through the documented sources before probing: project
e2e config/fixtures, `.lisa.config.local.json` and environment variables, then
documented work-item credentials (e.g. `Sign-in Required`). If the documented
access path or probe cannot provide the required access, report the gap and
stop. Do not continue exploring substitute sources after confirming the gap.

Record successful probes in the flow's plan/tracker artifact
(and task `metadata.required_access` where the flow's task contract carries
it), so the verifier can confirm the gate ran.

## On failure: break out, never work around

When required access is unavailable, tell the user and stop. Use the first
message if the gap is already known, or the next message if it is discovered
mid-task. The message must state:

- the exact resource that cannot be reached and the operation it blocks;
- the observed failure and, if known, the credential name, role, permission, or
  invitation needed — never secret values, and never a guessed diagnosis;
- the read-only probe that must pass before work can resume.

Do not substitute, mock, guess, or continue other tasks as a workaround.
Reporting does not depend on access to a tracker, and it does not require
creating a new ticket. Resume after the required access is available and its
probe passes.

### Forbidden workarounds

None of the following ever substitutes for missing access:

- Swapping the verification for a weaker one the agent *can* run (unit tests or
  code reading instead of the required log capture / UI observation).
- Mocking, stubbing, or simulating the inaccessible system to make the proof
  "pass".
- Marking work done on artifact-only evidence, or asserting success without the
  runtime evidence the completion condition demands.
- Guessing at the tool's contents (e.g. implementing a design without reading
  the linked Figma file, or "fixing" a bug without the Jam/Sentry evidence the
  ticket points at).
- Silently narrowing scope so the inaccessible part is "out of scope".

Keep results already obtained, but stop further work until the required access
is available. An inaccessible tracker does not prevent reporting the blocker
to the user. Do not claim blocked acceptance criteria have passed.

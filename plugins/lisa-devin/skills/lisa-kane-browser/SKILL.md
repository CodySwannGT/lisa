---
name: lisa-kane-browser
description: "Optional Lisa-owned adapter for TestMu Kane CLI empirical browser runs. Enforces project opt-in, cloud-upload approval, non-production environment allow-lists, full-mutation rollout policy, pinned-version readiness, normalized outcomes, and durable Lisa evidence handling. Never replaces project-native Playwright, Cypress, or Maestro regression tests."
allowed-tools: ["Bash", "Read", "Glob", "Grep", "Skill"]
---

# Kane empirical browser provider

Use this skill only when a parent Lisa workflow has already classified a DOM-web empirical
verification and selected Kane from the available browser-controller providers. Kane is an
optional implementation detail, not the owner of Lisa's verification verdict.

## Hard preconditions

1. Read the effective `.lisa.config.json` + `.lisa.config.local.json` configuration.
2. Require `verification.browser.kane.enabled: true`.
3. Require `verification.browser.kane.cloudUploadApproved: true`. Kane uploads objectives,
   screenshots, action logs, variables in scope, metadata, and run artifacts to TestMu Test
   Manager. If approval is absent, do not run it and do not ask from inside a factory.
4. Require the selected environment in `allowedEnvironments`. `prod` and `production` are always
   rejected even if listed.
5. Require the `use-the-product` mutation policy to resolve to `full`. During the initial rollout,
   Kane must not receive a broad objective in `read-only` or `forbidden` environments.
6. Require a disposable test identity and cleanup plan. Never use real customer records.
7. Run `lisa kane probe <project-root> --json`. A failed probe is a tooling blocker, not a product
   failure. Do not start an interactive login from an unattended factory.

## Execute

Build one self-contained objective from the parent workflow's Validation Journey. It must state the
starting URL, identity/persona, actions, observable assertions, and cleanup expectation. Do not put
credentials or secret values in the objective; use the project's existing Kane variable bindings.

Run:

```bash
lisa kane run <project-root> \
  --environment <environment> \
  --mutation full \
  --url <base-url> \
  --objective "<self-contained objective>" \
  --json
```

The Lisa adapter always adds Kane's non-interactive `--agent --headless` flags, bounds time and
steps, and parses the evolving event stream behind a stable contract.

## Interpret the normalized result

- `passed` — empirical journey passed. It is not complete until `lisa-codify-verification`
  encodes the same behavior in every supported native regression runner.
- `product_failed` — the live journey or assertion failed. Diagnose from evidence; a Kane
  `confirmedProductBug` flag is evidence, not permission to bypass Lisa's duplicate search or
  tracker-write gate.
- `tool_failed` — Kane installation, auth, schema, upload, Chrome, or control-plane failure. Never
  report this as a product regression.
- `timed_out` — provider timeout. Retry only under the parent workflow's bounded retry policy.

Progress events are informational and may change between Kane releases. Automation decisions use
only Lisa's normalized result, which is derived from the terminal event and process exit code.

## Evidence

Use the local evidence pack as the source artifact. Extract the screenshots, HAR/network log,
console log, and result summary required by the ticket's evidence manifest. Route those artifacts
through `lisa-tracker-evidence` so they become durable PR/ticket evidence. A Test Manager share URL
is secondary convenience evidence and must never be the only proof because it can expire.

Do not commit Kane session directories, credentials, browser profiles, raw variable stores, or
unreviewed recordings. Redact secrets and sensitive person-level data before attaching evidence.

## Non-goals

- Do not install the vendor's global skill or append its `agents.md` to project instructions.
- Do not tell agents to prefer Kane for every browser task.
- Do not replace interactive native browser control when it is safer for the selected mutation
  policy.
- Do not replace Playwright, Cypress, Selenium, Maestro, or Detox regression coverage.
- Do not use `kane-cli generate`, `testmd`, code export, or auto-healing as an authoritative Lisa
  regression gate during the initial rollout.

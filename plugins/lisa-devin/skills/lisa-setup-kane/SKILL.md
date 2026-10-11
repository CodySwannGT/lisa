---
name: lisa-setup-kane
description: "Configure TestMu Kane CLI as an optional Lisa empirical-browser provider. Performs the exterior human approval gate for mandatory cloud uploads, verifies the pinned CLI version, provisions local/CI authentication, selects a Test Manager project/folder, runs a disposable synthetic check, and writes only non-secret policy identifiers to Lisa config."
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Setup Kane CLI

This is an explicit exterior setup gate. It may involve a human because authentication and cloud
data approval must be complete before unattended factories run. Never invoke setup from inside an
active Build, QA, Monitor, or Verify factory.

## 1. Explain the data boundary and obtain approval

Explain that every authored Kane session uploads screenshots, the objective, action logs, variables
in scope, metadata, and packaged run artifacts to TestMu Test Manager. Explain that share links are
secondary evidence and can be accessible outside project membership for their validity window.
Clarify that this is privacy and data-egress approval, not purchase authorization: Lisa's adapter
uses local Chrome rather than TestMu's paid remote grid, while Test Manager upload remains the
default for local runs and Kane's AI features still require available account credits.

Ask exactly one approval question: approve TestMu cloud upload for disposable dev/staging test data,
or decline. On decline, leave configuration unchanged and report that Lisa's native controllers
remain available.

## 2. Install and pin

Require Kane CLI `0.6.3`, the version covered by Lisa's adapter contract:

```bash
kane-cli --version
npm install -g @testmuai/kane-cli@0.6.3  # only after setup approval if missing/wrong
```

Do not use `npx @testmuai/kane-cli-skill` and do not append vendor content to `AGENTS.md`.

## 3. Authenticate outside the factory

- Developer machine: run `kane-cli login --oauth` and let the operator complete browser consent.
- CI/headless: provision a dedicated TestMu service identity using the platform's secret store. Do
  not put username/access key in `.lisa.config.json`, command history, a ticket, or chat.

Verify with `kane-cli whoami`. Record the identity label, never token material.

## 4. Select the Test Manager target

Use `kane-cli config project` and optional `kane-cli config folder`, then `kane-cli config show`.
Capture the non-secret project/folder identifiers. Use a dedicated Lisa pilot project with access
restricted to the engineering/QA operators who may view uploaded artifacts.

## 5. Write policy configuration

Merge this shape into committed `.lisa.config.json`, preserving every unrelated key:

```json
{
  "verification": {
    "browser": {
      "kane": {
        "enabled": true,
        "version": "0.6.3",
        "cloudUploadApproved": true,
        "allowedEnvironments": ["dev", "staging"],
        "projectId": "<project-id>",
        "folderId": "<optional-folder-id>",
        "timeoutSeconds": 120
      }
    }
  }
}
```

Production environments are invalid. Developer-specific overrides may live in
`.lisa.config.local.json`, but shared provider policy and Test Manager identifiers belong in the
committed config. Never write credentials to either file.

## 6. Prove readiness

Run `lisa kane probe . --json`, then run a harmless synthetic journey against a disposable local or
dev fixture with mutation policy `full`. Confirm the normalized result, evidence pack, Test Manager
link, screenshot, HAR, and console record. If any is missing, setup is incomplete.

## 7. Prepare the controlled pilot

Create a pilot manifest from `docs/kane-cli-pilot.example.json`, point it at at least two disposable
downstream web applications, set the start timestamp and credit budget, then run:

```bash
lisa kane pilot <manifest>
lisa kane pilot <manifest> --report-only
```

The pilot remains `collecting` until at least 30 days, 50 runs, and two observations per case exist.
After the full window, an exterior security/privacy reviewer adds
`policyReview: { "reviewedAt": "<ISO timestamp>", "incidents": <count> }` to the manifest. Never
pre-attest zero incidents at pilot start. Only an `adopt` verdict permits wider enablement.

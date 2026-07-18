---
name: lisa-setup-remote-aws
description: "Install and validate Lisa's…"
allowed-tools: ["Bash", "Read", "Write", "Glob", "Grep"]
---

# Set up remote-agent AWS access: $ARGUMENTS

Install the vendor-neutral AWS bootstrap into the current repository.

## Arguments

- `--platform=all|claude|codex|cursor|copilot|agy|opencode` (default `all`)
- `--project=<path>` (default current working directory)
- `--secret-name=<name>` (default `remote-agent-credentials`)

## Procedure

1. Resolve the plugin root from `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`,
   `CURSOR_PLUGIN_ROOT`, or the installed `@codyswann/lisa/plugins/lisa` package.
2. Run:

   ```bash
   node "$PLUGIN_ROOT/scripts/install-remote-agent-aws.mjs" $ARGUMENTS
   ```

3. Inspect every path returned by the installer. It must install
   `scripts/remote-agent-aws-setup.sh`; for Cursor it merges
   `.cursor/environment.json`; for Copilot it creates or merges
   `.github/workflows/copilot-setup-steps.yml`; and it always writes
   `docs/remote-agent-aws.md`.
4. Run `bash -n scripts/remote-agent-aws-setup.sh`.
5. Never write or request the actual bootstrap SecretString in repository
   files. Tell the operator to retrieve the `remote-agent-credentials` secret
   from the shared AWS account and paste its complete SecretString into the
   platform secret named `LISA_AWS_BOOTSTRAP_JSON`. The default cdkstarter
   secret name is `remote-agent-credentials`; downstream infrastructure may
   configure a different name. Pass that name with `--secret-name` so the
   generated runbook contains the exact retrieval command.
6. Report the external step that remains: configure that one secret in the
   remote environment and launch a smoke session.

## Contract

A future coding agent is supported without an AWS change when its remote
environment provides a Linux shell, a setup/start hook, one opaque secret,
a writable home directory, and HTTPS access to AWS STS plus the allowed service
endpoints. Set `LISA_REMOTE_AGENT` to a stable lowercase platform label; it is
used only as `role_session_name`.

Do not create per-repository or per-agent IAM users. Do not expose the bootstrap
key through standard `AWS_ACCESS_KEY_ID` variables. Do not add production repair
permissions; production repair is a human-driven local-workstation workflow.

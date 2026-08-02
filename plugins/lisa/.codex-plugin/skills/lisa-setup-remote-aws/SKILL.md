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
5. Never write or request the actual bootstrap bundle in repository files. Tell
   the operator where to obtain it and where to put it — see **Where the bundle
   lives** below. Pass `--secret-name` when the source names it something other
   than `remote-agent-credentials`, so the generated runbook contains the exact
   retrieval command.
6. Report the external step that remains: configure that one secret in the
   remote environment and launch a smoke session.

## Where the bundle lives

`LISA_AWS_BOOTSTRAP_JSON` is **just another secret**, and it belongs wherever
the project keeps its secrets — resolved through `lisa-secrets-access` like
everything else. It is not tied to any one store.

Whoever provisions the IAM user emits the bundle somewhere. `cdkstarter` writes
it to AWS Secrets Manager as `remote-agent-credentials`, but that is where it is
*emitted*, not where it must *live*. Copy it once into the project's configured
provider and read it from there.

**Do not keep it in two stores.** A bundle sitting in Secrets Manager *and* in
the platform's secret store is two live copies of one credential: rotate the
IAM key and whichever copy you forget keeps authenticating until it doesn't,
with nothing to say which is current. That is the drift the single-store rule in
`lisa-secrets-access` exists to prevent, and this credential is not exempt.

**One provider cannot serve this particular secret.** If `secrets.provider` is
`aws`, reading the bundle requires AWS credentials — and the bundle *is* the AWS
credential. Anything else works: Bitwarden, 1Password, Doppler, Vault, or a
platform secret store. Pick the one that is not the thing being bootstrapped.

On a surface that materializes (see `lisa-secrets-access`), the bundle arrives
in `secrets.env` with everything else, so the project hook can run this setup
script after materialization with no extra plumbing. On a surface that reads
through live, resolve it at the point of use.

## Contract

A future coding agent is supported without an AWS change when its remote
environment provides a Linux shell, a setup/start hook, one opaque secret,
a writable home directory, and HTTPS access to AWS STS plus the allowed service
endpoints. Set `LISA_REMOTE_AGENT` to a stable lowercase platform label; it is
used only as `role_session_name`.

Do not create per-repository or per-agent IAM users. Do not expose the bootstrap
key through standard `AWS_ACCESS_KEY_ID` variables. Do not add production repair
permissions; production repair is a human-driven local-workstation workflow.

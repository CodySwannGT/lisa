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
5. Confirm the operator knows which project component the profiles will carry.
   The script resolves it from `LISA_AWS_PROFILE_NAMESPACE`, then the bundle's
   `namespace`, then `<owner>-<repository>` from the git origin remote, and
   refuses to write anything when none resolves. Set the variable explicitly
   whenever the setup hook runs outside a checkout.
6. Never write or request the actual bootstrap bundle in repository files. Tell
   the operator where to obtain it and where to put it — see **Where the bundle
   lives** below. Pass `--secret-name` when the source names it something other
   than `remote-agent-credentials`, so the generated runbook contains the exact
   retrieval command.
7. Report the external step that remains: configure that one secret in the
   remote environment and launch a smoke session.

## Profile naming and readiness

Every profile the script writes is scoped `<project>-agent-<stage>`, and the
private source profile is `<project>-agent-bootstrap`. Bare stage names state a
stage but not an owner, so on a workstation carrying more than one organisation
two bundles declaring the same stages overwrite each other in the shared
`~/.aws/config` — silently, because nothing about the surviving profile is
malformed. The name is the only place the owner can be recorded.

`default` cannot be namespaced. The script claims it only when nothing else
owns it, and otherwise stops and names the current owner;
`LISA_AWS_CLAIM_DEFAULT_PROFILE=1` takes it over deliberately.

Readiness is an account check, not a liveness check. `sts:GetCallerIdentity`
succeeding proves the credentials work, not that they reached the intended
account — a check that ignores the returned value passes on any credential that
authenticates anywhere. The script compares the returned account id against the
account named in the role ARN it configured and refuses to report ready on a
mismatch, quoting both. Do not substitute a hand-run `get-caller-identity` for
the script's own exit status.

Workstations bootstrapped under the previous unnamespaced convention keep their
old profiles. They are reported by name on every run and removed only when
`LISA_AWS_PRUNE_LEGACY_PROFILES=1` is passed, so the migration is explicit in
both directions.

## Where the bundle lives

`LISA_AWS_BOOTSTRAP_JSON` is **just another secret**, and it belongs wherever
the project keeps its secrets — resolved through `lisa-secrets-access` like
everything else. It is not tied to any one store.

Whoever provisions the IAM user emits the bundle somewhere. `cdkstarter` writes
it to AWS Secrets Manager as `remote-agent-credentials`, but that is where it is
*emitted*, not where it must *live*. Copy it once into the project's configured
provider and read it from there.

**Do not maintain two stores by hand.** A bundle sitting in Secrets Manager
and in the platform's secret store is two live copies of one credential: rotate
the IAM key and whichever copy you forget becomes stale, with nothing to say
which is current. Treat the infrastructure secret as a short-lived deployment
emission and the configured provider as the consumer-facing source of truth.

Publish the emission as part of the same rotation automation. The publisher
reads the candidate on stdin, acquires a provider-backed lock for the exact
bundle record, re-reads the current value after winning, proves every role
before writing, reads the provider value back exactly, proves every stored role
again, and restores the previous provider value if a post-write check fails.
The lock remains held through rollback and its deletion is verified before the
command reports success:

```bash
aws secretsmanager get-secret-value \
  --secret-id <selected-secret-name> \
  --query SecretString \
  --output text \
  | node .claude/skills/lisa-secrets-access/scripts/publish-aws-bootstrap.mjs publish
```

Use the same secret name passed to `--secret-name`; the default is
`remote-agent-credentials`. Add `--profile <source-profile>` only when the
operator's ambient AWS identity cannot read the emission and the project names
a source profile. A named `shared` profile is not otherwise required.

Resolve the script from the installed runtime or `node_modules` when the
`.claude/skills` copy is not present. Never print or place the candidate in an
argument or temporary file. A CDK deployment followed later by a human copy is
not a completed rotation.

The current publisher supports Bitwarden writes. It creates a temporary,
non-secret contender in the bundle's Bitwarden project, elects the oldest
active contender using provider-issued creation metadata, and removes the
contender when the transaction finishes. A contender expires after 30 minutes
so a killed publisher cannot block future rotations forever. The service
account therefore needs create and delete access as well as read and edit
access; `preflight` proves that complete lifecycle without changing the bundle.

Normal remote-session setup is read-only. It refreshes the already-published
bundle but does not enter the publisher election or mutate Bitwarden, so two
containers starting together cannot cause this publication race.

**One provider cannot serve this particular secret.** If `secrets.provider` is
`aws`, reading the bundle requires AWS credentials — and the bundle *is* the AWS
credential. Anything else works: Bitwarden, 1Password, Doppler, Vault, or a
platform secret store. Pick the one that is not the thing being bootstrapped.
Automated publication additionally requires a provider with an implemented
write and coordination path; that is currently Bitwarden.

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

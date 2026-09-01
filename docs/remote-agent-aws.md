# Remote coding-agent AWS access

## Context

Lisa supports AWS CLI access from remote coding environments through one
vendor-neutral bootstrap contract. The AWS side creates one long-lived IAM user
whose only permission is `sts:AssumeRole` on explicitly listed remote-agent
roles. The user has no direct service permissions. Dev and staging roles may
carry the separately reviewed repair policy; production and shared roles are
observer-only.

The cdkstarter agent-operations stack stores a complete JSON bootstrap bundle
in Secrets Manager under the configured `agentOperations.secretName` (the
starter default is `remote-agent-credentials`). Retrieve the secret's
`SecretString` and configure that
entire value—unchanged—as the platform secret `LISA_AWS_BOOTSTRAP_JSON`.
Do not create separate `AWS_ACCESS_KEY_ID` variables: standard AWS variables can
bypass the intended role profile.

## Goal

Give every supported remote coding agent renewable, least-privilege AWS CLI
access without borrowing a developer identity or granting direct production
repair.

## Changes

Lisa provides a shared bootstrap script plus native setup adapters for remote
agent platforms. Dev and staging profiles can observe and repair; production
and shared profiles remain observer-only.

## Implementation

Run the Lisa skill:

```text
/lisa:setup-remote-aws --platform=all
```

It installs `scripts/remote-agent-aws-setup.sh`, adds the Cursor install command,
creates or merges GitHub Copilot's setup workflow, and writes a project-specific
operator guide. The script installs AWS CLI v2, writes a private named bootstrap
profile, creates each account role profile from the bundle, selects `dev` by
default, and proves the result reached the expected account. AWS CLI and SDK
role credentials refresh automatically while the bootstrap key remains valid.

Every profile it writes is scoped `<project>-agent-<stage>`, with the private
source profile at `<project>-agent-bootstrap`. The project component comes from
`LISA_AWS_PROFILE_NAMESPACE`, then the bundle's `namespace`, then
`<owner>-<repository>` from the git origin remote; when none resolves the script
writes nothing. Bare stage names state a stage but not an owner, so on a
workstation carrying more than one organisation two bundles declaring the same
stages overwrite each other in the shared `~/.aws/config` — silently, since the
surviving profile is perfectly well-formed. `default` cannot be namespaced, so
the script claims it only when nothing else owns it and otherwise stops and
names the current owner (`LISA_AWS_CLAIM_DEFAULT_PROFILE=1` overrides).

Readiness is an account check, not a liveness check. `sts:GetCallerIdentity`
succeeding proves the credentials work; it does not prove they reached the
intended account, and a check that never reads the returned value passes on any
credential that authenticates anywhere. The script compares the returned account
id against the account named in the role ARN it just configured and refuses to
report ready on a mismatch, quoting expected and actual. A bundle may declare
`expectedAccountId` per stage — one that disagrees with its own role ARN fails
before anything is written — and `LISA_AWS_VERIFY_ALL_PROFILES=1` proves every
stage rather than only the default.

Workstations bootstrapped before profiles were namespaced still carry the old
bare names. The script names them on stderr on every run and deletes them only
under `LISA_AWS_PRUNE_LEGACY_PROFILES=1`, so nothing is orphaned without saying
so.

| Platform | Configuration scope |
|---|---|
| Claude | Cloud environment: secret `LISA_AWS_BOOTSTRAP_JSON`, plain `LISA_REMOTE_AGENT=claude`, setup command `bash scripts/remote-agent-aws-setup.sh`. |
| Codex | Cloud environment setup secret plus `LISA_REMOTE_AGENT=codex`; allow the required AWS endpoints during the agent phase. |
| Cursor | Cloud-environment secret. The generated `.cursor/environment.json` install command supplies `LISA_REMOTE_AGENT=cursor`. Multi-repository environments can share the configuration. |
| Copilot | Organization-level **Agents** secret. The generated `copilot-setup-steps.yml` supplies `LISA_REMOTE_AGENT=copilot`. |
| Antigravity | Use the script on a user-managed remote host. Google's managed remote-agent preview does not currently document arbitrary AWS credential-file or environment-secret injection. |
| OpenCode | Run the script on the VPS/container hosting `opencode serve`; OpenCode supplies the agent server, not the compute host. |

Any future agent is compatible when it provides a Linux shell, a setup hook,
one opaque secret, a writable home directory, and outbound HTTPS access to AWS
STS and the permitted service endpoints. Set `LISA_REMOTE_AGENT` to a stable
lowercase platform name; that value is used only as the AWS role session name.

Start one remote session and run, using the profile names the setup line
printed:

```bash
aws sts get-caller-identity
aws --profile <project>-agent-staging sts get-caller-identity
aws --profile <project>-agent-production sts get-caller-identity
```

Read the `Account` each one returns and compare it against the account that
stage is supposed to be. A successful call is not the answer.

Then prove the policy boundary: a permitted dev/staging repair action should
reach the service authorization layer, while `iam:PassRole` and a production
mutation must return `AccessDenied`. Production repair continues to use the
human-driven local-workstation role and is not present in the remote container.

## Notes

Store the complete bootstrap bundle only as the masked
`LISA_AWS_BOOTSTRAP_JSON` platform secret. Rotate its IAM access key through
infrastructure and replace the single platform secret everywhere. Disabling or
deleting the bootstrap user immediately prevents new role sessions.

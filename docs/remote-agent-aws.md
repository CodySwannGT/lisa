# Remote coding-agent AWS access

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

## Install repository adapters

Run the Lisa skill:

```text
/lisa:setup-remote-aws --platform=all
```

It installs `scripts/remote-agent-aws-setup.sh`, adds the Cursor install command,
creates or merges GitHub Copilot's setup workflow, and writes a project-specific
operator guide. The script installs AWS CLI v2, writes a private named bootstrap
profile, creates each account role profile from the bundle, selects `dev` by
default, and verifies the result with `sts:GetCallerIdentity`. AWS CLI and SDK
role credentials refresh automatically while the bootstrap key remains valid.

## Configure each remote platform

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

## Operator verification

Start one remote session and run:

```bash
aws sts get-caller-identity
aws --profile staging sts get-caller-identity
aws --profile production sts get-caller-identity
```

Then prove the policy boundary: a permitted dev/staging repair action should
reach the service authorization layer, while `iam:PassRole` and a production
mutation must return `AccessDenied`. Production repair continues to use the
human-driven local-workstation role and is not present in the remote container.

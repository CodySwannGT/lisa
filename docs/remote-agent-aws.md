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

Then prove the policy boundary, in this order. **The order is the check.**
`AccessDenied` is what an unassumed role, a misconfigured profile and a
correctly-scoped observer all return, so a boundary assertion made before the
profile is bound to its expected account passes on a credential that reached
some other account entirely — the same vacuous pass this contract already
refuses for `sts:GetCallerIdentity`. Bind identity first, then assert the
boundary: a permitted dev/staging repair action should reach the service
authorization layer, while `iam:PassRole` and a production mutation must return
`AccessDenied`. Production repair continues to use the human-driven
local-workstation role and is not present in the remote container.

That is only half a proof, and it is the half that cannot fail for the right
reason. **A role that can read nothing at all satisfies every deny-side
assertion above.** Prove the allow side too:

```bash
LISA_AWS_VERIFY_OBSERVER_READS=1 bash scripts/remote-agent-aws-setup.sh
```

which runs one representative read per surface below against every observer
profile and refuses to report ready if any is denied, naming all of them at
once rather than one per run.

## What observer-only GRANTS

Observer-only has been stated as a list of things a role must not do. That is
not a definition a policy author can implement, and the consequence was
measured: the read surface of a headless verifier got discovered by
`AccessDenied`, one action at a time, at verification time. Three consecutive
incidents in one consumer had that shape — instance discovery, alarm reads, and
pipeline definition reads — each stalling a verification, each costing a ticket
and a deploy.

The surfaces below are derived from the role's purpose — *what must a headless
verifier be able to read?* — rather than from the services any one stack happens
to deploy. Every action is read-only. Widening the allow side generously grants
no write anywhere, and it is far cheaper than rediscovering the list by denial.

| surface | representative read | what an observer cannot answer without it |
|---|---|---|
| deployment stacks | `cloudformation describe-stacks` | what is deployed, and did the last change apply or roll back |
| compute inventory | `ec2 describe-instances` | what is actually running, and is it healthy |
| alarm state | `cloudwatch describe-alarms` | is anything alarming right now, and since when |
| delivery pipelines | `codepipeline list-pipelines` | what the pipeline does and where this change stopped — the **definition** as well as the executions |
| builds | `codebuild list-projects` | did the build run, and what did it say |
| functions | `lambda list-functions` | is the handler deployed, and at which version |
| logs | `logs describe-log-groups` | what it printed when it failed |
| http endpoints | `apigateway get-rest-apis` | is the endpoint published and reachable |
| queues | `sqs list-queues` | is work backing up or dead-lettering |
| workflows | `stepfunctions list-state-machines` | did the orchestrated run complete or stall |

Each probe names no resource, so it asks an IAM question rather than an
inventory one: an empty result against a fresh account is a pass, and only a
missing permission fails. The limitation that buys is worth stating — a surface
whose *list* action is granted while its *detail* action is not still passes the
probe. That is exactly the third incident, where the role could list pipeline
executions but could not read the pipeline definition, so the requirement covers
both halves even though the probe can only reach one. Grant the detail reads for
each surface too; the probe proves the surface is reachable, not that every
action on it is granted.

A stage is treated as an observer when its bundle entry sets `"observer": true`,
and otherwise when it is named `production` or `shared` — the definition this
document already states. Dev and staging profiles are not probed, because they
may carry the repair policy and failing them for holding it would be wrong.

## Notes

Store the complete bootstrap bundle only as the masked
`LISA_AWS_BOOTSTRAP_JSON` platform secret. Rotate its IAM access key through
infrastructure and replace the single platform secret everywhere. Disabling or
deleting the bootstrap user immediately prevents new role sessions.

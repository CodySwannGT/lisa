---
name: setup-aws-accounts
description: "Provision the multi-account AWS environment a Lisa CDK project deploys into, using the @codyswann/aws-soc2-setup CLI (AWS Organizations, Control Tower, IAM Identity Center, SOC 2 controls). Use when a CDK project still has PLACEHOLDER account IDs in config/environments.ts, when asked to create the dev/staging/production/shared AWS accounts, or when CDK deploys fail because accounts, SSO profiles, or bootstrap are missing. Drives the CLI for the org + OU + security foundation and Account Factory account vending, writes the AWS SSO profiles the project's scripts expect, runs cdk bootstrap with cross-account pipeline trust, replaces PLACEHOLDER account IDs, sets the AWS_ACCOUNT_ID_* GitHub secrets when CI uses them, and records the account map in .lisa.config.json. Idempotent — safe to re-run. Console-only prerequisites (root MFA, enabling Identity Center, creating the Control Tower landing zone) are surfaced as an explicit human checklist, never automated."
allowed-tools: ["Bash", "Read", "Edit", "Write", "AskUserQuestion"]
---

# Setup AWS Accounts (SOC 2 Landing Zone)

Provision and wire the AWS accounts a CDK project deploys into. The account
supply side runs through the [`@codyswann/aws-soc2-setup`](https://www.npmjs.com/package/@codyswann/aws-soc2-setup)
CLI (AWS Organizations, Control Tower, IAM Identity Center, security services,
SOC 2 controls); the demand side — profiles, `cdk bootstrap`, config files, CI
secrets — is wired by this skill so the project goes from `PLACEHOLDER` account
IDs to deployable in one flow.

## When to use

- A CDK project's `config/environments.ts` still has `accountId: "PLACEHOLDER"`
  entries, so `cdk deploy` silently skips those environments.
- The user asks to "create the AWS accounts", "set up dev/staging/production
  accounts", "bootstrap AWS for this project", or similar.
- `scripts/pre-deployment-checklist.sh` fails because `<prefix>-<env>` AWS
  profiles don't exist or don't authenticate.
- A fresh organization needs the SOC 2 foundation (Control Tower, guardrails,
  security services) before workload accounts are vended.

Not for: deploying stacks (that's `cdk deploy` / CI), or GitHub repo governance
(that's `lisa-setup-github-repo`).

## How the CLI behaves (read before scripting it)

- Invoke as `npx -y @codyswann/aws-soc2-setup@1 <command>`. Pin at least the
  major version — an unpinned `npx` pull is a supply-chain risk for a tool that
  runs with management-account credentials. Always set `NO_COLOR=1` so output
  parses cleanly.
- It is an **actuator, not an API** — no `--json` output. Drive it for side
  effects, then read authoritative state back with the plain `aws` CLI
  (`aws organizations list-accounts`, `aws sts get-caller-identity`). Never
  trust scraped text alone for account IDs.
- It is idempotent per resource (ensure-semantics against live AWS), so
  re-running `setup` is safe — **except** `controltower provision-account`,
  which is not deduped by name. Always check `aws organizations list-accounts`
  before provisioning and skip accounts that already exist.
- `--dry-run` previews every mutating command; `status` and `whoami` are
  read-only.
- `controltower provision-account -o` takes the OU **name** (e.g. `Workloads`);
  `register-ou` and `enable-controls` take the OU **id/ARN**. Don't mix them up.

## Step 1 — Assess the environment (read-only)

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 whoami -p <management-profile> -r <region>
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 status -p <management-profile> -r <region>
```

`status` reports five independent checks: credentials, Organizations,
recommended OUs, IAM Identity Center, member accounts.

**The human gate.** Three prerequisites are console-only and must never be
automated. If `status` shows Identity Center or the landing zone missing, stop
and present this checklist in plain language a non-technical operator can
follow, then end the run:

1. Sign in to the AWS console as the account **root** user and enable MFA on
   the root account.
2. In the console, enable **IAM Identity Center** (in your home region).
3. In the console, create the **AWS Control Tower landing zone** (this creates
   the Audit and Log Archive accounts; takes ~30–60 minutes).
4. Configure a management-account admin profile locally:
   `aws configure sso` (interactive).

Re-run this skill after those are done — Step 1 will pass and the flow
continues from wherever it left off.

## Step 2 — Gather inputs

Collect (via arguments if provided, `AskUserQuestion` otherwise; use stated
defaults when running unattended):

| Input | Default | Notes |
| --- | --- | --- |
| Management profile | `AWS_PROFILE` | Must be the org management account |
| Region | `us-east-1` | Match the project's `config/environments.ts` |
| Profile prefix | project name from `package.json` | Matches `AWS_PROFILE_PREFIX` used by `scripts/pre-deployment-checklist.sh` |
| Environments | `dev`, `staging`, `production`, `shared` | `shared` hosts the pipeline and gets cross-account trust |
| Root email pattern | ask — no safe default | Each account needs a **unique** root email; suggest plus-addressing: `aws+<prefix>-<env>@<domain>` |
| Identity Center username | ask — no safe default | The Identity Store user that gets `AWSAdministratorAccess` on each new account in Step 5; verify it exists (create with `sso create-user` if not) |
| Identity Center start URL | from `status` output or the console | The **full** `sso_start_url` for the `sso-session` block in Step 5 (default form `https://<domain>.awsapps.com/start`, but custom domains differ — never reconstruct it from parts) |

## Step 3 — Foundation (org, OUs, controls, security services)

Show the plan, get explicit approval, then apply:

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 setup --dry-run -p <mgmt> -r <region>
```

Present the dry-run output and **stop for confirmation** before mutating the
organization — `AskUserQuestion` when interactive, or an unambiguous
apply/confirm argument from the caller when running unattended. Silence is not
approval. Only then:

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 setup -p <mgmt> -r <region> \
  [--ou <workloads-ou-id>] [--central-account <id>] [--admin-account <id>] [--audit-account <id>]
```

This ensures the organization, creates the Infrastructure/Workloads/Sandbox
OUs, enables the security services (GuardDuty, Security Hub, Config, …),
conformance packs, and — when `--ou` is passed — registers the OU with Control
Tower and enables the SOC 2 control baseline. Safe to re-run.

## Step 4 — Vend the workload accounts

For each environment, **first** check it doesn't already exist:

```bash
aws organizations list-accounts --profile <mgmt> \
  --query "Accounts[?Name=='<prefix>-<env>'].{Id:Id,Name:Name,State:State}" --output table
```

(Use `State`, not `Status` — AWS is retiring the `Status` field in favor of
`State`.)

Then provision the missing ones, one at a time, each with a unique root email.
Stage accounts go into the `Workloads` OU:

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 controltower provision-account \
  -p <mgmt> -r <region> \
  -n <prefix>-<env> -e aws+<prefix>-<env>@<domain> -o Workloads --wait
```

The `shared` (pipeline) account goes into `Infrastructure` instead:

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 controltower provision-account \
  -p <mgmt> -r <region> \
  -n <prefix>-shared -e aws+<prefix>-shared@<domain> -o Infrastructure --wait
```

`--wait` polls Account Factory (~minutes per account) and prints
`New account ID: <id>`. After all accounts finish, harvest the authoritative
env → account-ID map from `aws organizations list-accounts` — that map drives
every later step.

## Step 5 — Identity Center access + local AWS profiles

Grant the operator admin on each new account, using the Identity Center
username collected in Step 2:

```bash
NO_COLOR=1 npx -y @codyswann/aws-soc2-setup@1 sso assign \
  -p <mgmt> -u <username> -a <account-id> -r AWSAdministratorAccess
```

(or `sso group -g <prefix>-admins --all-users -a <account-id> -r AWSAdministratorAccess`
for group-based access. If the user doesn't exist yet, create it first with
`sso create-user`.)

The CLI does **not** generate AWS CLI profiles — write them yourself. Append to
`~/.aws/config` (never overwrite existing sections; skip blocks that already
exist):

```ini
[sso-session <prefix>]
sso_start_url = <start-url>
sso_region = <region>
sso_registration_scopes = sso:account:access

[profile <prefix>-dev]
sso_session = <prefix>
sso_account_id = <dev-account-id>
sso_role_name = AWSAdministratorAccess
region = <region>
```

`<start-url>` is the full Identity Center start URL collected in Step 2 —
paste it verbatim, never rebuild it from a domain fragment. One
`[profile <prefix>-<env>]` block per environment — this exact naming is
what `scripts/pre-deployment-checklist.sh` and the db-connect scripts resolve.
Then authenticate and verify every profile maps to the expected account:

```bash
aws sso login --sso-session <prefix>
for env in dev staging production shared; do
  aws sts get-caller-identity --profile <prefix>-$env --query Account --output text
done
```

## Step 6 — CDK bootstrap with pipeline trust

Bootstrap the shared (pipeline) account first, then each stage account with
trust back to shared. Honor the project's `CDK_BOOTSTRAP_QUALIFIER` and
`CDK_BOOTSTRAP_EXECUTION_POLICY_ARN` env vars rather than hardcoding their
defaults (`config/env.ts` defaults: `hnb659fds` /
`arn:aws:iam::aws:policy/AdministratorAccess`):

```bash
qualifier="${CDK_BOOTSTRAP_QUALIFIER:-hnb659fds}"
exec_policy="${CDK_BOOTSTRAP_EXECUTION_POLICY_ARN:-arn:aws:iam::aws:policy/AdministratorAccess}"

npx cdk bootstrap aws://<shared-id>/<region> --profile <prefix>-shared \
  --qualifier "$qualifier"

for env in dev staging production; do
  npx cdk bootstrap aws://<env-id>/<region> --profile <prefix>-$env \
    --qualifier "$qualifier" \
    --trust <shared-id> \
    --cloudformation-execution-policies "$exec_policy"
done
```

The `--trust` flag is the manual chicken-and-egg step the project's
`trust-policy-stack` documents as CfnOutputs — this skill is where it actually
runs.

## Step 7 — Wire the project

1. **`config/environments.ts`** (when the project has it): replace each
   environment's `accountId: "PLACEHOLDER"` with the real 12-digit ID from the
   Step 4 map, and confirm `region` matches. This single edit is what flips
   each environment from synth-only to deployable. If the project uses a
   different layout, skip with a note — the `.lisa.config.json` record below
   still applies.
2. **GitHub secrets** — only when `.github/workflows/ci.yml` references them:
   ```bash
   gh secret set AWS_ACCOUNT_ID_DEV --body "<dev-id>"
   gh secret set AWS_ACCOUNT_ID_STAGING --body "<staging-id>"
   gh secret set AWS_ACCOUNT_ID_PRODUCTION --body "<production-id>"
   gh secret set AWS_INFRA_ACCOUNT_ID --body "<shared-id>"
   ```
3. **`.lisa.config.json`** — record the machine-readable account map (merge
   with `jq`, preserving every other key):
   ```json
   {
     "aws": {
       "region": "<region>",
       "profilePrefix": "<prefix>",
       "accounts": {
         "dev": "<dev-id>",
         "staging": "<staging-id>",
         "production": "<production-id>",
         "shared": "<shared-id>"
       }
     }
   }
   ```

## Step 8 — Verify and report

- Every `<prefix>-<env>` profile authenticates to its expected account ID
  (`aws sts get-caller-identity`).
- `scripts/pre-deployment-checklist.sh` passes when the project ships it.
- `npx cdk synth` succeeds and no environment is skipped as non-deployable.
- Report a table: environment → account ID → profile → bootstrapped (yes/no).
- Name what remains manual, in operator-readable language — e.g. the GitHub
  CodeConnections handshake for pipeline mode (`config/github.ts`
  `codeConnectionArn`) is an interactive console step outside this skill's
  scope, and hardening extras (`root remove-access`, `scp deny-iam-users`,
  `scp alert-management`) are offered but require explicit confirmation since
  they are org-wide and destructive.

## Cross-agent invocation

The same SKILL.md ships to every supported runtime via the plugin build; all
logic lives here, never in the command shim.

- Claude Code / OpenCode / Cursor: `/lisa-cdk:setup:aws` command, or invoke the
  skill directly.
- Codex (no slash commands): `$setup-aws-accounts` (the command shim also
  installs as `$lisa-setup-aws`).
- agy / Copilot: the skill is delivered through the generated plugin variants;
  invoke it by name.

## Rules

- **Never automate the console-only steps** (root MFA, enabling Identity
  Center, landing zone creation). Present the checklist, stop, and let a human
  do them. Every blocked reason must be readable by a non-technical operator.
- Always `--dry-run` (or `status`) first and show the plan before mutating an
  organization. `root` and `scp` subcommands are destructive org-wide — never
  run them without explicit user confirmation in this session.
- Check before create: `list-accounts` before `provision-account`; read
  `~/.aws/config` before appending profile blocks; never clobber existing
  profiles or config keys.
- Harvest account IDs from `aws organizations list-accounts`, not from scraped
  CLI text.
- Never write credentials or secrets into the repository. Account IDs are not
  secret and belong in config; keys and tokens never do.
- Do not stage or modify unrelated working-tree files; the only repo edits are
  `config/environments.ts` and `.lisa.config.json`.

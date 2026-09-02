# GitHub Actions Configuration

This directory contains the CI/CD workflows and automation for the project. This document explains how to configure and use the GitHub Actions workflows.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Workflows](#workflows)
- [Secrets Configuration](#secrets-configuration)
- [Repository Variables](#repository-variables)
- [External Service Setup](#external-service-setup)
- [Customization](#customization)

## Overview

The CI/CD system provides:

- **Quality Gates**: Linting, type checking, formatting, and testing
- **Security Scanning**: Vulnerability detection, secret scanning, license compliance
- **Release Management**: Automated versioning, changelogs, and GitHub releases
- **Mobile Builds**: Expo EAS builds for iOS and Android
- **OTA Updates**: Expo EAS Update deployments
- **Performance Testing**: Lighthouse CI for web, k6 load testing
- **AI Integration**: Claude Code for automated code review and assistance

## Quick Start

### Minimum Configuration

To get started with basic CI, add these secrets to your repository:

```bash
# No secrets required for basic quality checks (lint, typecheck, build, format)
```

### Recommended Configuration

For full functionality, configure the following secrets:

| Secret | Purpose | Required For |
|--------|---------|--------------|
| `EXPO_TOKEN` | EAS builds and updates | Mobile deployment |
| `SENTRY_AUTH_TOKEN` | Error tracking | Release monitoring |
| `SONAR_TOKEN` | Code quality analysis | Security scanning |
| `SNYK_TOKEN` | Vulnerability scanning | Security scanning |

## Workflows

### CI Quality Checks (`ci.yml`)

**Triggers**: Pull requests, manual dispatch

Runs on every pull request to validate code quality:

- Lint (ESLint)
- Type checking (TypeScript)
- Formatting (Prettier)
- Build verification
- Security scans (when configured)
- Lighthouse CI (web performance)

**Configuration**:
```yaml
# In ci.yml, modify these inputs:
node_version: '22.21.1'
package_manager: 'bun'
skip_jobs: 'test:e2e,playwright_e2e'  # Exact comma-separated job ids
```

### Release and Deploy (`deploy.yml`)

**Triggers**: Push to `main`, `staging`, or `dev` branches; manual dispatch

Handles the complete release lifecycle:

1. Creates a new release with version bump
2. Generates changelog from commits
3. Triggers EAS build (if `app.config.ts` changed)
4. Publishes OTA update via EAS Update
5. Creates Sentry release (if configured)

**Environment Mapping**:
| Branch | Environment | EAS Channel |
|--------|-------------|-------------|
| `dev` | development | dev |
| `staging` | staging | staging |
| `main` | production | production |

### EAS Build (`build.yml`)

**Triggers**: Changes to `app.config.ts`, manual dispatch, workflow call

Builds native app binaries via Expo Application Services:

- **dev**: Development preview builds
- **staging**: Staging builds with auto-submit to TestFlight/Play Console
- **production**: Production builds with auto-submit

### Quality Checks (`quality.yml`)

**Type**: Reusable workflow

Comprehensive quality validation with 20+ configurable jobs. Called by other workflows.

**Skippable Jobs**:
```
lint, typecheck, test, test:unit, test:integration,
maestro_e2e, format, build, npm_security_scan,
sonarcloud, snyk, secret_scanning, license_compliance,
e2e_coverage, test:mutation, learnings_budget, threshold_ratchet,
dead_code, sg_scan
```

`skip_jobs` entries are exact comma-delimited job ids. For example,
`test:unit` skips only the unit-test job; it does not skip `test` or
`test:integration`.

**Accepted but inert.** `test:e2e`, `playwright_e2e` and `github_issue` are
still accepted and suppress nothing — the browser suite lives in
`playwright-e2e.yml`, which takes no `skip_jobs` at all and is governed by the
`e2e-browser` gate instead. Keep passing them if your `ci.yml` already does;
removing them changes nothing either way.

> **Before taking this release, check your ruleset.** If it requires
> `🔍 Quality Checks / 🧪 Run E2E Tests`, **de-require that context first**. The
> job that posted it no longer exists, and a required context that never reports
> is pending forever — it blocks every open pull request until someone removes
> it. Nothing removes it for you: `lisa-reconcile-policy.mjs` adds what is
> missing and never deletes what is extra unless you pass `--prune`. Check with
> `gh api repos/OWNER/NAME/rules/branches/main --jq '.[] |
> select(.type=="required_status_checks") |
> .parameters.required_status_checks[].context'`.

Migration note: NestJS and Expo CI templates default to
`test:e2e,playwright_e2e`, so unit and integration jobs run on
promotion PRs as well as ordinary feature PRs. Projects that intentionally
disable those jobs must list `test` or `test:integration` explicitly. Both
remaining tokens are inert, and the default is left as it is on purpose:
an installed project's `ci.yml` still carries them, and every token a caller
passes has to stay declared.

### Release (`release.yml`)

**Type**: Reusable workflow

Enterprise-grade release management:

- Version strategies: `standard-version`, `semantic`, `calendar`, `custom`
- Changelog generation
- GPG signing (optional)
- SBOM generation
- Sentry release creation
- Jira release creation
- Compliance validation (SOC2, ISO27001, HIPAA, PCI-DSS)
- Optional human-approval gate (`require_approval` + `approval_environment`)

**Human-approval gate**: pass `require_approval: true` and the run pauses at the
`🚦 Release Approval` job until a required reviewer approves it in the Actions UI.
The pause is enforced by the GitHub Environment named in `approval_environment`
(falls back to `environment`, i.e. the branch name):

```yaml
uses: CodySwannGT/lisa/.github/workflows/release.yml@main
with:
  require_approval: true
  approval_environment: 'production'
```

Because everything downstream (versioning, GitHub Release, and any deploy job
that `needs: release`) chains off this gate, approval blocks the whole pipeline.
The Lisa stack `deploy.yml` templates wire both inputs automatically from the
optional `github.environments` block in `.lisa.config.json`, mapping the branch
to its friendly environment name (`main` → `production` via `deploy.branches`).
The environment itself — required reviewers and a deployment branch policy —
is provisioned by `/lisa:setup:github-repo`. Provision before enabling the gate:
GitHub auto-creates unprovisioned environments **without** protection rules, so
an unprovisioned gate blocks nothing. Not yet wired for rails
(`release-rails.yml` doesn't thread approval inputs) or harper-fabric (no
release.yml call).

**Blackout Periods** (configurable):
- Production: No weekends, no late nights (10 PM - 6 AM)
- Holiday blackouts: Dec 24 - Jan 2, Jul 3-5, Nov 27-29

### Lighthouse CI (`lighthouse.yml`)

**Type**: Reusable workflow

Web performance budget validation using Google Lighthouse.

### Load Testing (`load-test.yml`)

**Type**: Reusable workflow

Performance load testing using k6:

- Scenarios: `smoke`, `load`, `stress`, `spike`, `soak`
- Configurable thresholds
- Result artifact uploads

## Secrets Configuration

### How to Add Secrets

1. Go to **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Enter the secret name and value

Or use the GitHub CLI:
```bash
gh secret set SECRET_NAME --body "secret-value"
```

For bulk setup, copy `.github/workflows/.env.example` and run:
```bash
gh secret set --env-file .env
```

### Core Secrets

#### EXPO_TOKEN
**Purpose**: Authenticate with Expo/EAS for builds and updates

**How to get it**:
1. Go to [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)
2. Click **Create Token**
3. Name it (e.g., "GitHub Actions")
4. Copy the token (starts with `expo_`)

**Required for**: EAS Build, EAS Update

---

#### SENTRY_AUTH_TOKEN
**Purpose**: Create releases and upload sourcemaps to Sentry

**How to get it**:
1. Go to [sentry.io/settings/account/api/auth-tokens/](https://sentry.io/settings/account/api/auth-tokens/)
2. Click **Create New Token**
3. Select scopes: `project:releases`, `project:write`
4. Copy the token

**Required for**: Error tracking, release monitoring

---

#### SONAR_TOKEN
**Purpose**: Authenticate with SonarCloud for code quality analysis

**How to get it**:
1. Go to [sonarcloud.io/account/security](https://sonarcloud.io/account/security)
2. Click **Generate Tokens**
3. Name your token and generate
4. Copy the token

**Required for**: Static code analysis (SAST)

**Additional Setup**:
Create `sonar-project.properties` in your repo root:
```properties
sonar.projectKey=your-org_your-project
sonar.organization=your-org
```

---

#### SNYK_TOKEN
**Purpose**: Scan dependencies for known vulnerabilities

**How to get it**:
1. Go to [app.snyk.io/account](https://app.snyk.io/account)
2. Find **Auth Token** section
3. Click **click to show** and copy

**Required for**: Dependency vulnerability scanning

---

#### GITGUARDIAN_API_KEY
**Purpose**: Detect hardcoded secrets in code

**How to get it**:
1. Go to [dashboard.gitguardian.com/api/personal-access-tokens](https://dashboard.gitguardian.com/api/personal-access-tokens)
2. Click **Create new token**
3. Select scope: `scan`
4. Copy the token

**Required for**: Secret detection

---

#### FOSSA_API_KEY
**Purpose**: License compliance checking for dependencies

**How to get it**:
1. Go to [app.fossa.com/account/settings/integrations/api_tokens](https://app.fossa.com/account/settings/integrations/api_tokens)
2. Click **Add API Token**
3. Copy the token

**Required for**: License compliance

---

#### CLAUDE_CODE_OAUTH_TOKEN
**Purpose**: Enable Claude AI code assistance in issues and PRs

**How to get it**:
1. Visit [claude.ai/code](https://claude.ai/code) or your Anthropic Console
2. Generate an OAuth token for GitHub integration
3. Copy the token

**Required for**: `@claude` mentions in issues/PRs

---

#### K6_CLOUD_TOKEN
**Purpose**: Run load tests on k6 Cloud infrastructure

**How to get it**:
1. Go to [app.k6.io/account/api-token](https://app.k6.io/account/api-token)
2. Copy your API token

**Required for**: Cloud-based load testing

---

#### DEPLOY_KEY
**Purpose**: Push version bumps and releases to protected branches

GitHub Actions workflows cannot push directly to protected branches using the default `GITHUB_TOKEN`. A deploy key (SSH key) with write access bypasses branch protection rules for automated releases.

**How to set it up**:

1. **Generate an SSH key pair locally**:
   ```bash
   # Generate a new SSH key (no passphrase for CI use)
   ssh-keygen -t ed25519 -C "github-actions-deploy-key" -f deploy_key -N ""

   # This creates two files:
   # - deploy_key (private key - goes to GitHub Secrets)
   # - deploy_key.pub (public key - goes to Deploy Keys)
   ```

2. **Add the public key to GitHub Deploy Keys**:
   - Go to your repository **Settings** > **Deploy keys**
   - Click **Add deploy key**
   - Title: `GitHub Actions Deploy Key`
   - Key: Paste contents of `deploy_key.pub`
   - **Check "Allow write access"** (required for pushing)
   - Click **Add key**

3. **Add the private key as a repository secret**:
   ```bash
   # Using GitHub CLI
   gh secret set DEPLOY_KEY < deploy_key

   # Or manually:
   # Go to Settings > Secrets and variables > Actions
   # Click "New repository secret"
   # Name: DEPLOY_KEY
   # Value: Paste entire contents of deploy_key file (including BEGIN/END lines)
   ```

4. **Clean up local keys**:
   ```bash
   # Delete the local key files after setup
   rm deploy_key deploy_key.pub
   ```

**Required for**: Automated releases pushing to protected branches (main, staging, dev)

**Note**: If your branch protection rules require signed commits, you'll also need to set up GPG signing (see Release Signing Secrets below).

---

### Release Signing Secrets (Optional)

For GPG-signed releases:

| Secret | Description |
|--------|-------------|
| `RELEASE_SIGNING_KEY` | Base64-encoded GPG private key |
| `SIGNING_KEY_ID` | GPG key ID |
| `SIGNING_KEY_PASSPHRASE` | GPG key passphrase |

To generate:
```bash
# Generate GPG key
gpg --full-generate-key

# Export and base64 encode
gpg --export-secret-keys YOUR_KEY_ID | base64 > signing-key.txt
```

---

### Jira Integration Secrets (Optional)

| Secret | Description |
|--------|-------------|
| `JIRA_API_TOKEN` | API token from Atlassian |
| `JIRA_AUTOMATION_WEBHOOK` | Webhook URL for Jira automation |

**How to get JIRA_API_TOKEN**:
1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Copy the token

## Repository Variables

Variables are non-sensitive configuration values. Set them in **Settings** > **Secrets and variables** > **Actions** > **Variables**.

| Variable | Description | Example |
|----------|-------------|---------|
| `ENABLE_CLAUDE_NIGHTLY` | Enable nightly Claude workflows | `true` |
| `ENABLE_CLAUDE_CODE_REVIEW_RESPONSE` | Enable Claude response to CodeRabbit reviews | `true` |
| `JIRA_BASE_URL` | Jira instance base URL (enables Jira triage workflow) | `https://company.atlassian.net` |
| `JIRA_USER_EMAIL` | Email associated with the Jira API token | `user@company.com` |
| `JIRA_PROJECT_KEY` | Jira project key for ticket queries | `PROJ` |
| `SENTRY_ORG` | Sentry organization slug | `my-company` |
| `SENTRY_PROJECT` | Sentry project slug | `frontend-app` |

## External Service Setup

### SonarCloud

1. Sign in at [sonarcloud.io](https://sonarcloud.io)
2. Import your GitHub repository
3. Create `sonar-project.properties`:
   ```properties
   sonar.projectKey=org_project
   sonar.organization=org
   sonar.sources=src
   sonar.exclusions=**/node_modules/**,**/*.test.*
   ```

### Expo/EAS

1. Install EAS CLI: `npm install -g eas-cli`
2. Login: `eas login`
3. Configure project: `eas init`
4. Create `eas.json` with build profiles

### Sentry

1. Create a project at [sentry.io](https://sentry.io)
2. Note your organization and project slugs
3. Configure Sentry in your app (see Sentry React Native docs)

### Maestro Cloud (Mobile E2E)

1. Sign up at [cloud.mobile.dev](https://cloud.mobile.dev)
2. Create a project and note the project ID
3. Generate an API key
4. Add `MAESTRO_API_KEY` secret
5. Pass `maestro_project_id` input to quality workflow

## Customization

### Skipping Jobs

Add to your workflow call:
```yaml
uses: ./.github/workflows/quality.yml
with:
  skip_jobs: 'test:e2e,maestro_e2e,playwright_e2e'
```

### Compliance Frameworks

Enable compliance validation:
```yaml
uses: ./.github/workflows/quality.yml
with:
  compliance_framework: 'soc2'  # or iso27001, hipaa, pci-dss
```

**Note**: quality.yml's `approval_gate` job only records an audit artifact; it
does not pause the run. Do not pass `require_approval` or `approval_environment`
to this quality.yml example. For an enforced human gate, pass those inputs to
release.yml and create the environment in **Settings** > **Environments** first
(or declare it under `github.environments` in `.lisa.config.json` and run
`/lisa:setup:github-repo`).

### Custom Node Version

```yaml
uses: ./.github/workflows/quality.yml
with:
  node_version: '22.21.1'
  package_manager: 'bun'  # or npm, yarn
```

### Load Test Scenarios

```yaml
uses: ./.github/workflows/load-test.yml
with:
  test_scenario: 'stress'  # smoke, load, stress, spike, soak
  base_url: 'https://api.example.com'
  virtual_users: 100
  test_duration: '10m'
```

## Directory Structure

```
.github/
├── workflows/
│   ├── ci.yml                              # PR quality checks
│   ├── deploy.yml                          # Release and deploy
│   ├── build.yml                           # EAS builds
│   ├── quality.yml                         # Reusable quality checks
│   ├── release.yml                         # Reusable release workflow
│   ├── lighthouse.yml                      # Web performance
│   ├── load-test.yml                       # k6 load testing
│   └── .env.example                            # Secrets template
└── k6/
    ├── scripts/                            # Test scripts
    ├── scenarios/                          # Test configurations
    ├── thresholds/                         # Performance thresholds
    └── README.md                           # K6 documentation
```

## Troubleshooting

### "Secret not found" errors
Ensure the secret is added to the repository, not just your local environment.

### SonarCloud scan fails
Verify `sonar-project.properties` exists and `SONAR_TOKEN` is set.

### EAS builds fail
Check `EXPO_TOKEN` is valid and has necessary permissions.

### Deployment fails on protected branches
Add `DEPLOY_KEY` (SSH deploy key) for pushing version bumps.

## Related Documentation

- [K6 Load Testing Guide](.github/k6/README.md)
- [K6 Scenario Selection Guide](.github/k6/SCENARIO_SELECTION_GUIDE.md)
- [Expo EAS Documentation](https://docs.expo.dev/eas/)
- [SonarCloud Documentation](https://docs.sonarcloud.io/)
- [Sentry React Native](https://docs.sentry.io/platforms/react-native/)

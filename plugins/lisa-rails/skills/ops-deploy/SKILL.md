---
name: ops-deploy
description: Deploy Rails applications via Kamal or CI/CD branch push to staging or production environments.
allowed-tools:
  - Bash
  - Read
---

# Ops: Deploy

Deploy the Rails application to remote environments.

**Argument**: `$ARGUMENTS` — environment (`staging`, `production`) and optional method (`kamal`, `ci`; default: `kamal`)

## Safety

**CRITICAL**: Production deployments require explicit human confirmation before proceeding. Always ask for confirmation when `$ARGUMENTS` contains `production`.

## Discovery

1. Read `config/deploy.yml` to discover the Kamal configuration: service name, registry, image, servers, accessories
2. Read `config/deploy.staging.yml` and `config/deploy.production.yml` for environment-specific overrides
3. Verify the specific environment-variable keys needed for the deploy are present in `.env.staging` / `.env.production` (or in SSM) without printing secret values
4. Read `Dockerfile` to understand the Docker build stages

## CI/CD Path (Preferred)

The standard deployment path is via CI/CD — pushing to environment branches triggers auto-deploy.

```bash
# Deploy to staging via CI/CD
git push origin HEAD:staging

# Deploy to production via CI/CD (requires human confirmation first)
git push origin HEAD:production
```

Monitor the deployment via GitHub Actions:

```bash
gh run list --branch {environment} --limit 3
gh run watch {run-id}
```

## Kamal Deployment (Manual)

### Pre-Deploy Checks

1. **Verify Kamal is installed**:
   ```bash
   kamal version
   ```

2. **Verify Docker builds locally**:
   ```bash
   docker build -t {app_name}:test .
   ```

3. **Check current deployment state**:
   ```bash
   kamal details -d {environment}
   ```

4. **Check for deploy lock**:
   ```bash
   kamal lock status -d {environment}
   ```
   If locked from a previous interrupted deploy: `kamal lock release -d {environment}`

### Deploy to Staging

```bash
kamal deploy -d staging
```

### Deploy to Production

**Requires explicit human confirmation.**

```bash
kamal deploy -d production
```

### Deploy with Specific Git Ref

```bash
kamal deploy -d {environment} --version {git-sha-or-tag}
```

### Rollback

If a deploy causes issues, roll back to the previous version:

```bash
# List available versions
kamal app containers -d {environment}

# Rollback to previous version
kamal rollback {previous-version} -d {environment}
```

## Post-Deploy Verification

After any deployment:

1. **Health check** the deployed environment:
   ```bash
   curl -sf -o /dev/null -w "HTTP %{http_code} in %{time_total}s" https://{app_host}/up
   ```

2. **Verify ECS service stability** (running count matches desired count):
   ```bash
   aws ecs describe-services \
     --cluster {cluster-name} \
     --services {service-name} \
     --region {aws-region} \
     --query 'services[0].{Running:runningCount,Desired:desiredCount,Status:status}' \
     --output table
   ```

3. **Check for migration status** (if migrations were included):
   ```bash
   kamal app exec --roles=web "bin/rails db:migrate:status" -d {environment}
   ```

4. **Check logs** for errors in the first 5 minutes (use `ops-check-logs` skill)

5. **Verify Solid Queue workers** are running (use `ops-verify-jobs` skill)

6. **Verify OpenTelemetry traces** are being exported (use `ops-verify-telemetry` skill)

## Kamal Utility Commands

| Command | Purpose |
|---------|---------|
| `kamal details -d {env}` | Show current deployment details |
| `kamal app logs -d {env}` | Tail application logs |
| `kamal app exec --roles=web "bin/rails console" -d {env}` | Open Rails console on remote |
| `kamal audit -d {env}` | Show deploy audit log |
| `kamal env push -d {env}` | Push updated environment variables |
| `kamal lock status -d {env}` | Check deploy lock status |
| `kamal lock release -d {env}` | Release a stale deploy lock |
| `kamal traefik reboot -d {env}` | Restart the Traefik proxy |

## Output Format

Report deployment result as a table:

| Target | Environment | Method | Status | Verification |
|--------|-------------|--------|--------|-------------|
| Rails app | staging | Kamal | SUCCESS/FAIL | /up returns 200 |
| ECS tasks | staging | N/A | STABLE/UNSTABLE | running == desired |
| Solid Queue | staging | N/A | RUNNING/DOWN | workers have heartbeat |

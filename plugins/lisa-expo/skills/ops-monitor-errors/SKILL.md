---
name: ops-monitor-errors
description: Monitor the project's configured error tracker (Sentry by default) for unresolved errors in frontend and backend projects. Supports filtering by project, environment, and time range. Follows observability.errorTracking.provider — reports "no error tracker configured" when it is none.
allowed-tools:
  - Bash
  - Read
---

# Ops: Monitor Errors

Monitor the project's error tracker for errors in the application.

**Argument**: `$ARGUMENTS` — project (`frontend`, `backend`, `all`; default: `all`) and optional time range (default: `1h`)

## Resolve the configured error tracker

Read `observability.errorTracking.provider` from the `<lisa-resolved-config>` block (the `config-resolution` rule documents the key). Absent means `sentry`, which is what this skill assumed before the key existed.

| Provider | What to do |
|----------|------------|
| `sentry` | Use the Sentry path below. |
| `none` | Do not query anything. Report `No error tracker is configured for this project (observability.errorTracking.provider: none), so error monitoring was skipped.` and stop. Never call the Sentry CLI, API, or MCP. |
| `other` | Do not use Sentry. Discover the tracker the project actually wires (read `package.json` dependencies, `.env.*` keys, and app bootstrap code), then query it through its own CLI or API with credentials from `lisa-secrets-access`. If nothing reachable is wired, report what is missing and stop. Produce the same output table and severity classification below. |

Everything from here to **Post-Deploy Workflow** is the `sentry` path.

## Discovery

Discover Sentry configuration from:
1. `.sentryclirc` — org and project names
2. `.env.*` files — `EXPO_PUBLIC_SENTRY_DSN` for DSN
3. `package.json` — `@sentry/react-native` (frontend) or `@sentry/node` (backend) for project type

## Sentry CLI

### List Unresolved Issues

```bash
sentry-cli issues list \
  --org {org} \
  --project {project}
```

### Filter by Environment

```bash
sentry-cli issues list \
  --org {org} \
  --project {project} \
  --query "is:unresolved environment:{env}"
```

### Post-Deploy Check (new issues since deploy)

```bash
sentry-cli issues list \
  --org {org} \
  --project {project} \
  --query "is:unresolved firstSeen:-{time}"
```

Where `{time}` is a Sentry duration like `1h`, `30m`, `24h`.

## Sentry API (Fallback)

If `sentry-cli` is not installed or not authenticated, use the API directly:

### List Unresolved Issues

```bash
curl -sf "https://sentry.io/api/0/projects/{org}/{project}/issues/?query=is:unresolved&sort=date" \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" | \
  jq '.[] | {id: .id, title: .title, count: .count, userCount: .userCount, firstSeen: .firstSeen, lastSeen: .lastSeen}'
```

### Filter by Environment

```bash
curl -sf "https://sentry.io/api/0/projects/{org}/{project}/issues/?query=is:unresolved+environment:{env}&sort=date" \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" | \
  jq '.[] | {id: .id, title: .title, count: .count, userCount: .userCount}'
```

## Post-Deploy Workflow

After any deployment:

1. Wait 5 minutes for errors to surface
2. Check for new unresolved issues in the deployed environment, using the configured provider (skip with the `none` message when no tracker is configured)
3. Assess severity: are these new regressions or pre-existing?
4. Report findings with severity assessment

## Output Format

Report errors as a table:

| Issue ID | Title | Events | Users | First Seen | Severity |
|----------|-------|--------|-------|------------|----------|
| 12345 | TypeError: Cannot read property 'name' | 42 | 15 | 5m ago | HIGH |
| 12346 | Network request failed | 3 | 2 | 2h ago | MEDIUM |

### Severity Classification

| Severity | Criteria |
|----------|----------|
| CRITICAL | > 100 events or > 50 users in last hour |
| HIGH | > 10 events or > 5 users, appeared after deploy |
| MEDIUM | Recurring issue, < 10 events |
| LOW | < 3 events, no user impact |

Include summary: total unresolved issues, new since last deploy, and recommendation (proceed / investigate / rollback).

---
name: ops-check-logs
description: Check application logs from local Docker Compose or remote AWS CloudWatch for Rails applications. Supports log tailing, filtering, and error searching.
allowed-tools:
  - Bash
  - Read
---

# Ops: Check Logs

View and search logs across local and remote environments.

**Argument**: `$ARGUMENTS` — target and optional filter (e.g., `local`, `local worker`, `staging errors`, `production 500`, `staging slow-queries`)

## Discovery

1. Read `config/deploy.yml` to discover the service name (used in CloudWatch log group naming)
2. Read `docker-compose.yml` to identify local service names for targeted log viewing
3. Discover the AWS region from deploy config or environment variables

## Local Logs (Docker Compose)

### All Services

```bash
docker compose logs --tail=100
```

### Follow Mode (tail)

```bash
docker compose logs -f --tail=50
```

### Specific Service

```bash
# Rails web server
docker compose logs --tail=100 web

# Solid Queue worker
docker compose logs --tail=100 worker

# PostgreSQL
docker compose logs --tail=100 postgres
```

### Filter for Errors

```bash
docker compose logs --tail=500 web 2>&1 | grep -iE "(error|exception|fatal|500)"
```

### Rails Development Log (if running outside Docker)

```bash
tail -n 100 log/development.log
```

### Filter Rails Log for Slow Queries

```bash
grep -E "SLOW|ms\)" log/development.log | tail -20
```

## Remote Logs (Kamal)

### Tail Application Logs

```bash
kamal app logs -d {environment}
```

### Follow Mode

```bash
kamal app logs -d {environment} -f
```

### Specific Role

```bash
# Web role
kamal app logs --roles=web -d {environment}

# Worker role (Solid Queue)
kamal app logs --roles=worker -d {environment}
```

## Remote Logs (CloudWatch via AWS CLI)

For advanced filtering and historical log access, use the AWS CLI directly.

### Discover Log Groups

```bash
aws logs describe-log-groups \
  --region {aws-region} \
  --query 'logGroups[].logGroupName' \
  --output text | tr '\t' '\n' | grep -i "{app_name}"
```

### Filter for Errors (last 30 minutes)

```bash
aws logs filter-log-events \
  --region {aws-region} \
  --log-group-name "{log-group}" \
  --start-time $(( ($(date +%s) - 1800) * 1000 )) \
  --filter-pattern "ERROR" \
  --query 'events[].message' \
  --output text
```

### Filter for 500 Errors

```bash
aws logs filter-log-events \
  --region {aws-region} \
  --log-group-name "{log-group}" \
  --start-time $(( ($(date +%s) - 1800) * 1000 )) \
  --filter-pattern '"status=500"' \
  --query 'events[].message' \
  --output text
```

### Filter for Slow Requests (> 1 second)

```bash
aws logs filter-log-events \
  --region {aws-region} \
  --log-group-name "{log-group}" \
  --start-time $(( ($(date +%s) - 3600) * 1000 )) \
  --filter-pattern '"duration" "1000"' \
  --query 'events[].message' \
  --output text
```

### Tail Live Logs

```bash
aws logs tail "{log-group}" \
  --region {aws-region} \
  --follow \
  --since 10m
```

### Specific Time Range

```bash
aws logs filter-log-events \
  --region {aws-region} \
  --log-group-name "{log-group}" \
  --start-time $(date -d "{start-time}" +%s000) \
  --end-time $(date -d "{end-time}" +%s000) \
  --query 'events[].message' \
  --output text
```

## ECS Task Logs

For container-level logs (useful when the application fails to start):

```bash
# List recent tasks
aws ecs list-tasks \
  --cluster {cluster-name} \
  --service-name {service-name} \
  --region {aws-region} \
  --query 'taskArns[]' --output text

# Describe a task to find the log stream
aws ecs describe-tasks \
  --cluster {cluster-name} \
  --tasks {task-arn} \
  --region {aws-region} \
  --query 'tasks[0].containers[].{Name:name,Status:lastStatus,ExitCode:exitCode}' \
  --output table
```

## Output Format

Report log findings as:

| Source | Timestamp | Level | Context | Message |
|--------|-----------|-------|---------|---------|
| CloudWatch | 2026-03-18T10:30:00Z | ERROR | web | ActiveRecord::ConnectionTimeoutError |
| Docker | — | ERROR | worker | SolidQueue::ProcessMissingError |
| Rails log | — | WARN | N/A | DEPRECATION WARNING: ... |

Include a summary of findings: total errors, warnings, and any patterns observed.

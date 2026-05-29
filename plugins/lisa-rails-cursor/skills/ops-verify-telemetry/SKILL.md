---
name: ops-verify-telemetry
description: Verify OpenTelemetry traces are being collected and exported to AWS X-Ray for Rails applications. Check collector health, trace export, and CloudWatch metrics.
allowed-tools:
  - Bash
  - Read
---

# Ops: Verify Telemetry

Verify OpenTelemetry traces are being collected and exported to X-Ray.

**Argument**: `$ARGUMENTS` — check type (`traces`, `metrics`, `all`; default: `all`)

## Discovery

1. Read `Gemfile` for OpenTelemetry gem configuration:
   - `opentelemetry-sdk`
   - `opentelemetry-exporter-otlp`
   - `opentelemetry-instrumentation-all` (or individual instrumentation gems)
2. Read `config/initializers/opentelemetry.rb` (or similar) for SDK configuration
3. Read `config/deploy.yml` or environment files for `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME`
4. Read `docker-compose.yml` for OpenTelemetry Collector sidecar configuration (if present)

## Local Verification

### Check OpenTelemetry Gems

```bash
bundle list | grep -i opentelemetry
```

### Check OpenTelemetry Configuration

```bash
grep -r "OpenTelemetry" config/initializers/ app/
```

### Verify OTLP Endpoint is Set

```bash
echo "OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-not set}"
echo "OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME:-not set}"
```

### Generate a Test Trace (local)

Make a request to the local app and check that traces are produced:

```bash
# Make a request that should generate a trace
curl -sf http://localhost:3000/up -w "\nHTTP %{http_code}\n"

# Check Rails logs for OpenTelemetry output (if configured to log)
grep -i "otel\|opentelemetry\|trace_id" log/development.log | tail -10
```

### Check Collector Sidecar (if using Docker Compose)

```bash
docker compose logs otel-collector 2>/dev/null | tail -20 || echo "No otel-collector service in Docker Compose"
```

## Remote Verification (AWS X-Ray)

### Check Recent Traces

```bash
aws xray get-trace-summaries \
  --region {aws-region} \
  --start-time $(ruby -r time -e 'puts (Time.now.utc - 30 * 60).iso8601') \
  --end-time $(ruby -r time -e 'puts Time.now.utc.iso8601') \
  --query 'TraceSummaries | length(@)' \
  --output text
```

### Check Traces for the Application Service

```bash
aws xray get-trace-summaries \
  --region {aws-region} \
  --start-time $(ruby -r time -e 'puts (Time.now.utc - 30 * 60).iso8601') \
  --end-time $(ruby -r time -e 'puts Time.now.utc.iso8601') \
  --filter-expression "service(\"{service-name}\")" \
  --query 'TraceSummaries[:10].{TraceId:Id,Duration:Duration,StatusCode:Http.HttpStatus,URL:Http.HttpURL,ResponseTime:ResponseTime}' \
  --output table
```

### Check for Error Traces

```bash
aws xray get-trace-summaries \
  --region {aws-region} \
  --start-time $(ruby -r time -e 'puts (Time.now.utc - 3600).iso8601') \
  --end-time $(ruby -r time -e 'puts Time.now.utc.iso8601') \
  --filter-expression "service(\"{service-name}\") AND fault = true" \
  --query 'TraceSummaries[:10].{TraceId:Id,Duration:Duration,StatusCode:Http.HttpStatus,URL:Http.HttpURL}' \
  --output table
```

### Get Detailed Trace

```bash
aws xray batch-get-traces \
  --region {aws-region} \
  --trace-ids "{trace-id}" \
  --query 'Traces[0].Segments[].Document' \
  --output text | jq '.'
```

### Check X-Ray Service Map

```bash
aws xray get-service-graph \
  --region {aws-region} \
  --start-time $(ruby -r time -e 'puts (Time.now.utc - 3600).iso8601') \
  --end-time $(ruby -r time -e 'puts Time.now.utc.iso8601') \
  --query 'Services[].{Name:Name,Type:Type,Edges:Edges[].{Ref:ReferenceId,Latency:ResponseTimeHistogram[0].Average}}' \
  --output table
```

## CloudWatch Metrics Verification

### Check Custom Metrics Published by the Application

```bash
aws cloudwatch list-metrics \
  --region {aws-region} \
  --namespace "{app_name}" \
  --query 'Metrics[].{MetricName:MetricName,Dimensions:Dimensions[].{Name:Name,Value:Value}}' \
  --output table
```

### Check Recent Metric Data Points

```bash
aws cloudwatch get-metric-statistics \
  --region {aws-region} \
  --namespace "{app_name}" \
  --metric-name "{metric-name}" \
  --start-time $(ruby -r time -e 'puts (Time.now.utc - 3600).iso8601') \
  --end-time $(ruby -r time -e 'puts Time.now.utc.iso8601') \
  --period 300 \
  --statistics Average Sum \
  --output table
```

### Check CloudWatch Alarms

```bash
aws cloudwatch describe-alarms \
  --region {aws-region} \
  --alarm-name-prefix "{app_name}" \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Metric:MetricName,Threshold:Threshold}' \
  --output table
```

## Remote Verification (via Kamal)

For checking telemetry configuration in deployed environments:

```bash
kamal app exec --roles=web "bin/rails runner \"
  puts 'OTEL_EXPORTER_OTLP_ENDPOINT: ' + ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'NOT SET')
  puts 'OTEL_SERVICE_NAME: ' + ENV.fetch('OTEL_SERVICE_NAME', 'NOT SET')
  puts 'OTEL_TRACES_EXPORTER: ' + ENV.fetch('OTEL_TRACES_EXPORTER', 'NOT SET')
\"" -d {environment}
```

## Output Format

### Trace Summary

| Check | Status | Details |
|-------|--------|---------|
| OTel gems installed | OK/FAIL | opentelemetry-sdk v1.x.x |
| OTel initializer present | OK/FAIL | config/initializers/opentelemetry.rb |
| OTLP endpoint configured | OK/FAIL | https://otel-collector:4318 |
| Traces in X-Ray (last 30m) | OK/FAIL | 245 traces found |
| Error traces (last 1h) | OK/WARN | 3 fault traces |
| CloudWatch metrics | OK/FAIL | 12 custom metrics published |
| CloudWatch alarms | OK/WARN | 1 alarm in ALARM state |

### Recent Traces

| Trace ID | Duration | Status | URL |
|----------|----------|--------|-----|
| 1-abc123 | 45ms | 200 | GET /up |
| 1-def456 | 120ms | 200 | GET /api/v1/users |
| 1-ghi789 | 2300ms | 500 | POST /api/v1/orders |

Flag concerns:
- No traces found in the last 30 minutes
- Error rate above 5% of total traces
- Average trace duration above 1 second
- OTLP endpoint not configured
- CloudWatch alarms in ALARM state

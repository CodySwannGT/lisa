---
name: ops-verify-jobs
description: Verify Solid Queue background jobs are running in Rails applications. Check worker health, queue depth, failed jobs, recurring job execution, and retry stuck jobs.
allowed-tools:
  - Bash
  - Read
---

# Ops: Verify Jobs

Verify Solid Queue background jobs are running and healthy.

**Argument**: `$ARGUMENTS` — operation (`status`, `failed`, `retry`, `recurring`, `depth`; default: `status`)

## Discovery

1. Read `config/solid_queue.yml` (or `config/queue.yml`) to understand the worker and dispatcher configuration
2. Read `app/jobs/` directory to discover all job classes
3. Read `config/recurring.yml` (if it exists) to discover scheduled/recurring jobs

## Prerequisites

The Rails application must be running (locally or remotely) for database-backed queries to work.

## Operations

### status (overall health)

Check Solid Queue process health via database heartbeats:

```bash
bin/rails runner "
  processes = SolidQueue::Process.all
  puts '=== Solid Queue Processes ==='
  processes.each do |p|
    stale = p.last_heartbeat_at < 5.minutes.ago ? 'STALE' : 'OK'
    puts \"#{p.kind} | PID #{p.pid} | #{p.hostname} | Last heartbeat: #{p.last_heartbeat_at} | #{stale}\"
  end
  puts ''
  puts \"Total: #{processes.count} processes\"
  puts \"Healthy: #{processes.select { |p| p.last_heartbeat_at > 5.minutes.ago }.count}\"
  puts \"Stale: #{processes.select { |p| p.last_heartbeat_at <= 5.minutes.ago }.count}\"
"
```

### depth (queue depth by queue name)

```bash
bin/rails runner "
  puts '=== Queue Depth ==='
  SolidQueue::Job.where(finished_at: nil).group(:queue_name).count.each do |queue, count|
    puts \"#{queue}: #{count} pending\"
  end
  puts ''
  total = SolidQueue::Job.where(finished_at: nil).count
  puts \"Total pending: #{total}\"
"
```

### failed (list failed jobs)

```bash
bin/rails runner "
  failed = SolidQueue::FailedExecution.includes(:job).order(created_at: :desc).limit(20)
  puts '=== Failed Jobs ==='
  failed.each do |f|
    puts \"#{f.job.class_name} | Queue: #{f.job.queue_name} | Failed at: #{f.created_at} | Error: #{f.error.to_s.truncate(120)}\"
  end
  puts ''
  puts \"Total failed: #{SolidQueue::FailedExecution.count}\"
"
```

### retry (retry failed jobs)

Retry all failed jobs:

```bash
bin/rails runner "
  count = SolidQueue::FailedExecution.count
  SolidQueue::FailedExecution.find_each do |fe|
    fe.retry
  end
  puts \"Retried #{count} failed jobs\"
"
```

Retry a specific job class:

```bash
bin/rails runner "
  failed = SolidQueue::FailedExecution.includes(:job).where(solid_queue_jobs: { class_name: '{JobClassName}' })
  count = failed.count
  failed.find_each { |fe| fe.retry }
  puts \"Retried #{count} #{'{JobClassName}'} jobs\"
"
```

### recurring (check recurring job schedule)

```bash
bin/rails runner "
  puts '=== Recurring Tasks ==='
  SolidQueue::RecurringTask.all.each do |task|
    last_run = SolidQueue::Job.where(class_name: task.class_name).order(created_at: :desc).first
    last_run_at = last_run&.created_at || 'NEVER'
    puts \"#{task.key} | #{task.class_name} | Schedule: #{task.schedule} | Last run: #{last_run_at}\"
  end
" 2>/dev/null || echo "RecurringTask not available — check config/recurring.yml"
```

## Remote Verification (via Kamal)

For checking jobs in staging/production environments:

```bash
kamal app exec --roles=web "bin/rails runner \"
  processes = SolidQueue::Process.all
  healthy = processes.select { |p| p.last_heartbeat_at > 5.minutes.ago }.count
  stale = processes.select { |p| p.last_heartbeat_at <= 5.minutes.ago }.count
  failed = SolidQueue::FailedExecution.count
  pending = SolidQueue::Job.where(finished_at: nil).count
  puts \\\"Processes: #{processes.count} (#{healthy} healthy, #{stale} stale)\\\"
  puts \\\"Pending jobs: #{pending}\\\"
  puts \\\"Failed jobs: #{failed}\\\"
\"" -d {environment}
```

## Output Format

### Process Status

| Kind | PID | Hostname | Last Heartbeat | Status |
|------|-----|----------|---------------|--------|
| Worker | 12345 | web-1 | 30s ago | OK |
| Dispatcher | 12346 | web-1 | 15s ago | OK |

### Queue Depth

| Queue | Pending | Status |
|-------|---------|--------|
| default | 3 | OK |
| mailers | 0 | OK |
| low_priority | 150 | WARN (> 100) |

### Failed Jobs

| Job Class | Queue | Failed At | Error (truncated) |
|-----------|-------|-----------|-------------------|
| SendEmailJob | mailers | 5m ago | Net::SMTPAuthenticationError |
| ProcessPaymentJob | default | 1h ago | Stripe::CardError |

Flag concerns:
- Any stale process (heartbeat > 5 minutes ago)
- Queue depth > 100 pending jobs
- Any failed jobs in the last hour
- Recurring jobs that missed their schedule
